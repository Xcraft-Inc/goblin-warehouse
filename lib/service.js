'use strict';

const path = require('path');
const {fromJS} = require('immutable');
const diff = require('immutablediff');

const goblinName = path.basename(module.parent.filename, '.js');

const Goblin = require('xcraft-core-goblin');
const _ = require('lodash');

// Define initial logic values
const logicState = {
  _subscriptions: {},
  _changes: {},
};

let changeFeeds = new Goblin.Shredder({});
let publicChangeFeeds = new Goblin.Shredder({});

const setLastChanges = (feed, changes) => {
  return changeFeeds.set(feed, changes);
};

const getPublicChanges = branch => {
  return publicChangeFeeds.get(branch, {});
};

const resetPropertyChanged = path => {
  return publicChangeFeeds.set(path, false);
};

const setPropertyChanged = (path, hasChanged) => {
  return publicChangeFeeds.set(path, hasChanged);
};

// Define logic handlers according rc.json
const logicHandlers = {
  upsert: (state, action) => {
    const data = action.get('data');
    const createdBy = action.get('createdBy');
    const branch = action.get('branch');

    const existing = state.get(branch, null);
    if (!existing && !createdBy) {
      console.warn(
        `Skipped upsert for ${branch}, the goblin is away from warehouse, deleted, or not totally created...`
      );
      return state;
    }
    let newState = state.set(branch, data);
    //handle public changes
    const hasChanged = (oldvalue, newvalue) => {
      if (typeof newvalue === 'object') {
        return !newvalue.equals(oldvalue);
      }
      return newvalue !== oldvalue;
    };
    newState.get(`${action.meta.branch}.public`, {}).forEach((v, k) => {
      const old = state.get([action.meta.branch, 'public', k], null);
      publicChangeFeeds = setPropertyChanged(
        [action.meta.branch, k],
        hasChanged(old, v)
      );
      return true;
    });
    let newCreatedBy = state.get(`${branch}.createdBy`, fromJS([]));
    if (createdBy) {
      if (!newCreatedBy.includes(createdBy)) {
        newCreatedBy = newCreatedBy.push('', createdBy);
      }
    } else {
      if (newCreatedBy.size === 0) {
        console.warn('Orphan detected:', branch);
      }
    }
    newState = newState.set(
      `${action.get('branch')}.createdBy`,
      newCreatedBy.toArray()
    );

    return newState;
  },
  'update-created-by': (state, action) => {
    const createdBy = action.get('createdBy');
    let newCreatedBy = state.get(
      `${action.get('branch')}.createdBy`,
      fromJS([])
    );
    if (createdBy) {
      if (!newCreatedBy.includes(createdBy)) {
        newCreatedBy = newCreatedBy.push('', createdBy);
      }
    }
    return state
      .set(`${action.get('branch')}.createdBy`, newCreatedBy.toArray())
      .set(`${action.get('branch')}.id`, action.get('branch'));
  },
  'remove-self': (state, action) => {
    const branch = action.get('branch');
    let newCreatedBy = state.get(`${branch}.createdBy`, fromJS([]));

    if (newCreatedBy.includes(branch)) {
      newCreatedBy = newCreatedBy.unpush('', branch);
    }
    return state.set(
      `${action.get('branch')}.createdBy`,
      newCreatedBy.toArray()
    );
  },
  'remove-batch': (state, action) => {
    // removing in batch
    const branches = action.get('branches');
    let garbaged = state.deleteAll(branches);

    const toClean = garbaged.linq
      .where(
        branch =>
          branch.has('createdBy') && // skip private members
          branch.has('id') && // skip singletons
          branch.get('createdBy').some(b => branches.indexOf(b) !== -1)
      )
      .select(branch => branch.get('id'))
      .toArray();

    toClean.forEach(id => {
      const createdBy = garbaged.get(`${id}.createdBy`);
      const newCreatedBy = createdBy.filter(id => branches.indexOf(id) === -1);
      garbaged = garbaged.set(`${id}.createdBy`, newCreatedBy.toArray());
    });
    return garbaged;
  },
  subscribe: (state, action) => {
    return state.set(
      [
        '_subscriptions',
        `feed-${action.get('feed')}`,
        'branches',
        action.get('branches')[0],
      ],
      true
    );
  },
  'feed.copy': (state, action) => {
    const copy = state.get(`_subscriptions.feed-${action.get('sourceFeed')}`);
    return state.merge(
      `_subscriptions.feed-${action.get('destinationFeed')}`,
      copy
    );
  },
  'feed.add': (state, action) => {
    return state.set(
      `_subscriptions.feed-${action.get('feed')}.branches.${action.get(
        'branch'
      )}`,
      true
    );
  },
  'feed.del-in-batch': (state, action) => {
    const prefix = action.get('fullpath') ? '' : 'feed-';
    let branches = state.get(
      `_subscriptions.${prefix}${action.get('feed')}.branches`
    );
    branches = branches.deleteAll(action.get('branches'));
    return state.set(
      `_subscriptions.${prefix}${action.get('feed')}.branches`,
      branches.toJS()
    );
  },
  unsubscribe: (state, action) => {
    return state.del(['_subscriptions', `feed-${action.meta.feed}`]);
  },
  registerUnsubscribe: (state, action) => {
    return state.set(
      `_subscriptions.feed-${action.get('feed')}.unsubscribe`,
      action.payload.func
    );
  },
};

const getSubscription = (state, feed) => {
  return state.get(['_subscriptions', `feed-${feed}`]);
};

const previousStates = {};

const computePatch = (feed, state) => {
  let delta;
  if (previousStates[feed]) {
    delta = diff(previousStates[feed], state);
  } else {
    delta = diff(fromJS({}), state);
  }
  previousStates[feed] = state;
  return fromJS({state: delta, _xcraftPatch: true});
};

const handleChanges = (quest, feed) => {
  const state = quest.goblin.getState();
  // quest.log.info (`handle changes for state:\n ${JSON.stringify (state.toJS (), null, 2)}`);
  const sub = getSubscription(state, feed);
  if (!sub) {
    return;
  }
  const changes = state.filter((v, key) => {
    return sub.get('branches').has(key);
  });

  if (changeFeeds.get(feed, {}).equals(changes)) {
    return;
  }

  changeFeeds = setLastChanges(feed, changes);

  // notify global state on bus
  quest.evt(`${feed}.changed`, computePatch(feed, changes.state));

  // change feed public
  sub.get('branches', {}).forEach(branch => {
    const branchChanges = getPublicChanges(branch);
    branchChanges.filter(v => v).forEach((v, k) => {
      // FIXME: change format for using immutable-patch stuff
      quest.evt(`${feed}.${k}.changed`, state.get([branch, 'public', k]).state);
      publicChangeFeeds = resetPropertyChanged([branch, k]);
      return true;
    });
    return true;
  });
};

// Register quest's according rc.json
Goblin.registerQuest(goblinName, 'save', function*(quest) {
  yield quest.saveState();
});

Goblin.registerQuest(goblinName, 'load', function*(quest) {
  yield quest.loadState();
});

Goblin.registerQuest(goblinName, 'upsert', function*(quest, branch, createdBy) {
  quest.do();
});

Goblin.registerQuest(
  goblinName,
  'update-created-by',
  (quest, branch, createdBy) => {
    quest.do();
  }
);

Goblin.registerQuest(goblinName, 'has', function(quest, path) {
  if (!path) {
    return false;
  }
  const state = quest.goblin.getState().get(path);
  if (state) {
    return true;
  } else {
    return false;
  }
});

Goblin.registerQuest(goblinName, 'get', function(quest, path) {
  if (!path) {
    return null;
  }
  const state = quest.goblin.getState().get(path);
  if (state) {
    return state.toJS();
  } else {
    return null;
  }
});

////Query ex:
/// type: 'missionOrderTicket'
/// filter: {date: 'xxxxx', orderId: 'xxx'}
/// perform a AND between filter
Goblin.registerQuest(goblinName, 'query', function(quest, type, filter) {
  const state = quest.goblin.getState();
  const results = [];

  const filters = Object.keys(filter).map(k => {
    return {path: k, val: filter[k]};
  });

  const resultReducer = (results, entity) => {
    const pass = filters.reduce((pass, filter) => {
      const value = entity.get(filter.path, undefined);
      if (value === filter.val) {
        pass = true;
      } else {
        pass = false;
      }
      return pass;
    }, false);
    if (pass) {
      results.push(entity.toJS());
    }
    return results;
  };

  state
    .keySeq()
    .filter(k => k.startsWith(`${type}@`))
    .map(k => state.get(k))
    .reduce(resultReducer, results);

  return results;
});

Goblin.registerQuest(goblinName, 'remove-batch', quest => {
  quest.do();
});

Goblin.registerQuest(goblinName, 'resend', function(quest, feed) {
  const state = quest.goblin.getState();
  const sub = getSubscription(state, feed);
  if (!sub) {
    return;
  }
  const changes = state.filter((v, key) => {
    return sub.get('branches').has(key);
  });

  previousStates[feed] = state;
  quest.evt(
    `${feed}.changed`,
    fromJS({state: changes.state, _xcraftPatch: false})
  );
});

Goblin.registerQuest(goblinName, 'unsubscribe', (quest, feed) => {
  const state = quest.goblin.getState();
  const sub = getSubscription(state, feed);
  if (sub) {
    quest.log.warn(`Unavailable feed '${feed}', it looks like a bug`);
    const unsub = sub.get('unsubscribe');
    if (unsub) {
      unsub();
      quest.log.info('Unsubscribe called!');
    }
  }
  quest.do();
  delete previousStates[feed];
  quest.log.info('Unsubscribe done!');
});

Goblin.registerQuest(goblinName, 'subscribe', (quest, feed, branches) => {
  // check for existing
  const state = quest.goblin.getState();
  const sub = getSubscription(state, feed);
  if (sub) {
    const unsub = sub.get('unsubscribe');
    if (unsub) {
      unsub();
      quest.log.info('Unsubscribe to previous feed...');
    }
  }

  // subscribe to store and filter
  quest.do();
  const hc = _.throttle(handleChanges, 100);
  const unsubscribe = quest.goblin.store.subscribe(() => hc(quest, feed));
  quest.dispatch('registerUnsubscribe', {feed, func: unsubscribe});
  quest.log.info('Subscription done!');
});

Goblin.registerQuest(goblinName, 'feed.add', function(quest, feed, branch) {
  const sub = getSubscription(quest.goblin.getState(), feed);
  if (!sub) {
    quest.log.warn(`Unavailable feed '${feed}', it looks like a bug`);
    return false;
  }
  if (sub.get('branches').has(branch)) {
    return false;
  }
  quest.do();
  return true;
});

Goblin.registerQuest(goblinName, 'feed.del', function*(quest, feed, branch) {
  const sub = getSubscription(quest.goblin.getState(), feed);
  if (!sub.get('branches').has(branch)) {
    return false;
  }
  quest.dispatch('remove-self', {branch});
  yield quest.me.collect({root: branch});
  return true;
});

Goblin.registerQuest(goblinName, 'release', function*(quest, branch) {
  yield quest.me.removeBatch({branches: [branch]});
  quest.evt('released', [{id: branch}]);
  quest.me.collect();
});

Goblin.registerQuest(goblinName, 'collect', function collect(quest, root) {
  const state = quest.goblin.getState();

  const reducer = (state, action) => {
    if (!state[action.id]) {
      state[action.id] = {
        id: action.id,
        owners: [],
      };
    }
    state[action.id].owners.push(action.owner);
    return state;
  };

  const collectable = state.linq
    .where(
      branch => branch.has('id') && branch.get('createdBy', fromJS([])).size > 0
    )
    .selectMany(branch => {
      const state = branch
        .get('createdBy')
        .toArray()
        .map(owner => {
          return {id: branch.get('id'), owner};
        })
        .reduce(reducer, {});
      const keys = Object.keys(state);
      return keys.map(id => state[id]);
    })
    .where(col => col.owners.every(owner => !state.has(owner)))
    .union(
      state.linq
        .where(
          branch =>
            branch.has('id') && branch.get('createdBy', fromJS([])).size === 0
        )
        .selectMany(branch => {
          //XXX: Find why we found branches with no createdBy ?!
          return {id: branch.get('id')};
        })
    )
    .toArray();

  if (root && state.has(root)) {
    const rootBranchOwners = state.get(`${root}.createdBy`);
    if (
      rootBranchOwners.size === 1 &&
      rootBranchOwners._state.get(0) === root
    ) {
      collectable.push({id: root});
    } else if (rootBranchOwners._state.size === 0) {
      collectable.push({id: root});
    }
  }

  if (collectable.length === 0) {
    console.log('collect [done]');
    return;
  }

  console.log('collect [start]');
  const feeds = state.get('_subscriptions').keySeq();
  for (const feed of feeds) {
    quest.dispatch('feed.del-in-batch', {
      feed,
      branches: collectable.map(col => col.id),
      fullpath: true,
    });
  }

  quest.dispatch('remove-batch', {branches: collectable.map(col => col.id)});
  quest.evt(`released`, collectable);
  collect(quest);
});

Goblin.registerQuest(
  goblinName,
  'feed.del-in-batch',
  (quest, feed, branches) => {
    quest.do();
  }
);

const pc = {
  upsert: {
    mode: 'last',
  },
};

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
