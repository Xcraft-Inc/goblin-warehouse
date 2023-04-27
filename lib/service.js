'use strict';

const path = require('path');
const goblinName = path.basename(module.parent.filename, '.js');

const diff = require('xcraft-immutablediff');
const Goblin = require('xcraft-core-goblin');
const {regex, MapAggregator} = require('xcraft-core-utils');
const GarbageCollector = require('./garbageCollector.js');
const {generateGraph} = require('./dotHelpers.js');

// Define initial logic values
const logicState = {
  _creators: {},
  _generations: {},
  _subscriptions: {},
  _patchFeeds: {},
  _maintenance: {},
  _lines: {},
  _linesNotifyPayload: true,
  _feedsAggregator: null,
};

const previousBranchStates = {};
let changeFeeds = new Goblin.Shredder({});

function feedDispose(feed) {
  delete previousBranchStates[feed];
  changeFeeds = changeFeeds.del(feed);
}

const gc = new GarbageCollector(feedDispose);

// Define logic handlers according rc.json
const logicHandlers = {
  '_init': (state, action) =>
    state.set('_feedsAggregator', action.get('feedsAggregator')),
  'maintenance': (state, action) =>
    state
      .set('_maintenance.enable', action.get('enable'))
      .set('_maintenance.description', action.get('description'))
      .set('_maintenance.orcName', action.get('orcName')),
  'upsert': Goblin.Shredder.mutableReducer((state, action, immState) => {
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
        `Skipped upsert for ${branch} (generation ${generation}), the goblin is away from warehouse, deleted, or not totally created...`
      );
      return state;
    }

    if (!feeds.length) {
      feeds = ['system'];
    }

    const update = gc.updateOwnership(
      state,
      immState,
      branch,
      parents,
      feeds,
      isCreating,
      creator
    );
    if (update.collected) {
      return update.state;
    }

    let newState = update.state;

    const patchFeeds = gc.extractPatchFeeds(state, branch);
    const feedsAggregator = state.get('_feedsAggregator');
    const aggregatorPut = () =>
      patchFeeds.forEach((feed) => feedsAggregator.put([feed, branch], true));

    //update data only with some!
    if (Object.keys(data).length !== 0 || !immState.has(branch)) {
      newState = newState.set(branch, data);
      aggregatorPut(data); /* add / change */
    }

    if (!newState.get([branch, 'id'])) {
      newState = newState.set([branch, 'id'], branch);
      aggregatorPut(data); /* add  */
    }
    if (!newState.get(['_generations', branch]) && generation) {
      newState = newState.set(['_generations', branch], generation);
    }

    return newState;
  }),
  'delete-branch': Goblin.Shredder.mutableReducer((state, action) => {
    const branch = action.get('branch');
    const autoRelease = branch.startsWith('goblin-orc@');
    return gc.unsubscribeBranch(state, branch, null, autoRelease);
  }),
  'attach-to-parents': (state, action) => {
    const origState = state;
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
    const view = action.get('view');

    let list = {};

    if (feeds) {
      for (const feed of feeds) {
        list[feed] = {[branch]: true};
      }
    } else {
      list = gc.extractFeeds(state, branch);
    }

    const feedsAggregator = state.get('_feedsAggregator');

    try {
      for (const feed in list) {
        for (const parent of parents) {
          if (
            state.has([
              '_subscriptions',
              feed,
              'branches',
              branch,
              'parents',
              parent,
            ])
          ) {
            continue;
          }

          let parentOwnership = gc.getOwnership(state, [
            '_subscriptions',
            feed,
            'branches',
            parent,
          ]);

          if (
            parent.indexOf('@') >= 0 && // not a singleton
            !/^goblin-cache@/.test(parent) && // not related to the cache
            parent !== branch && // not a self attach
            parentOwnership.get('parents').size === 0
          ) {
            console.warn(
              `Attach impossible because the parent ${parent} is missing for the branch ${branch} (generation ${generation}) in the feed ${feed}`
            );
            state = origState;
            break;
          }

          let branchOwnership = gc.getOwnership(state, [
            '_subscriptions',
            feed,
            'branches',
            branch,
          ]);
          branchOwnership = branchOwnership.set(['parents', parent], true);

          state = state.set(
            ['_subscriptions', feed, 'branches', branch],
            branchOwnership
          );

          if (gc.inPatchFeed(state, feed, branch)) {
            feedsAggregator.put([feed, branch], true);
          }

          /* Orphan in this feed, but exists elsewhere */
          if (parentOwnership.get('parents').size) {
            if (!gc.inFeeds(state, parent)) {
              console.err(
                `this parent "${parent}" should be at least in one feed, but it's lost into the abyss`
              );
            }

            parentOwnership = parentOwnership.set(['children', branch], true);

            state = state.set(
              ['_subscriptions', feed, 'branches', parent],
              parentOwnership
            );
          }
        }

        if (view && state.has(['_subscriptions', feed, 'branches', branch])) {
          state = state.set(['_subscriptions', feed, 'views', branch], view);
        }
      }
    } finally {
      if (generation) {
        state = state.set(['_generations', branch], generation);
      }
    }

    return state;
  },
  'del-creator': (state, action) => {
    return state.del(['_creators', action.get('branch')]);
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
      ? {[feed]: {[branch]: true}}
      : feeds || gc.extractFeeds(state, branch);

    for (const feed in list) {
      if (!state.has(['_subscriptions', feed, 'branches', branch, 'parents'])) {
        continue;
      }

      /* Remove parents of branch */
      for (const parent of parents) {
        if (parent.indexOf('*') !== -1) {
          const r = new RegExp(regex.toXcraftRegExpStr(parent));
          state
            .get(['_subscriptions', feed, 'branches'])
            .forEach((_, branch) => {
              if (r.test(branch)) {
                parents.push(branch);
              }
            });
          continue;
        }

        /* prettier-ignore */
        state = state
          .del(['_subscriptions', feed, 'branches', branch, 'parents', parent])
          .del(['_subscriptions', feed, 'branches', parent, 'children', branch]);
      }

      if (
        state.get(['_subscriptions', feed, 'branches', branch, 'parents'])
          .size === 0
      ) {
        const autoRelease = branch.startsWith('goblin-orc@');
        state = gc.unsubscribeBranch(state, branch, feed, autoRelease);
      }
    }

    return state;
  }),
  'graft': Goblin.Shredder.mutableReducer((state, action) => {
    const branch = action.get('branch');
    const fromFeed = action.get('fromFeed');
    const toFeed = action.get('toFeed');

    const graft = (state, branch) => {
      if (!state.has(['_subscriptions', fromFeed, 'branches', branch])) {
        return state;
      }
      const branchState = state
        .get(['_subscriptions', fromFeed, 'branches', branch])
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
    if (generation === state.get(['_generations', branch])) {
      return state.del(branch).del(['_generations', branch]);
    }
    return state;
  },
  'remove-batch': Goblin.Shredder.mutableReducer((state, action) => {
    const branches = action.get('branches');
    for (const branch of branches) {
      state.del(['_generations', branch]);
    }
    state.deleteAll(branches);
  }),
  'subscribe': Goblin.Shredder.mutableReducer((state, action, immState) => {
    const feed = action.get('feed');

    state.set(['_patchFeeds', feed], true);

    action.get('branches').forEach((branch) => {
      const update = gc.updateOwnership(
        state,
        immState,
        branch,
        [branch],
        [feed]
      );
      state = update.state;
      if (!update.collected && !state.has(branch)) {
        state = state.set(branch, {id: branch});
      }
    });

    return state;
  }),
  'unsubscribe': Goblin.Shredder.mutableReducer((state, action) => {
    const feed = action.get('feed');

    state.del(['_patchFeeds', feed]);

    if (!state.has(['_subscriptions', feed])) {
      return state;
    }

    const branches = state.get(['_subscriptions', feed, 'branches']);
    branches
      .sortBy((_, branch) => (branch.startsWith('goblin-orc@') ? -1 : 0))
      .forEach((_, branch) => {
        if (state.has(['_subscriptions', feed, 'branches', branch])) {
          const autoRelease = branch.startsWith('goblin-orc@');
          state = gc.unsubscribeBranch(state, branch, feed, autoRelease);
        }
      });

    return state.del(['_subscriptions', feed]);
  }),
  'request-line-update': (s, action) => {
    const type = action.get('type');
    const lineId = action.get('lineId');
    const orcName = action.get('orcName');
    const token = action.get('token');

    const p = ['_lines', lineId, `${orcName}$${token}`];
    let cnt = s.state.getIn(p, 0);
    let send = false;

    switch (type) {
      case 'add':
        if (cnt === 0) {
          send = true;
        }
        ++cnt;
        s.state = s.state.setIn(p, cnt);
        break;

      case 'delete':
        if (cnt === 1) {
          send = true;
          s.state = s.state.deleteIn(p);
          break;
        }
        --cnt;
        s.state = s.state.setIn(p, cnt);
        break;

      default:
        break;
    }

    return s.set('_linesNotifyPayload', send);
  },
};

/*****************************************************************************/

const getViewState = (view, state) => {
  if (view.has('with')) {
    return new Goblin.Shredder({id: state.get('id')}).withMutations((n) => {
      view.get('with').forEach((p) => n.set(p, state.get(p)));
    });
  }
  if (view.has('without')) {
    return state.withMutations((s) => {
      view.get('without').forEach((p) => s.has(p) && s.del(p));
    });
  }
  return state;
};

/* Filter the warehouse state with only the branches of our feed */
const getChanges = (state, sub) =>
  new Goblin.Shredder().withMutations((changes) => {
    for (const branch of sub.get('branches').keys()) {
      changes.set(branch, getBranchChanges(state, sub, branch));
    }
  });

const getBranchChanges = (state, sub, branch) => {
  const hasView = sub.has(['views', branch]);
  const branchState = state.get(branch);
  if (!branchState) {
    return new Goblin.Shredder();
  }
  if (hasView) {
    const view = sub.get(['views', branch]);
    return getViewState(view, branchState);
  }
  return branchState;
};

const getNextBranchGeneration = (feed) => {
  return previousBranchStates[feed]
    ? previousBranchStates[feed]._generation + 1
    : 0;
};

const computeBranchPatch = (feed, branch, state) => {
  const patch = !!previousBranchStates[feed]?.[branch];
  const newState = patch
    ? diff(previousBranchStates[feed][branch].state, state)
    : diff(null, state);

  if (!previousBranchStates[feed]) {
    previousBranchStates[feed] = {};
  }
  previousBranchStates[feed][branch] = state;

  return newState;
};

const handleFeedChanges = async (state, feed, branches, evt) => {
  const sub = state.get(['_subscriptions', feed]);
  const patch = !!previousBranchStates?.[feed];

  /* Send the whole feed state */
  if (!patch) {
    const generation = getNextBranchGeneration(feed);
    previousBranchStates[feed] = {_generation: generation};
    const changes = getChanges(state, sub);
    evt(`<${feed}>.changed`, {
      state: changes.state,
      generation,
      _xcraftPatch: false,
    });
    return;
  }

  /* Send patches for the branches (subset) */
  let empty = true;
  const patches = {};
  for (const branch in branches) {
    const exists = branches[branch];
    if (exists) {
      /* add or update */
      const change = getBranchChanges(state, sub, branch);
      const changeFeed = changeFeeds.get([feed, branch]);
      if (!changeFeed || !changeFeeds.get([feed, branch]).equals(change)) {
        changeFeeds = changeFeeds.set([feed, branch], change);
        patches[branch] = computeBranchPatch(feed, branch, change.state);
        empty = false;
      }
    } else {
      /* delete */
      changeFeeds = changeFeeds.del([feed, branch]);
      delete previousBranchStates[feed][branch];
      patches[branch] = false;
      empty = false;
    }
  }

  if (empty) {
    return;
  }

  const generation = getNextBranchGeneration(feed);
  previousBranchStates[feed]._generation = generation;
  evt(`<${feed}>.changed`, {patches, generation, _xcraftPatch: true});
};

const handleChanges = async (quest, feeds, resp) => {
  const state = quest.goblin.getState();

  const evt = (topic, ...args) =>
    resp.events.send(`${goblinName}.${topic}`, ...args);

  for (const feed in feeds) {
    await handleFeedChanges(state, feed, feeds[feed], evt);
  }
};

function listFeeds(quest) {
  const feeds = quest.goblin.getState().get('_subscriptions').keys();
  let list = [];
  for (const feed of feeds) {
    if (feed.startsWith('system') || feed === 'null') {
      continue;
    }
    list.push(feed);
  }
  return list;
}

/*****************************************************************************/

function _check(quest, msg) {
  const state = quest.goblin.getState();
  const enable = state.get('_maintenance.enable', false);
  if (enable) {
    const orcName = state.get('_maintenance.orcName');
    if (orcName !== msg.orcName)
      throw new Error(state.get('_maintenance.description'));
  }
}

/*****************************************************************************/

Goblin.registerQuest(goblinName, '_init', function (quest) {
  quest.sub.local(
    '*::<warehouse-changes>',
    async (err, {msg, resp}) => await handleChanges(quest, msg.data, resp)
  );

  const onCollect = (collected, resp) =>
    setImmediate(() => resp.events.send('<warehouse-changes>', collected));

  const feedsAggregator = new MapAggregator(quest.newResponse(), 50, onCollect);
  quest.do({feedsAggregator});
});

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
  quest.do();
});

Goblin.registerQuest(goblinName, 'get-creator', function (quest, branch, $msg) {
  _check(quest, $msg);
  return quest.goblin.getState().get(['_creators', branch]);
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
  view,
  $msg
) {
  _check(quest, $msg);
  const origState = quest.goblin.getState();
  let isAttached = false;
  if (!Array.isArray(feeds)) {
    feeds = [feeds];
  }
  if (origState.has(branch)) {
    isAttached = feeds.every((feed) => gc.inFeed(origState, feed, branch));
  }
  quest.do();
  const newState = quest.goblin.getState();
  if (!isAttached) {
    isAttached = feeds.every((feed) => gc.inFeed(newState, feed, branch));
  }
  if (!isAttached && newState.has(branch) && !gc.inFeeds(newState, branch)) {
    quest.dispatch('remove-batch', {
      branches: [branch],
    });
  }
  return isAttached;
});

Goblin.registerQuest(goblinName, 'has', function (quest, path, $msg) {
  _check(quest, $msg);
  return path ? quest.goblin.getState().has(path) : false;
});

Goblin.registerQuest(goblinName, 'hasFeed', function (quest, feedName, $msg) {
  _check(quest, $msg);
  return feedName
    ? quest.goblin.getState().has(['_subscriptions', feedName])
    : false;
});

Goblin.registerQuest(goblinName, 'get', function (quest, path, view, $msg) {
  _check(quest, $msg);
  if (!path) {
    return null;
  }
  if (!view) {
    return quest.goblin.getState().get(path, null);
  }

  const state = quest.goblin.getState().get(path, null);
  return state ? Goblin.Shredder.pluck(state, view) : null;
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
    if (filters && filters.some((filter) => feed.startsWith(filter))) {
      continue;
    }
    if (sub.get('branches').has(branch)) {
      feeds.push(feed);
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
    const sub = state.get(['_subscriptions', feed]);
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
  const sub = state.get(['_subscriptions', feed]);
  if (!sub) {
    return;
  }

  const changes = getChanges(state, sub);
  const generation = getNextBranchGeneration(feed);
  if (!previousBranchStates[feed]) {
    previousBranchStates[feed] = {};
  }
  previousBranchStates[feed]._generation = generation;
  quest.evt(`<${feed}>.changed`, {
    state: changes.state,
    generation,
    _xcraftPatch: false,
  });
});

function unsubscribe(quest, feed, $msg) {
  _check(quest, $msg);
  const state = quest.goblin.getState();
  const sub = state.get(['_subscriptions', feed]);
  if (!sub) {
    quest.log.warn(`Unavailable feed '${feed}', it looks like a bug`);
  }
  quest.dispatch('unsubscribe', {feed});
  feedDispose(feed);
  quest.evt('<feed-subscriptions-changed>', {feeds: listFeeds(quest)});
}
Goblin.registerQuest(goblinName, 'unsubscribe', unsubscribe);

Goblin.registerQuest(goblinName, 'subscribe', function (
  quest,
  feed,
  branches,
  $msg
) {
  _check(quest, $msg);
  quest.do();
  quest.evt('<feed-subscriptions-changed>', {feeds: listFeeds(quest)});
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
  const state = quest.goblin.getState();
  const sub = state.get(['_subscriptions', feed]);
  if (!sub || !sub.has(['branches', branch])) {
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
    ? {[feed]: {[branch]: true}}
    : gc.extractFeeds(state, branch);

  /* Look if the feed branch name contents a branch with the same name */
  const feedbranches = [];
  for (const feed in feeds) {
    if (state.has(['_subscriptions', feed, 'branches', feed])) {
      feedbranches.push(feed);
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
    if (!state.has(['_subscriptions', feedBranch, 'branches', feedBranch])) {
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

Goblin.registerQuest(goblinName, 'request-line-update', function (
  quest,
  type,
  lineId,
  orcName,
  token,
  generation
) {
  quest.do();
  const withPayload = quest.goblin.getState().get('_linesNotifyPayload');
  quest.evt('lines-updated', {
    lines: withPayload ? quest.goblin.getState().get('_lines') : null,
    token,
    generation,
  });
  return quest.fireAndForget();
});

Goblin.registerQuest(goblinName, 'checkOrphan', function (quest) {
  const state = quest.goblin.getState();
  const subscriptions = state.get('_subscriptions');
  const list = [];

  subscriptions.forEach((_, sub) => {
    const branches = state.get(['_subscriptions', sub, 'branches']);
    branches.forEach((ownership, branch) => {
      const parents = ownership.get('parents');
      parents
        .map((_, parent) => parent)
        .filter((parent) => parent !== 'new' && !state.has(parent))
        .forEach((parent) => {
          list.push({subscription: sub, branch, parent});
        });
    });
  });

  return list;
});

Goblin.registerQuest(goblinName, 'checkDangling', function (quest) {
  const state = quest.goblin.getState();
  const subscriptions = state.get('_subscriptions');
  const list = [];

  state
    .map((_, branch) => branch)
    .filter((branch) => branch[0] !== '_')
    .forEach((branch) => {
      const inFeed = subscriptions.some((s) => s.hasIn(['branches', branch]));
      if (!inFeed) {
        list.push({branch});
      }
    });

  return list;
});

Goblin.registerQuest(goblinName, 'check', function* (quest) {
  quest.log.info('>>> Begin check for orphan branches in feeds');
  const orphan = yield quest.me.checkOrphan();
  orphan.forEach(({subscription, branch, parent}) => {
    quest.log.warn(
      `  - subscription: ${subscription}\n` +
        `    [leak] missing parent '${parent}'\n` +
        `           for '${branch}'\n` +
        `           it's probably a bad practice where creates are crossed between feeds`
    );
  });
  if (orphan.length === 0) {
    quest.log.info('    No leak detected');
  }
  quest.log.info(`<<< Check done`);

  quest.log.info(
    '>>> Begin check for dangling branches in the warehouse state'
  );
  const dangling = yield quest.me.checkDangling();
  dangling.forEach(({branch}) => {
    quest.log.warn(`    [leak] dangling branch '${branch}'`);
  });
  if (dangling.length === 0) {
    quest.log.info('    No leak detected');
  }
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

Goblin.registerQuest(goblinName, 'syncChanges', async (quest, feed) => {
  const state = quest.goblin.getState();
  if (!state.has(['_patchFeeds', feed])) {
    quest.log.warn(
      `You cannot sync changes to the ${feed} feed without subscriptions`
    );
    return;
  }
  const feedsAggregator = state.get('_feedsAggregator');
  feedsAggregator.release();
});

Goblin.registerQuest(goblinName, 'listFeeds', async (quest) => {
  return listFeeds(quest);
});

/*****************************************************************************/

const getMetrics = function (goblin) {
  const metrics = {};
  const state = goblin.getState();
  for (const [feed, subs] of state.get('_subscriptions').entries()) {
    metrics[feed] = {labels: {feed}, total: subs.get('branches').size};
  }
  metrics['entries.total'] = state.size;
  return metrics;
};

function* _postload(msg, resp, next) {
  try {
    yield resp.command.send(`${goblinName}._init`, null, next);
    resp.events.send(`${goblinName}._postload.${msg.id}.finished`);
  } catch (ex) {
    resp.events.send(`${goblinName}._postload.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
}

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers, {
  getMetrics,
});
module.exports.handlers._postload = _postload;
Goblin.createSingle(goblinName);
