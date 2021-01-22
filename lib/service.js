'use strict';

const path = require('path');
const {fromJS} = require('immutable');
const diff = require('immutablediff');
const debounce = require('lodash/debounce');

const goblinName = path.basename(module.parent.filename, '.js');

const Goblin = require('xcraft-core-goblin');
const _ = require('lodash');
const {regex} = require('xcraft-core-utils');

// Define initial logic values
const logicState = {
  _creators: {},
  _generations: {},
  _subscriptions: {},
  _maintenance: {},
};

let changeFeeds = new Goblin.Shredder({});
let publicChangeFeeds = new Goblin.Shredder({});

const setLastChanges = (feed, changes) => {
  return changeFeeds.set(feed, changes);
};

const getPublicChanges = (branch) => {
  return publicChangeFeeds.get(branch, {});
};

const resetPropertyChanged = (path) => {
  return publicChangeFeeds.set(path, false);
};

const setPropertyChanged = (path, hasChanged) => {
  return publicChangeFeeds.set(path, hasChanged);
};

class GarbageCollector {
  constructor() {
    const busClient = require('xcraft-core-busclient').getGlobal();
    this._resp = busClient.newResponse('warehouse', 'token');
    this._collectable = {};
    this._purge = debounce(this._purgeCollectable.bind(this), 50);
  }

  _collect(state, feed, branch, list, autoRelease = false) {
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
    state = state.del(`_subscriptions.${feed}.branches.${branch}`);
    delete list[feed][branch];

    /* Remove empty feed */
    if (state.get(`_subscriptions.${feed}.branches`).size === 0) {
      state = state.del(`_subscriptions.${feed}`);
    }

    /* Skip purge stuff with singletons (cannot be deleted) */
    if (branch.indexOf('@') === -1) {
      return state;
    }

    /* Remove the branch only when we are sure that no more feed is using it */
    const isOwn = state
      .get(`_subscriptions`)
      .some((_, feed) =>
        state.has(`_subscriptions.${feed}.branches.${branch}`)
      );
    if (!isOwn) {
      const generation = state.get(`_generations.${branch}`);
      if (!generation) {
        console.warn(
          `Generation is missing, it must not happend: ${branch}\n` +
            `... maybe you are using desktopId as quest parameter instead of sessionDesktopId with a singleton?`
        );
      }

      this._collectable[branch] = generation;
      this._purge();

      /* When the auto release is required, the collectable event is sent
       * as usual...
       */
      if (autoRelease) {
        state = state.del(branch).del(`_generations.${branch}`);
      }
    }

    return state;
  }

  _purgeCollectable() {
    this._resp.events.send(`warehouse.released`, this._collectable);
    this._collectable = {};
  }

  getOwnership(state, path) {
    const ownership = state.get(path, {parents: {}, children: {}}).toJS();
    if (!ownership.children) {
      ownership.children = {};
    }
    if (!ownership.parents) {
      ownership.parents = {};
    }
    return ownership;
  }

  updateOwnership(state, branch, parents, feeds, isCreating, creator) {
    let newState = state;

    /* Handle ownership for the feed */
    let skip = 0;
    for (const feed of feeds) {
      for (const parent of parents) {
        const ownership = this.getOwnership(
          state,
          `_subscriptions.feed-${feed}.branches.${branch}`
        );
        if (isCreating === true) {
          ownership.parents.new = true;
          if (!creator) {
            throw new Error(`updateOwnership: missing creator for ${branch}`);
          }
          state = state.set(`_creators.${branch}`, creator);
        } else if (isCreating === false) {
          delete ownership.parents.new;
          state = state.delete(`_creators.${branch}`);
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
            if (!state.has(`_subscriptions.feed-${feed}.branches.${parent}`)) {
              throw new Error(
                `Missing parent ${parent} for branch ${branch} in the feed ${feed}`
              );
            }
            /* Other parent */
            const _ownership = this.getOwnership(
              state,
              `_subscriptions.feed-${feed}.branches.${parent}`
            );
            _ownership.children[branch] = true;
            newState = newState.set(
              `_subscriptions.feed-${feed}.branches.${parent}`,
              _ownership
            );
          }
          ownership.parents[parent] = true;
        } else if (!Object.keys(ownership.parents).length) {
          throw new Error(
            `Orphan branch detected: ${branch}, please fix the code because a parent can not be null or undefined`
          );
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
  }

  unsubscribeBranch(state, branch, feed = null, autoRelease = false) {
    let list;

    if (!feed) {
      list = this.extractFeeds(state, branch);
    } else {
      list = {
        [feed]: {
          [branch]: true,
        },
      };
    }

    let loop = true;
    while (loop) {
      loop = false;
      for (const feed in list) {
        for (const branch in list[feed]) {
          state = this._collect(state, feed, branch, list, autoRelease);
        }
        if (Object.keys(list[feed]).length > 0) {
          loop = true;
        }
      }
    }

    return state;
  }

  inFeeds(state, branch) {
    return state
      .get(`_subscriptions`)
      .some((s) => s.hasIn(['branches', branch]));
  }

  extractFeeds(state, branch) {
    const list = {};

    /* Extract all feeds where a specific branch is available */
    state
      .get(`_subscriptions`)
      .filter((s) => s.hasIn(['branches', branch]))
      .forEach((_, feed) => {
        if (!list[feed]) {
          list[feed] = {};
        }
        list[feed][branch] = true;
      });

    return list;
  }
}

const gc = new GarbageCollector();

// Define logic handlers according rc.json
const logicHandlers = {
  'maintenance': (state, action) =>
    state
      .set('_maintenance.enable', action.get('enable'))
      .set('_maintenance.description', action.get('description'))
      .set('_maintenance.orcName', action.get('orcName')),
  'upsert': Goblin.Shredder.mutableReducer((state, action) => {
    const data = action.get('data');
    const isCreating = action.get('isCreating');
    const creator = action.get('creator');
    const branch = action.get('branch');
    const generation = action.get('generation');
    let parents = action.get('parents') || [];
    let feeds = action.get('feeds') || [];

    if (!Array.isArray(parents)) {
      parents = [parents];
    }
    if (!Array.isArray(feeds)) {
      feeds = [feeds];
    }

    const inFeeds = gc.inFeeds(state, branch);
    if (!inFeeds && !parents.length) {
      console.warn(
        `Skipped upsert for ${branch}, the goblin is away from warehouse, deleted, or not totally created...`
      );
      return state;
    }

    if (!feeds.length) {
      feeds = ['system'];
    }

    const update = gc.updateOwnership(
      state,
      branch,
      parents,
      feeds,
      isCreating,
      creator
    );
    if (update.collected) {
      return state;
    }

    let newState = update.state;

    //update data only with some!
    if (Object.keys(data).length !== 0 || !state.has(branch)) {
      newState = newState.set(branch, data);
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
    if (!newState.get(`_generations.${branch}`) && generation) {
      newState = newState.set(`_generations.${branch}`, generation);
    }

    return newState;
  }),
  'delete-branch': Goblin.Shredder.mutableReducer((state, action) => {
    const branch = action.get('branch');
    const autoRelease = branch.startsWith('goblin-orc@');
    return gc.unsubscribeBranch(state, branch, null, autoRelease);
  }),
  'attach-to-parents': (state, action) => {
    const branch = action.get('branch');
    const generation = action.get('generation');
    let parents = action.get('parents');
    if (parents && !Array.isArray(parents)) {
      parents = [parents];
    }
    let feeds = action.get('feeds');
    if (feeds && !Array.isArray(feeds)) {
      feeds = [feeds];
    }

    let list = {};

    if (feeds) {
      for (const feed of feeds) {
        list[`feed-${feed}`] = {[branch]: true};
      }
    } else {
      list = gc.extractFeeds(state, branch);
    }

    if (generation) {
      state = state.set(`_generations.${branch}`, generation);
    }

    for (const feed in list) {
      for (const parent of parents) {
        if (
          state.has(
            `_subscriptions.${feed}.branches.${branch}.parents.${parent}`
          )
        ) {
          continue;
        }

        const parentOwnership = gc.getOwnership(
          state,
          `_subscriptions.${feed}.branches.${parent}`
        );

        if (
          parent.indexOf('@') >= 0 && // not a singleton
          !/^goblin-cache@/.test(parent) && // not related to the cache
          Object.keys(parentOwnership.parents).length === 0
        ) {
          throw new Error(
            `Attach impossible because the parent ${parent} is missing for the branch ${branch} in the feed ${feed}`
          );
        }

        const branchOwnership = gc.getOwnership(
          state,
          `_subscriptions.${feed}.branches.${branch}`
        );
        branchOwnership.parents[parent] = true;

        state = state.set(
          `_subscriptions.${feed}.branches.${branch}`,
          branchOwnership
        );

        /* Orphan in this feed, but exists elsewhere */
        if (Object.keys(parentOwnership.parents).length) {
          if (!gc.inFeeds(state, parent)) {
            console.err(
              `this parent "${parent}" should be at least in one feed, but it's lost into the abyss`
            );
          }

          parentOwnership.children[branch] = true;

          state = state.set(
            `_subscriptions.${feed}.branches.${parent}`,
            parentOwnership
          );
        }
      }
    }

    return state;
  },
  'del-creator': (state, action) => {
    return state.del(`_creators.${action.get('branch')}`);
  },
  'detach-from-parents': Goblin.Shredder.mutableReducer((state, action) => {
    const branch = action.get('branch');
    let parents = action.get('parents');
    if (parents && !Array.isArray(parents)) {
      parents = [parents];
    }
    const feed = action.get('feed');
    const feeds = action.get('feeds');

    const list = feed
      ? {[`feed-${feed}`]: {[branch]: true}}
      : feeds || gc.extractFeeds(state, branch);

    for (const feed in list) {
      if (!state.has(`_subscriptions.${feed}.branches.${branch}.parents`)) {
        continue;
      }

      /* Remove parents of branch */
      for (const parent of parents) {
        if (parent.indexOf('*') !== -1) {
          const r = new RegExp(regex.toXcraftRegExpStr(parent));
          state.get(`_subscriptions.${feed}.branches`).forEach((_, branch) => {
            if (r.test(branch)) {
              parents.push(branch);
            }
          });
          continue;
        }

        state = state
          .del(`_subscriptions.${feed}.branches.${branch}.parents.${parent}`)
          .del(`_subscriptions.${feed}.branches.${parent}.children.${branch}`);
      }

      if (
        state.get(`_subscriptions.${feed}.branches.${branch}.parents`).size ===
        0
      ) {
        const autoRelease = branch.startsWith('goblin-orc@');
        state = gc.unsubscribeBranch(state, branch, feed, autoRelease);
      }
    }

    return state;
  }),
  'graft': Goblin.Shredder.mutableReducer((state, action) => {
    const branch = action.get('branch');
    const fromFeed = 'feed-' + action.get('fromFeed');
    const toFeed = 'feed-' + action.get('toFeed');

    const graft = (state, branch) => {
      const branchState = state
        .get(`_subscriptions.${fromFeed}.branches.${branch}`)
        .set('children', {});
      const parents = branchState.get('parents');
      state = state.mergeDeep(
        `_subscriptions.${toFeed}.branches.${branch}`,
        branchState
      );
      for (const [parent] of parents) {
        if (parent !== branch) {
          state = graft(state, parent);
        }
      }
      return state;
    };

    return graft(state, branch);
  }),
  'acknowledge': (state, action) => {
    const branch = action.get('branch');
    const generation = action.get('generation');
    if (generation === state.get(`_generations.${branch}`)) {
      return state.del(branch).del(`_generations.${branch}`);
    }
    return state;
  },
  'remove-batch': (state, action) => {
    // removing in batch
    const branches = action.get('branches');
    return state.deleteAll(branches);
  },
  'subscribe': Goblin.Shredder.mutableReducer((state, action) => {
    const feed = action.get('feed');

    action.get('branches').forEach((branch) => {
      const update = gc.updateOwnership(state, branch, [branch], [feed]);
      state = update.state;
      if (!update.collected && !state.has(branch)) {
        state = state.set(branch, {id: branch});
      }
    });

    return state;
  }),
  'unsubscribe': Goblin.Shredder.mutableReducer((state, action) => {
    const feed = action.get('feed');
    if (!state.has(`_subscriptions.feed-${feed}`)) {
      return state;
    }

    const branches = state.get(`_subscriptions.feed-${feed}.branches`);
    branches.forEach((_, branch) => {
      if (state.has(`_subscriptions.feed-${feed}.branches.${branch}`)) {
        const autoRelease = branch.startsWith('goblin-orc@');
        state = gc.unsubscribeBranch(
          state,
          branch,
          `feed-${feed}`,
          autoRelease
        );
      }
    });

    return state.del(`_subscriptions.feed-${feed}`);
  }),
  'registerUnsubscribe': (state, action) => {
    return state.set(
      `_subscriptions.feed-${action.get('feed')}.unsubscribe`,
      action.payload.func
    );
  },
};

const getSubscription = (state, feed) => {
  return state.get(['_subscriptions', `feed-${feed}`]);
};

/* Filter the warehouse state with only the branches of our feed */
const getChanges = (state, sub) =>
  new Goblin.Shredder().withMutations((changes) => {
    sub
      .get('branches', {})
      .forEach((_, key) => changes.set(key, state.get(key)));
  });

const previousStates = {};

const getNextGeneration = (feed) => {
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

  // quest.log.info (`handle changes for state:\n ${JSON.stringify (state.toJS (), null, 2)}`);
  const sub = getSubscription(state, feed);
  if (!sub) {
    return;
  }

  if (changeFeeds.get(feed, {}).equals(state)) {
    return;
  }

  const changes = getChanges(state, sub);

  if (changeFeeds.get(feed, {}).equals(changes)) {
    return;
  }

  changeFeeds = setLastChanges(feed, changes);

  // notify global state on bus
  quest.evt(`<${feed}>.changed`, computePatch(feed, changes.state));

  // change feed public
  sub.get('branches', {}).forEach((branch) => {
    const branchChanges = getPublicChanges(branch);
    branchChanges
      .filter((v) => v)
      .forEach((v, k) => {
        // FIXME: change format for using immutable-patch stuff
        quest.evt(
          `<${feed}>.${k}.changed`,
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

Goblin.registerQuest(goblinName, 'maintenance', function (
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
Goblin.registerQuest(goblinName, 'save', function* (quest, $msg) {
  _check(quest, $msg);
  yield quest.saveState();
});

Goblin.registerQuest(goblinName, 'load', function* (quest, $msg) {
  _check(quest, $msg);
  yield quest.loadState();
});

Goblin.registerQuest(goblinName, 'upsert', function (
  quest,
  branch,
  parents,
  feeds,
  $msg
) {
  _check(quest, $msg);
  try {
    quest.do();
  } catch (ex) {
    ex.code = 'SILENT_HILL';
    throw ex;
  }
});

Goblin.registerQuest(goblinName, 'get-creator', function (quest, branch, $msg) {
  _check(quest, $msg);
  return quest.goblin.getState().get(`_creators.${branch}`);
});

Goblin.registerQuest(goblinName, 'upsert-in-batch', function (
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

Goblin.registerQuest(goblinName, 'delete-branch', function (
  quest,
  branch,
  $msg
) {
  _check(quest, $msg);
  quest.do();
});

Goblin.registerQuest(goblinName, 'attach-to-parents', function (
  quest,
  branch,
  generation,
  parents,
  feeds,
  $msg
) {
  _check(quest, $msg);
  try {
    quest.do();
  } catch (ex) {
    ex.code = 'SILENT_HILL';
    throw ex;
  }
  return quest.goblin.getState().has(branch);
});

Goblin.registerQuest(goblinName, 'has', function (quest, path, $msg) {
  _check(quest, $msg);
  if (!path) {
    return false;
  }
  return quest.goblin.getState().has(path);
});

Goblin.registerQuest(goblinName, 'hasFeed', function (quest, feedName, $msg) {
  _check(quest, $msg);
  if (!feedName) {
    return false;
  }
  return quest.goblin.getState().has(`_subscriptions.feed-${feedName}`);
});

Goblin.registerQuest(goblinName, 'get', function (quest, path, view, $msg) {
  _check(quest, $msg);
  if (!path) {
    return null;
  }
  if (!view) {
    return quest.goblin.getState().get(path, null);
  } else {
    const state = quest.goblin.getState().get(path, null);
    if (!state) {
      return null;
    }
    return Goblin.Shredder.pluck(state, view);
  }
});

Goblin.registerQuest(goblinName, 'get-branch-subscriptions', function (
  quest,
  branch,
  filters,
  $msg
) {
  _check(quest, $msg);
  const feeds = [];
  const subs = quest.goblin.getState().get('_subscriptions').entries();
  for (const [feed, sub] of subs) {
    if (
      filters &&
      filters.some((filter) => feed.substring(5).startsWith(filter))
    ) {
      continue;
    }
    if (sub.get('branches').has(branch)) {
      feeds.push(feed.substring(5));
    }
  }
  return feeds;
});

////Query ex:
/// ids: ['missionOrderTicker@xxx-x-xx',...]
///   and/or
/// type: 'missionOrderTicket'
///
/// filter: {date: 'xxxxx', orderId: 'xxx'}
/// view: ['id','date']
/// perform a AND between filter
Goblin.registerQuest(goblinName, 'query', function (
  quest,
  feed,
  ids = [],
  type = null,
  filter = null,
  view = null,
  $msg
) {
  _check(quest, $msg);
  let state = quest.goblin.getState();
  const results = [];

  const selector = (key) => {
    if (type && key.startsWith(`${type}@`)) {
      return true;
    }
    if (ids && ids.includes(key)) {
      return true;
    }
    return false;
  };

  let checkIfPass = () => true;

  if (filter) {
    const filters = Object.keys(filter).map((k) => {
      return {path: k, val: filter[k]};
    });

    checkIfPass = (entity) =>
      filters.reduce((pass, filter) => {
        const value = entity.get(filter.path, undefined);
        return value === filter.val;
      }, false);
  }

  const resultReducer = (results, entity) => {
    const pass = checkIfPass(entity);
    if (pass) {
      if (view) {
        results.push(Goblin.Shredder.pluck(entity, view));
      } else {
        results.push(entity);
      }
    }
    return results;
  };

  if (feed) {
    const sub = getSubscription(state, feed);
    if (sub) {
      state = getChanges(state, sub);
    }
  }

  state
    .keySeq()
    .filter(selector)
    .map((k) => state.get(k))
    .reduce(resultReducer, results);

  return results;
});

Goblin.registerQuest(goblinName, 'remove-batch', (quest, $msg) => {
  _check(quest, $msg);
  quest.do();
});

Goblin.registerQuest(goblinName, 'resend', function (quest, feed, $msg) {
  _check(quest, $msg);
  const state = quest.goblin.getState();
  const sub = getSubscription(state, feed);
  if (!sub) {
    return;
  }

  const changes = getChanges(state, sub);
  const generation = getNextGeneration(feed);
  previousStates[feed] = {state, generation};
  quest.evt(
    `<${feed}>.changed`,
    fromJS({
      state: changes.state,
      generation,
      _xcraftPatch: false,
    })
  );
});

function unsubscribe(quest, feed, $msg) {
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
  quest.dispatch('unsubscribe', {feed});
  delete previousStates[feed];
  quest.evt('feed-unsubscribed');
  quest.log.info('Unsubscribe done!');
}
Goblin.registerQuest(goblinName, 'unsubscribe', unsubscribe);

Goblin.registerQuest(goblinName, 'subscribe', function (
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
  quest.evt('feed-subscribed');
  quest.log.info('Subscription done!');
});

Goblin.registerQuest(goblinName, 'feedSubscriptionAdd', function (
  quest,
  feed,
  branch,
  parents,
  $msg
) {
  _check(quest, $msg);
  if (!parents) {
    parents = [branch];
  }
  quest.dispatch('attach-to-parents', {branch, parents, feeds: feed});
  return true;
});

Goblin.registerQuest(goblinName, 'feedSubscriptionDel', function (
  quest,
  feed,
  branch,
  parents,
  $msg
) {
  _check(quest, $msg);
  if (!parents) {
    parents = [branch];
  }
  const sub = getSubscription(quest.goblin.getState(), feed);
  if (!sub || !sub.has(`branches.${branch}`)) {
    return false;
  }
  quest.dispatch('detach-from-parents', {branch, parents, feed});
  return true;
});

Goblin.registerQuest(goblinName, 'del-creator', function (quest, branch, $msg) {
  _check(quest, $msg);
  quest.do();
  quest.dispatch('detach-from-parents', {branch, parents: ['new']});
});

Goblin.registerQuest(goblinName, 'detach-from-parents', function (
  quest,
  branch,
  parents,
  feed,
  $msg
) {
  _check(quest, $msg);

  let state = quest.goblin.getState();
  const feeds = feed
    ? {[`feed-${feed}`]: {[branch]: true}}
    : gc.extractFeeds(state, branch);

  /* Look if the feed branch name contents a branch with the same name */
  const feedbranches = [];
  for (const feed in feeds) {
    const feedBranch = feed.substring(5);
    if (state.has(`_subscriptions.${feed}.branches.${feedBranch}`)) {
      feedbranches.push(feedBranch);
    }
  }

  quest.do({branch, parents, feed, feeds});

  if (!feedbranches.length) {
    return;
  }

  /* Unsubscribe the whole feed if the feed branch is no longer in
   * the subscription branches list.
   */
  state = quest.goblin.getState();
  for (const feedBranch of feedbranches) {
    if (
      !state.has(`_subscriptions.feed-${feedBranch}.branches.${feedBranch}`)
    ) {
      unsubscribe(quest, feedBranch, $msg);
    }
  }
});

Goblin.registerQuest(goblinName, 'graft', function (
  quest,
  branch,
  fromFeed,
  toFeed,
  $msg
) {
  _check(quest, $msg);
  quest.do();
});

Goblin.registerQuest(goblinName, 'acknowledge', function (
  quest,
  branch,
  generation,
  $msg
) {
  _check(quest, $msg);
  quest.do();
});

Goblin.registerQuest(goblinName, 'release', function* (quest, branch, $msg) {
  _check(quest, $msg);
  yield quest.me.removeBatch({branches: [branch]});
  quest.evt('released', [branch]);
});

Goblin.registerQuest(goblinName, 'check', function (quest) {
  const state = quest.goblin.getState();
  const subscriptions = state.get('_subscriptions');

  quest.log.info('>>> Begin check for orphan branches in feeds');
  subscriptions.forEach((_, sub) => {
    quest.log.info(`  ─ subscription: ${sub}`);
    const branches = state.get(`_subscriptions.${sub}.branches`);
    branches.forEach((ownership, branch) => {
      const parents = ownership.get('parents');
      parents
        .map((_, parent) => parent)
        .filter((parent) => parent !== 'new' && !state.has(parent))
        .forEach((parent) => {
          quest.log.warn(
            `    [leak] missing parent '${parent}'\n` +
              `           for '${branch}'\n` +
              `           it's probably a bad practice where creates are crossed between feeds`
          );
        });
    });
  });
  quest.log.info(`<<< Check done`);

  quest.log.info(
    '>>> Begin check for dangling branches in the warehouse state'
  );
  state
    .map((_, branch) => branch)
    .filter((branch) => branch[0] !== '_')
    .forEach((branch) => {
      const inFeed = subscriptions.some((s) => s.hasIn(['branches', branch]));
      if (!inFeed) {
        quest.log.warn(`    [leak] dangling branch '${branch}'`);
      }
    });
  quest.log.info(`<<< Check done`);
});

Goblin.registerQuest(goblinName, 'status', function (quest) {
  const state = quest.goblin.getState();

  quest.log.info(`Subscriptions`);
  state.get('_subscriptions').forEach((_, sub) => {
    quest.log.info(`├─${sub}`);
    state.get(`_subscriptions.${sub}.branches`).forEach((ownership, branch) => {
      const parents = JSON.stringify(ownership.toJS().parents);
      quest.log.info(`│ ├─${branch}`);
      quest.log.info(`│ │ └─ parents: ${parents}`);
    });
  });

  quest.log.info('');
  quest.log.info(`Generations`);
  state.get(`_generations`).forEach((gen, branch) => {
    quest.log.info(`├─${branch}`);
    quest.log.info(`│ └─ gen: ${gen}`);
  });
});

function getBackgroundColor(namespace) {
  let bgcolor = '#eeeeee';
  if (namespace.endsWith('-worker')) {
    bgcolor = '#ccffff';
  } else if (namespace.endsWith('-workitem')) {
    bgcolor = '#ffccff';
  } else if (namespace.endsWith('-feeder')) {
    bgcolor = '#ffffcc';
  } else if (namespace.endsWith('-updater')) {
    bgcolor = '#ccffcc';
  } else if (namespace.endsWith('-dispatcher')) {
    bgcolor = '#ccccff';
  }
  return bgcolor;
}

function buildFullLabel(state, branch, ownOwner, index) {
  const namespace = branch.split('@', 1)[0];
  const bgcolor = getBackgroundColor(namespace);

  const toRed = (value) => `<font color="#b01717">${value}</font>`;
  const hasState = () => (state.has(branch) ? 'true' : toRed('false'));
  const getGen = () =>
    state.has(`_generations.${branch}`)
      ? state.get(`_generations.${branch}`)
      : toRed(state.get(`_generations.${branch}`));
  const branchLabel = branch.match(/.{1,40}/g);

  let label =
    `"${branch}-${index}" [style="" label=<` +
    `<font color="#888888">` +
    `<table bgcolor="${bgcolor}" ` +
    `       color="${bgcolor}" ` +
    `       border="5" ` +
    `       style="rounded" ` +
    `       cellpadding="0" ` +
    `       cellborder="0">` +
    `  <tr>` +
    `    <td width="18" align="left">` +
    `${
      ownOwner //
        ? '<font point-size="12" color="#222222">↺</font>'
        : ''
    }` +
    `    </td>` +
    `    <td width="100" align="left">` +
    `      <font point-size="10" color="#222222">${namespace}</font>` +
    `    </td>` +
    `  </tr>` +
    `  <tr>` +
    `    <td align="right" valign="top"><b>&nbsp;</b>id:</td>` +
    `    <td align="left" valign="top">` +
    `      ${branchLabel.join("<br align='left'/>")}` +
    `      <b>&nbsp;</b><br align='left'/>` +
    `    </td>` +
    `  </tr>` +
    `  <tr>` +
    `    <td align="right" valign="top"><b>&nbsp;</b>meta:</td>` +
    `    <td width="100" align="left" valign="top">` +
    `      state=${hasState()}, gen=${getGen()}<b>&nbsp;</b>` +
    `    </td>` +
    `  </tr>` +
    `</table>` +
    `</font>` +
    `>]`;
  return label.replace(/>[ ]+/g, '>').replace(/[ ]{2,}/g, ' ');
}

function buildSimpleLabel(state, branch, ownOwner, index) {
  const namespace = branch.split('@', 1)[0];
  const bgcolor = getBackgroundColor(namespace);

  const fgcolor = bgcolor.replace(/#(.{2})(.{2})(.{2})/, (_, r, g, b) => {
    const rgb = [r, g, b];
    return (
      '#' +
      rgb
        .map((c) => (parseInt(c, 16) - 16).toString(16).padStart(2, '0'))
        .join('')
    );
  });

  const label =
    `"${branch}-${index}" [` +
    `  color="${fgcolor}"` +
    `  fillcolor="${bgcolor}" ` +
    `  label=""` +
    `  xlabel=<` +
    `    <table bgcolor="white"` +
    `           border="0"` +
    `           cellpadding="1"` +
    `           cellspacing="0"` +
    `           style="rounded">` +
    `      <tr><td>${namespace}</td></tr>"` +
    `    </table>` +
    `  >` +
    `]`;
  return label.replace(/>[ ]+/g, '>').replace(/[ ]{2,}/g, ' ');
}

function generateGraph({type, layout}, state) {
  const JsonViz = require('jsonviz');
  const graphs = [];

  let index = 0;
  state.get('_subscriptions').forEach((_, sub) => {
    const graph = {
      type: 'subgraph',
      name: `cluster_${sub}`,
      graph: {
        label: sub,
        fontname: 'Helvetica',
      },
      node: {
        fontname: 'Helvetica',
        fontsize: '6',
        style: 'filled',
        fillcolor: '#ffcccc',
      },
      edge: {
        fontname: 'Helvetica',
        color: '#888888',
      },
      statements: [],
    };

    switch (type) {
      case 'simple': {
        graph.node.shape = 'circle';
        graph.node.width = 0.15;
        graph.node.height = 0.15;
        graph.node.fixedsize = true;
        graph.edge.arrowsize = '.2';
        graph.edge.penwidth = '.3';
        break;
      }
      default:
      case 'complexe': {
        graph.node.shape = 'plaintext';
        graph.edge.arrowsize = '.6';
        break;
      }
    }

    state.get(`_subscriptions.${sub}.branches`).forEach((ownership, branch) => {
      ownership = ownership.toJS();

      let ownOwner;

      const entry = (left, right) =>
        `"${left}-${index}" -> "${right}-${index}"`;

      Object.keys(ownership.children)
        .filter((child) => {
          const same = child === branch;
          if (same) {
            ownOwner = true;
            return false;
          }
          return !graph.statements.includes(entry(child, branch));
        })
        .forEach((child) => graph.statements.push(entry(child, branch)));

      Object.keys(ownership.parents)
        .filter((parent) => {
          const same = parent === branch;
          if (same) {
            ownOwner = true;
            return false;
          }
          return !graph.statements.includes(entry(branch, parent));
        })
        .forEach((parent) => graph.statements.push(entry(branch, parent)));

      const label =
        type === 'complexe'
          ? buildFullLabel(state, branch, ownOwner, index)
          : buildSimpleLabel(state, branch, ownOwner, index);

      if (!graph.statements.includes(label)) {
        graph.statements.push(label);
      }
    });
    graphs.push(new JsonViz(graph));
    ++index;
  });

  const graph = {
    name: 'Goblin Warehouse - Ownerships',
    graph: {
      rankdir: 'LR',
      splines: 'polyline',
      fontname: 'Helvetica',
      style: 'dashed',
      margin: '50',
      layout,
      dpi: '96',
      outputorder: 'edgesfirst',
    },
    statements: graphs,
  };

  if (type === 'simple') {
    graph.graph.overlap = 'scale';
  }

  return new JsonViz(graph);
}

Goblin.registerQuest(goblinName, 'graph', function* (
  quest,
  output,
  format,
  memory,
  next
) {
  const fs = require('fs');

  const state = quest.goblin.getState();
  const graphs = [];

  graphs.push({
    layout: 'fdp',
    viz: generateGraph({type: 'simple', layout: 'fdp'}, state),
  });
  graphs.push({
    layout: 'dot',
    viz: generateGraph({type: 'complexe', layout: 'dot'}, state),
  });

  const timestamp = Date.now();
  for (const {layout, viz} of graphs) {
    fs.writeFileSync(
      path.join(output, `warehouse.${timestamp}.${layout}.dot`),
      viz.dot()
    );
  }

  if (format === 'svg') {
    for (const {layout, viz} of graphs) {
      try {
        yield viz.save(
          path.join(output, `warehouse.${timestamp}.${layout}.svg`),
          {
            totalMemory: parseInt(memory) || 128e6,
          },
          next
        );
      } catch (ex) {
        quest.log.err(ex);
      }
    }
  }
});

Goblin.registerQuest(goblinName, 'sync-changes', function (quest, feed) {
  handleChanges(quest, feed);
});

Goblin.registerQuest(goblinName, 'list-feeds', function (quest) {
  const feeds = quest.goblin.getState().get('_subscriptions').keys();
  let list = [];
  for (let feed of feeds) {
    if (feed.startsWith('feed-system') || feed === 'feed-null') {
      continue;
    }
    list.push(feed);
  }
  return list;
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
