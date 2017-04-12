'use strict';

const path       = require ('path');
const {fromJS}   = require ('immutable');

const goblinName = path.basename (module.parent.filename, '.js');

const Goblin = require ('xcraft-core-goblin');

// Define initial logic values
const logicState = fromJS ({
  _subscriptions: {}
});

// Define logic handlers according rc.json
const logicHandlers = {
  upsert: (state, action) => {
    return state.set (action.meta.branch, action.meta.data);
  },
  subscribe: (state, action) => {
    return state.setIn (['_subscriptions', action.meta.feed], {
      lastChanges: null,
      branches: action.meta.branches,
      unsubscribe: null
    });
  },
  unsubscribe: (state, action) => {
    return state.delete (['_subscriptions', action.meta.feed]);
  },
  registerUnsubscribe: (state, action) => {
    return state.updateIn (['_subscriptions', action.meta.feed], {
      unsubscribe: action.func
    });
  },
  setLastChanges: (state, action) => {
    return state.updateIn (['_subscriptions', action.meta.feed], {
      lastChanges: action.changes
    });
  }
};

// Create a Goblin with initial state and handlers
const goblin = new Goblin (goblinName, logicState, logicHandlers);

const getSubscription = (state, feedName) => {
  return state.getIn (['_subscriptions', feedName]);
};

const handleChanges = (quest, feedName) => {
  const state = goblin.store.getState ();
  const sub = getSubscription (state, feedName);
  const changes = state.filter ((branch) => sub.branches.hasProperty (branch));
  if (sub.lastChanges !== changes) {
    quest.dispatch ({type: 'setLastChanges', changes: changes});
    //Notify on bus
    quest.log.info ('Notify changes!');
    quest.evt (`${feedName}.changed`, changes);
  }
};

// Register quest's according rc.json
goblin.registerQuest ('upsert', quest => {
  quest.do ();
  quest.log.info ('Upsert done!');
});

goblin.registerQuest ('unsubscribe', (quest, msg) => {
  const state = goblin.store.getState ();
  const sub = getSubscription (state, msg.data.feed);
  if (sub.unsubscribe) {
    sub.unsubscribe ();
  }
  quest.do ();
  quest.log.info ('Unsubscribe done!');
});

goblin.registerQuest ('subscribe', (quest, msg) => {
  // subscribe to store and filter
  const unsubscribe = goblin.store.subscribe (() => handleChanges (quest, msg.data.feed));
  quest.dispatch ({type: 'registerUnsubscribe', func: unsubscribe});
  quest.log.info ('Subscription done!');
});

module.exports = goblin.quests;
