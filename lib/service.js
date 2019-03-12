'use strict';

const path = require('path');
const {fromJS} = require('immutable');
const diff = require('immutablediff');
const debounce = require('lodash/debounce');

const goblinName = path.basename(module.parent.filename, '.js');

const Goblin = require('xcraft-core-goblin');
const _ = require('lodash');

// Define initial logic values
const logicState = {
  _creators: {},
  _generations: {},
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

class GarbageCollector {
  constructor() {
    const busClient = require('xcraft-core-busclient').getGlobal();
    this._resp = busClient.newResponse('warehouse', 'token');
    this._collectable = {};
    this._purge = debounce(this._purgeCollectable.bind(this), 50);
  }

  _collect(state, feed, branch, list) {
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

    /* Remove the branch only when we are sure that no more feed is using it */
    const isOwn = state
      .get(`_subscriptions`)
      .some((_, feed) =>
        state.has(`_subscriptions.${feed}.branches.${branch}`)
      );
    if (!isOwn) {
      const generation = state.get(`_generations.${branch}`);
      if (!generation) {
        console.warn(`Generation is missing, it must not happend: ${branch}`);
      }

      state = state.del(branch);
      state = state.del(`_generations.${branch}`);
      this._collectable[branch] = generation;
      if (Object.keys(this._collectable).length > 0) {
        this._purge();
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

  unsubscribeBranch(state, branch, feed) {
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
          state = this._collect(state, feed, branch, list);
        }
        if (Object.keys(list[feed]).length > 0) {
          loop = true;
        }
      }
    }

    return state;
  }

  extractFeeds(state, branch) {
    const list = {};

    /* Extract all feeds where a specific branch is available */
    state
      .get(`_subscriptions`)
      .filter(s => s.hasIn(['branches', branch]))
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
  upsert: Goblin.Shredder.mutableReducer((state, action) => {
    const data = action.get('data');
    const isCreating = action.get('isCreating');
    const creator = action.get('creator');
    const branch = action.get('branch');
    const generation = action.get('generation');
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
    if (Object.keys(data).length !== 0 || !existing) {
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
    return gc.unsubscribeBranch(state, branch);
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

        const branchOwnership = gc.getOwnership(
          state,
          `_subscriptions.${feed}.branches.${branch}`
        );
        branchOwnership.parents[parent] = true;

        const parentOwnership = gc.getOwnership(
          state,
          `_subscriptions.${feed}.branches.${parent}`
        );
        parentOwnership.children[branch] = true;

        state = state
          .set(`_subscriptions.${feed}.branches.${branch}`, branchOwnership)
          .set(`_subscriptions.${feed}.branches.${parent}`, parentOwnership);
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

    const list = feed
      ? {[`feed-${feed}`]: {[branch]: true}}
      : gc.extractFeeds(state, branch);

    for (const feed in list) {
      /* Remove parents of branch */
      for (const parent of parents) {
        state = state
          .del(`_subscriptions.${feed}.branches.${branch}.parents.${parent}`)
          .del(`_subscriptions.${feed}.branches.${parent}.children.${branch}`);
      }

      if (
        state.get(`_subscriptions.${feed}.branches.${branch}.parents`).size ===
        0
      ) {
        state = gc.unsubscribeBranch(state, branch, feed);
      }
    }

    return state;
  }),
  'remove-batch': (state, action) => {
    // removing in batch
    const branches = action.get('branches');
    return state.deleteAll(branches);
  },
  subscribe: Goblin.Shredder.mutableReducer((state, action) => {
    const feed = action.get('feed');

    action.get('branches').forEach(branch => {
      const update = gc.updateOwnership(state, branch, [branch], [feed]);
      state = update.state;
      if (!update.collected && !state.has(branch)) {
        state = state.set(branch, {id: branch});
      }
    });

    return state;
  }),
  'feed-subscription-add': (state, action) => {
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

  const changes = state.filter((_, key) => sub.has(`branches.${key}`));

  if (changeFeeds.get(feed, {}).equals(changes)) {
    return;
  }

  changeFeeds = setLastChanges(feed, changes);

  // notify global state on bus
  quest.evt(`${feed}.changed`, computePatch(feed, changes.state));

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

Goblin.registerQuest(goblinName, 'get-creator', function(quest, branch, $msg) {
  _check(quest, $msg);
  return quest.goblin.getState().get(`_creators.${branch}`);
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

Goblin.registerQuest(goblinName, 'attach-to-parents', function(
  quest,
  branch,
  generation,
  parents,
  feeds,
  $msg
) {
  _check(quest, $msg);
  quest.do();
  return quest.goblin.getState().has(branch);
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

Goblin.registerQuest(goblinName, 'feed-subscription-add', function(
  quest,
  feeds,
  branch,
  $msg
) {
  _check(quest, $msg);

  if (!Array.isArray(feeds)) {
    feeds = [feeds];
  }

  for (const feed of feeds) {
    const sub = getSubscription(quest.goblin.getState(), feed);
    if (!sub) {
      quest.log.warn(`Unavailable feed '${feed}', it looks like a bug`);
      continue;
    }
    if (sub.has(`branches.${branch}`)) {
      continue;
    }
    quest.do({feed, branch});
  }

  return true;
});

Goblin.registerQuest(goblinName, 'feed-subscription-del', function(
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
  quest.dispatch('detach-from-parents', {branch, parents});
  return true;
});

Goblin.registerQuest(goblinName, 'del-creator', function(quest, branch, $msg) {
  _check(quest, $msg);
  quest.do();
  quest.dispatch('detach-from-parents', {branch, parents: ['new']});
});

Goblin.registerQuest(goblinName, 'detach-from-parents', function(
  quest,
  branch,
  parents,
  feed,
  $msg
) {
  _check(quest, $msg);
  quest.do();
});

Goblin.registerQuest(goblinName, 'release', function*(quest, branch, $msg) {
  _check(quest, $msg);
  yield quest.me.removeBatch({branches: [branch]});
  quest.evt('released', [branch]);
});

Goblin.registerQuest(goblinName, 'status', function(quest) {
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

Goblin.registerQuest(goblinName, 'graph', function(quest, output) {
  const JsonViz = require('jsonviz');
  const fs = require('fs');

  const state = quest.goblin.getState();
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
      statements: [],
    };

    state.get(`_subscriptions.${sub}.branches`).forEach((ownership, branch) => {
      ownership = ownership.toJS();

      const branchLabel = branch.match(/.{1,40}/g);
      const label =
        `"${branch}-${index}" [label=<${branch.split('@')[0]}<br/>` +
        `<font point-size='6' color='#999999'><br align='left'/>` +
        `${branchLabel.join("<br align='left'/>")}<br align='left'/>` +
        `</font>> shape=Mrecord fontname=Helvetica]`;

      if (!graph.statements.includes(label)) {
        graph.statements.push(label);
      }

      const entry = (left, right) =>
        `"${left}-${index}" -> "${right}-${index}" [color="#999999", arrowsize=.6]`;

      Object.keys(ownership.children)
        .filter(child => !graph.statements.includes(entry(child, branch)))
        .forEach(child => graph.statements.push(entry(child, branch)));

      Object.keys(ownership.parents)
        .filter(parent => !graph.statements.includes(entry(branch, parent)))
        .forEach(parent => graph.statements.push(entry(branch, parent)));
    });
    graphs.push(new JsonViz(graph));
    ++index;
  });

  const viz = new JsonViz({
    name: 'Goblin Warehouse - Ownerships',
    graph: {
      rankdir: 'LR',
      splines: 'polyline',
      fontname: 'Helvetica',
      style: 'dashed',
      margin: '50',
    },
    statements: graphs,
  });

  const timestamp = Date.now();
  viz.save(path.join(output, `warehouse.${timestamp}.svg`));
  fs.writeFileSync(path.join(output, `warehouse.${timestamp}.dot`), viz.dot());
});

Goblin.registerQuest(goblinName, 'sync-changes', function(quest, feed) {
  handleChanges(quest, feed);
});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
Goblin.createSingle(goblinName);
