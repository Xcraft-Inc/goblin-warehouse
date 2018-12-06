'use strict';

const path = require('path');
const {fromJS} = require('immutable');
const diff = require('immutablediff');

const goblinName = path.basename(module.parent.filename, '.js');

const Goblin = require('xcraft-core-goblin');
const _ = require('lodash');

const getTimestampForTTL = TTL => {
  if (TTL === 'Infinity') {
    return TTL;
  }
  const now = new Date().getTime();
  return now + TTL;
};

// Define initial logic values
const logicState = {
  _subscriptions: {},
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

const updateOwnership = (state, branch, parents, feeds, isCreating) => {
  let newState = state;

  /* Handle ownership for the feed */
  let skip = 0;
  for (const feed of feeds) {
    for (const parent of parents) {
      const ownership = state
        .get(`_subscriptions.feed-${feed}.branches.${branch}`, {
          parents: {},
          children: {},
        })
        .toJS();
      if (isCreating === true) {
        ownership.parents.new = true;
      } else if (isCreating === false) {
        delete ownership.parents.new;
      }

      if (
        branch !== parent &&
        !Object.keys(ownership.parents).length &&
        !state.has(`_subscriptions.feed-${feed}.branches.${parent}`)
      ) {
        ++skip;
        continue;
      }

      if (parent) {
        /* Set the child where appropriate */
        if (branch === parent) {
          /* Own child and parent */
          ownership.children[branch] = true;
        } else if (!ownership.parents[parent]) {
          /* Other parent */
          const _ownership = state
            .get(`_subscriptions.feed-${feed}.branches.${parent}`, {
              parents: {},
              children: {},
            })
            .toJS();
          _ownership.children[branch] = true;
          newState = newState.set(
            `_subscriptions.feed-${feed}.branches.${parent}`,
            _ownership
          );
        }
        ownership.parents[parent] = true;
      } else if (!Object.keys(ownership.parents).length) {
        console.warn('Orphan detected:', branch);
      }
      newState = newState.set(
        `_subscriptions.feed-${feed}.branches.${branch}`,
        ownership
      );
    }
  }

  if (skip > 0 && skip === parents.length * feeds.length) {
    console.warn(
      `${branch} immediatly collected because all possible parents are unknown`
    );
    return {state, collected: true};
  }
  return {state: newState, collected: false};
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
    const isCreating = action.get('isCreating');
    const branch = action.get('branch');
    let parents = action.get('parents', []);
    let feeds = action.get('feeds', []);

    if (!Array.isArray(parents)) {
      parents = [parents];
    }
    if (!Array.isArray(feeds)) {
      feeds = [feeds];
    }

    const existing = state.has(branch);
    if (!existing && !parents.length) {
      console.warn(
        `Skipped upsert for ${branch}, the goblin is away from warehouse, deleted, or not totally created...`
      );
      return state;
    }

    const update = updateOwnership(state, branch, parents, feeds, isCreating);
    if (update.collected) {
      return state;
    }

    let newState = update.state;

    //update data only with some!
    if (Object.keys(data).length !== 0 || !existing) {
      newState = newState.set(branch, data);
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

    if (!newState.get(`${branch}.id`)) {
      newState = newState.set(`${branch}.id`, branch);
    }

    return newState;
  },
  'delete-branch': (state, action) => {
    const branch = action.get('branch');
    const list = {}; /* List of branches by feed without parents */

    const collect = (feed, branch) => {
      if (!list[feed]) {
        list[feed] = {};
      }

      const ownership = state
        .get(`_subscriptions.${feed}.branches.${branch}`)
        .toJS();
      /* Update parents 'children' property */
      for (const parent in ownership.parents) {
        state = state.del(
          `_subscriptions.${feed}.branches.${parent}.children.${branch}`
        );
      }
      /* Update children 'parents' property */
      for (const child in ownership.children) {
        state = state.del(
          `_subscriptions.${feed}.branches.${child}.parents.${branch}`
        );
        if (
          state.get(`_subscriptions.${feed}.branches.${child}.parents`).size ===
            0 &&
          branch !== child
        ) {
          list[feed][child] = true;
        }
      }
      /* Remove itself */
      state = state
        .del(`_subscriptions.${feed}.branches.${branch}`)
        .del(branch);
      delete list[feed][branch];
    };

    state
      .get(`_subscriptions`)
      .filter(s => s.hasIn(['branches', branch]))
      .forEach((_, feed) => {
        if (!list[feed]) {
          list[feed] = {};
        }
        list[feed][branch] = true;
      });

    let loop = true;
    while (loop) {
      loop = false;
      for (const feed in list) {
        for (const branch in list[feed]) {
          collect(feed, branch);
        }
        if (Object.keys(list[feed]).length > 0) {
          loop = true;
        }
      }
    }

    return state;
  },
  'update-created-by': (state, action) => {
    const createdBy = action.get('createdBy');
    const TTL = action.get('TTL');
    let newParents = state.get(`${action.get('branch')}.createdBy`, fromJS([]));
    if (createdBy) {
      if (!newParents.includes(createdBy)) {
        newParents = newParents.push('', createdBy);
      }
    }
    if (TTL) {
      newParents
        .filter(owner => owner.startsWith('TTL-'))
        .forEach(owner => {
          newParents = newParents.unpush('', owner);
        });
      newParents = newParents.push('', `TTL-${getTimestampForTTL(TTL)}`);
    }
    return state
      .set(`${action.get('branch')}.createdBy`, newParents.toArray())
      .set(`${action.get('branch')}.id`, action.get('branch'));
  },
  'remove-created-by': (state, action) => {
    const branch = action.get('branch');
    const owners = action.get('owners');
    let newParents = state.get(`${branch}.createdBy`, fromJS([]));

    owners
      .filter(owner => newParents.includes(owner))
      .forEach(owner => {
        newParents = newParents.unpush('', owner);
      });

    return state
      .set(`${action.get('branch')}.createdBy`, newParents.toArray())
      .set(`${action.get('branch')}.id`, action.get('branch'));
  },
  'remove-batch': (state, action) => {
    // removing in batch
    const branches = action.get('branches');
    return state.deleteAll(branches);
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
    const feed = action.get('feed');

    action.get('branches').forEach(branch => {
      const update = updateOwnership(state, branch, [branch], [feed]);
      state = update.state;
      if (!update.collected && !state.has(branch)) {
        state = state.set(branch, {id: branch});
      }
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
      {
        parents: {},
        children: {},
      }
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
    return state.del(`_subscriptions.feed-${action.get('feed')}`);
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
  const patch = !!previousStates[feed];
  const newState = patch ? diff(previousStates[feed].state, state) : state;

  const generation = getNextGeneration(feed);
  previousStates[feed] = {state, generation};

  return fromJS({state: newState, generation, _xcraftPatch: patch});
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

  if (changeFeeds.get(feed, {}).equals(state)) {
    return;
  }

  changeFeeds = setLastChanges(feed, state);

  // notify global state on bus
  quest.evt(`${feed}.changed`, computePatch(feed, state.state));

  // change feed public
  sub.get('branches', {}).forEach(branch => {
    const branchChanges = getPublicChanges(branch);
    branchChanges
      .filter(v => v)
      .forEach((v, k) => {
        // FIXME: change format for using immutable-patch stuff
        quest.evt(
          `${feed}.${k}.changed`,
          state.get([branch, 'public', k]).state
        );
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
  parents,
  feeds,
  $msg
) {
  _check(quest, $msg);
  quest.do();
});

Goblin.registerQuest(goblinName, 'upsert-in-batch', function(
  quest,
  branches,
  parents,
  feeds,
  $msg
) {
  _check(quest, $msg);
  for (const key in branches) {
    quest.dispatch('upsert', {
      branch: key,
      data: branches[key],
      parents,
      feeds,
    });
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
  TTL,
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
    const unsub = sub.get('unsubscribe');
    if (unsub) {
      unsub();
      quest.log.info('Unsubscribe called!');
    }
  } else {
    quest.log.warn(`Unavailable feed '${feed}', it looks like a bug`);
  }
  quest.do();
  delete previousStates[feed];
  quest.log.info('Unsubscribe done!');
});

Goblin.registerQuest(goblinName, 'subscribe', function(
  quest,
  feed,
  branches,
  $msg
) {
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
  yield quest.me.removeCreatedBy({owners, newOwners: [], branch});
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
  quest.dispatch('update-subscriptions', {owners, newOwners: [], branch});
});

Goblin.registerQuest(goblinName, 'release', function*(quest, branch, $msg) {
  _check(quest, $msg);
  yield quest.me.removeBatch({branches: [branch]});
  quest.evt('released', [{id: branch}]);
  yield quest.me.collect();
});

Goblin.registerQuest(goblinName, 'collect', function collect(
  quest,
  root,
  $msg
) {
  _check(quest, $msg);
});

Goblin.registerQuest(goblinName, 'status', function(quest) {
  const state = quest.goblin.getState();

  quest.log.info(`Subscriptions:`);
  state.get('_subscriptions').forEach((_, sub) => {
    quest.log.info(`+ ${sub}`);
  });

  quest.log.info(`Branches:`);
  state
    .filter((_, k) => !k.startsWith('_'))
    .sort()
    .forEach((v, branch) => {
      quest.log.info(`- ${branch}`);
      quest.log.verb(`  > Owners:`);
      v.get('createdBy').forEach(v => {
        quest.log.verb(`    ${v}`);
      });
    });
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
