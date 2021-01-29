'use strict';

const goblinName = 'warehouse-explorer';
const Goblin = require('xcraft-core-goblin');

// Define initial logic values
const logicState = {};

const buildLink = (source, target, lbl) => ({
  data: {id: source + `${lbl}->` + target, source, target, label: lbl},
});

const buildNode = (id, label, x, y) => {
  return {
    data: {id, label},
    position: {x, y},
  };
};

// Define logic handlers according rc.json
const logicHandlers = {
  create: (state, action) => {
    return state.set('', {
      id: action.get('id'),
      subs: action.get('subs'),
      sub: null,
      elements: [],
      tree1: {},
      tree2: {},
      dangling: null,
      orphan: null,
    });
  },
  check: (state, action) => {
    return state
      .set('dangling', action.get('dangling'))
      .set('orphan', action.get('orphan'));
  },
  explore: (state, action) => {
    const sub = action.get('sub');
    if (sub) {
      state = state.set('sub', sub);
    }
    const tree = action.get('tree');
    const nodes = [];
    const links = [];

    const feedNode = {};
    Array.from(tree.get('branches').keys()).forEach((id) => {
      feedNode[id] = id;
      nodes.push(buildNode(id, id.split('@')[0], 1, 1));
    });

    Array.from(tree.get('branches').entries()).forEach(([key, value]) => {
      const parents = value.get('parents');
      const children = value.get('children');

      for (const id of parents.keys()) {
        if (!feedNode[id]) {
          feedNode[id] = id;
          nodes.push(buildNode(id, `NOT IN FEED: ${id.split('@')[0]}`, 1, 1));
        }
        links.push(buildLink(id, key, 'parent'));
      }
      for (const id of children.keys()) {
        if (!feedNode[id]) {
          feedNode[id] = id;
          nodes.push(buildNode(id, `NOT IN FEED: ${id}`, 1, 1));
        }
        links.push(buildLink(key, id, 'child'));
      }
    });

    return state.set('tree1', tree).set('elements', nodes.concat(links));
  },
};

Goblin.registerQuest(goblinName, 'create', function* (quest, desktopId) {
  const subs = yield quest.warehouse.get({path: '_subscriptions'});
  quest.do({subs: Array.from(subs.keys())});
  return quest.goblin.id;
});

Goblin.registerQuest(goblinName, 'explore', function* (quest, type, value) {
  switch (type) {
    case 'sub':
      {
        const tree = yield quest.warehouse.get({
          path: `_subscriptions.${value}`,
        });
        quest.do({sub: value, tree});
      }
      break;
  }
});

Goblin.registerQuest(goblinName, 'check', function* (quest) {
  const dangling = yield quest.warehouse.checkDangling();
  const orphan = yield quest.warehouse.checkOrphan();
  quest.do({dangling, orphan});
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {});

// Singleton
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
