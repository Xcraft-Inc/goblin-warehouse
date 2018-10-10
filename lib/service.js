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
  _maintenance: {},
  _globalNotifyEnabled: false,
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
  'toggle-global-notify': state => {
    return state.set(
      '_globalNotifyEnabled',
      !state.get('_globalNotifyEnabled')
    );
  },
  maintenance: (state, action) =>
    state
      .set('_maintenance.enable', action.get('enable'))
      .set('_maintenance.description', action.get('description'))
      .set('_maintenance.orcName', action.get('orcName')),
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
    let newState = state;

    //update data only with some!
    if (Object.keys(data).length !== 0 || !existing) {
      newState = state.set(branch, data);
    } else {
      console.log('xxx');
    }
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
    newState = newState.set(`${branch}.createdBy`, newCreatedBy.toArray());

    if (!newState.get(`${branch}.id`)) {
      newState = newState.set(`${branch}.id`, branch);
    }

    return newState;
  },
  'delete-branch': (state, action) => {
    return state.del(action.get('branch'));
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
  'remove-created-by': (state, action) => {
    const branch = action.get('branch');
    const owners = action.get('owners');
    let newCreatedBy = state.get(`${branch}.createdBy`, fromJS([]));

    owners.filter(owner => newCreatedBy.includes(owner)).forEach(owner => {
      newCreatedBy = newCreatedBy.unpush('', owner);
    });

    return state.set(
      `${action.get('branch')}.createdBy`,
      newCreatedBy.toArray()
    );
  },
  'remove-batch': (state, action) => {
    // removing in batch
    const branches = action.get('branches');
    let garbaged = state.deleteAll(branches);

    const toClean = garbaged
      .filter((v, k) => !k.startsWith('_'))
      .linq.where(
        branch =>
          branch.has('createdBy') && // skip private members
          branch.has('id') && // skip singletons
          branch.get('createdBy').some(b => branches.indexOf(b) !== -1)
      )
      .select(branch => branch.get('id'))
      .toArray();

    toClean.forEach(id => {
      const oldCreatedBy = [];
      const createdBy = garbaged.get(`${id}.createdBy`);
      const newCreatedBy = createdBy.filter(id => {
        if (branches.indexOf(id) === -1) {
          return true;
        }

        /* 1. Retrieve all removed createdBy */
        oldCreatedBy.push(id);
        return false;
      });

      garbaged = garbaged.set(`${id}.createdBy`, newCreatedBy.toArray());
      if (!newCreatedBy.length) {
        /* FIXME: avoid regression with polypheme, why the subscriptions cannot
         * be tagged for removing ? Without this return, a major bug appears
         * for example when we close a previous tab. It needs to investigate.
         */
        return;
      }

      /* 2. Loop on all feeds (_subscriptions) */
      const feeds = garbaged.get('_subscriptions').keySeq();
      for (const feed of feeds) {
        /* 3. Loop for all removed  createdBy */
        oldCreatedBy
          /* The old id must have a subscription for the current feed */
          .filter(oid => garbaged.has(`_subscriptions.${feed}.branches.${oid}`))
          /* And no new id must have a subscription for this feed */
          .filter(
            () =>
              !newCreatedBy.some(nid =>
                garbaged.has(`_subscriptions.${feed}.branches.${nid}`)
              )
          )
          /* It can be removed because this feed has absolutly no owning on this */
          .forEach(() => {
            /* 4. Tag for removing the branch (id) for each removed createdBy */
            garbaged = garbaged.set(
              `_subscriptions.${feed}.branches.${id}`,
              false
            );
          });
      }
    });
    return garbaged;
  },
  'feed.cleanup': (state, action) => {
    return state.set(
      '_subscriptions',
      state
        .get('_subscriptions')
        .map(feed =>
          feed.set('branches', feed.get('branches').filter(id => !!id))
        )
    );
  },
  subscribe: (state, action) => {
    action.get('branches').forEach(branch => {
      state = state.set(
        `_subscriptions.feed-${action.get('feed')}.branches.${branch}`,
        true
      );
    });
    return state;
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

const getNextGeneration = feed => {
  return previousStates[feed] ? previousStates[feed].generation + 1 : 0;
};

const computePatch = (feed, state) => {
  const delta = diff(previousStates[feed] || fromJS({}), state);
  const generation = getNextGeneration(feed);
  previousStates[feed] = {state, generation};
  return fromJS({state: delta, generation, _xcraftPatch: true});
};

const handleChanges = (quest, feed) => {
  const state = quest.goblin.getState();

  //notify global infos
  if (state.get('_globalNotifyEnabled', false)) {
    quest.evt('changed', {
      size: state.size,
      feeds: state.get('_subscriptions').size,
    });
  }

  // quest.log.info (`handle changes for state:\n ${JSON.stringify (state.toJS (), null, 2)}`);
  const sub = getSubscription(state, feed);
  if (!sub) {
    return;
  }
  const changes = state.filter((v, key) => {
    return sub.has(`branches.${key}`);
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

function _check(quest, msg) {
  const state = quest.goblin.getState();
  const enable = state.get('_maintenance.enable', false);
  if (enable) {
    const orcName = state.get('_maintenance.orcName');
    if (orcName !== msg.orcName)
      throw new Error(state.get('_maintenance.description'));
  }
}

Goblin.registerQuest(goblinName, 'toggle-global-notify', function(quest) {
  quest.do();
});

Goblin.registerQuest(goblinName, 'maintenance', function(
  quest,
  enable,
  description,
  orcName
) {
  /* FIXME: this quest must wait that all warehouse.released events
   * are really consumed by (here) the core goblin. Otherwise it's
   * possible to start a maintenance mode which will break all pending
   * deletes.
   */
  quest.do();
});

// Register quest's according rc.json
Goblin.registerQuest(goblinName, 'save', function*(quest, $msg) {
  _check(quest, $msg);
  yield quest.saveState();
});

Goblin.registerQuest(goblinName, 'load', function*(quest, $msg) {
  _check(quest, $msg);
  yield quest.loadState();
});

Goblin.registerQuest(goblinName, 'upsert', function(
  quest,
  branch,
  createdBy,
  $msg
) {
  _check(quest, $msg);
  quest.do();
});

Goblin.registerQuest(goblinName, 'upsert-in-batch', function(
  quest,
  branches,
  createdBy,
  $msg
) {
  _check(quest, $msg);
  for (const key in branches) {
    quest.dispatch('upsert', {branch: key, data: branches[key], createdBy});
  }
});

Goblin.registerQuest(goblinName, 'delete-branch', function(
  quest,
  branch,
  $msg
) {
  _check(quest, $msg);
  quest.do();
});

Goblin.registerQuest(goblinName, 'update-created-by', function(
  quest,
  branch,
  createdBy,
  $msg
) {
  _check(quest, $msg);
  if (quest.goblin.getState().has(branch)) {
    quest.do();
    return true;
  }
  return false;
});

Goblin.registerQuest(goblinName, 'update-created-by-in-batch', function(
  quest,
  branches,
  $msg
) {
  _check(quest, $msg);
  const res = {};
  for (const key in branches) {
    const branch = branches[key];
    if (quest.goblin.getState().has(branch.branch)) {
      quest.dispatch('update-created-by', branch);
      res[branch.branch] = true;
    }
    res[branch.branch] = false;
  }
  return res;
});

Goblin.registerQuest(goblinName, 'has', function(quest, path, $msg) {
  _check(quest, $msg);
  if (!path) {
    return false;
  }
  return quest.goblin.getState().has(path);
});

Goblin.registerQuest(goblinName, 'get', function(quest, path, $msg) {
  _check(quest, $msg);
  if (!path) {
    return null;
  }
  return quest.goblin.getState().get(path, null);
});

////Query ex:
/// type: 'missionOrderTicket'
/// filter: {date: 'xxxxx', orderId: 'xxx'}
/// perform a AND between filter
Goblin.registerQuest(goblinName, 'query', function(quest, type, filter, $msg) {
  _check(quest, $msg);
  const state = quest.goblin.getState();
  const results = [];

  const filters = Object.keys(filter).map(k => {
    return {path: k, val: filter[k]};
  });

  const resultReducer = (results, entity) => {
    const pass = filters.reduce((pass, filter) => {
      const value = entity.get(filter.path, undefined);
      return value === filter.val;
    }, false);
    if (pass) {
      results.push(entity);
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

Goblin.registerQuest(goblinName, 'remove-batch', (quest, $msg) => {
  _check(quest, $msg);
  quest.do();
});

Goblin.registerQuest(goblinName, 'resend', function(quest, feed, $msg) {
  _check(quest, $msg);
  const state = quest.goblin.getState();
  const sub = getSubscription(state, feed);
  if (!sub) {
    return;
  }

  const changes = state.filter((v, key) => sub.get('branches').has(key));

  const generation = getNextGeneration(feed);
  previousStates[feed] = {state, generation};
  quest.evt(
    `${feed}.changed`,
    fromJS({
      state: changes.state,
      generation,
      _xcraftPatch: false,
    })
  );
});

Goblin.registerQuest(goblinName, 'unsubscribe', (quest, feed, $msg) => {
  _check(quest, $msg);
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

Goblin.registerQuest(goblinName, 'subscribe', (quest, feed, branches, $msg) => {
  _check(quest, $msg);
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
  const hc = _.throttle(handleChanges, 200);
  const unsubscribe = quest.goblin.store.subscribe(() => hc(quest, feed));
  quest.dispatch('registerUnsubscribe', {feed, func: unsubscribe});
  quest.log.info('Subscription done!');
});

Goblin.registerQuest(goblinName, 'feed.add', function(
  quest,
  feed,
  branch,
  $msg
) {
  _check(quest, $msg);
  const sub = getSubscription(quest.goblin.getState(), feed);
  if (!sub) {
    quest.log.warn(`Unavailable feed '${feed}', it looks like a bug`);
    return false;
  }
  if (sub.has(`branches.${branch}`)) {
    return false;
  }
  quest.do();
  return true;
});

Goblin.registerQuest(goblinName, 'feed.del', function*(
  quest,
  feed,
  owners,
  branch,
  $msg
) {
  _check(quest, $msg);
  if (!owners) {
    owners = [branch];
  }
  const sub = getSubscription(quest.goblin.getState(), feed);
  if (!sub || !sub.has(`branches.${branch}`)) {
    return false;
  }
  quest.dispatch('remove-created-by', {owners, branch});
  yield quest.me.collect({root: branch});
  return true;
});

Goblin.registerQuest(goblinName, 'remove-created-by', function(
  quest,
  owners,
  branch,
  $msg
) {
  _check(quest, $msg);
  quest.do();
});

Goblin.registerQuest(goblinName, 'release', function*(quest, branch, $msg) {
  _check(quest, $msg);
  yield quest.me.removeBatch({branches: [branch]});
  quest.evt('released', [{id: branch}]);
  quest.me.collect();
});

Goblin.registerQuest(goblinName, 'collect', function collect(
  quest,
  root,
  $msg
) {
  _check(quest, $msg);
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

  const branches = state.filter((v, k) => !k.startsWith('_')).linq;

  const collectable = branches
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
      branches
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
    quest.dispatch('feed.cleanup');
    quest.log.info('collect [done]');
    return;
  }

  quest.log.verb('collect [next]');

  /* Remove collectable branches and tags some feeds according to the createdBy
   * removed by remove-batch. For example, when a branch has more than one
   * createdBy, remove-batch ensures that feeds where the branch is no longer
   * referenced, are tagged for removing too. Otherwise it's possible to have
   * branches without createdBy in the frontend. It's a common case with shared
   * entities.
   * A tagged feed, is just a feed with its value to `false`.
   */
  quest.dispatch('remove-batch', {branches: collectable.map(col => col.id)});

  /* Feeds are always removed after remove-batch. */
  const feeds = state.get('_subscriptions').keySeq();
  for (const feed of feeds) {
    quest.dispatch('feed.del-in-batch', {
      feed,
      branches: collectable.map(col => col.id),
      fullpath: true,
    });
  }

  quest.evt(`released`, collectable);
  collect(quest, null, $msg);
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
