'use strict';

const path = require ('path');
const {fromJS} = require ('immutable');

const goblinName = path.basename (module.parent.filename, '.js');

const Goblin = require ('xcraft-core-goblin');

// Define initial logic values
const logicState = fromJS ({
  _subscriptions: {},
  _changes: {},
});

let changeFeeds = fromJS ({});
let publicChangeFeeds = fromJS ({});

const setLastChanges = (feed, changes) => {
  return changeFeeds.set (feed, changes);
};

const getPublicChanges = branch => {
  return publicChangeFeeds.getIn ([branch]);
};

const resetPropertyChanged = path => {
  return publicChangeFeeds.setIn (path, false);
};

const setPropertyChanged = (path, hasChanged) => {
  return publicChangeFeeds.setIn (path, hasChanged);
};

// Define logic handlers according rc.json
const logicHandlers = {
  upsert: (state, action) => {
    // upsert
    const newState = state.set (action.meta.branch, fromJS (action.meta.data));
    //handle public changes
    const hasChanged = (oldvalue, newvalue) => {
      if (typeof newvalue === 'object') {
        return !newvalue.equals (oldvalue);
      }
      return newvalue !== oldvalue;
    };
    newState
      .getIn ([action.meta.branch, 'public'], fromJS ({}))
      .forEach ((v, k) => {
        const old = state.getIn ([action.meta.branch, 'public', k], null);
        publicChangeFeeds = setPropertyChanged (
          [action.meta.branch, k],
          hasChanged (old, v)
        );
        return true;
      });
    return newState;
  },
  subscribe: (state, action) => {
    return state.setIn (
      ['_subscriptions', action.meta.feed],
      fromJS ({
        branches: action.meta.branches,
        unsubscribe: null,
      })
    );
  },
  unsubscribe: (state, action) => {
    return state.deleteIn (['_subscriptions', action.meta.feed]);
  },
  registerUnsubscribe: (state, action) => {
    console.dir ('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    return state.setIn (
      ['_subscriptions', action.meta.feed, 'unsubscribe'],
      action.func
    );
  },
};

// Create a Goblin with initial state and handlers
const goblin = new Goblin (goblinName, logicState, logicHandlers);

const getSubscription = (state, feedName) => {
  return state.getIn (['_subscriptions', feedName]);
};

const handleChanges = (quest, feedName) => {
  const state = goblin.getState ();
  // quest.log.info (`handle changes for state:\n ${JSON.stringify (state.toJS (), null, 2)}`);
  const sub = getSubscription (state, feedName);
  if (!sub) {
    return;
  }
  const changes = state.filter ((v, key) => {
    return sub.get ('branches').includes (key);
  });

  if (changeFeeds.get (feedName, fromJS ({})).equals (changes)) {
    quest.log.info (`Nothing!`);
    return;
  }

  changeFeeds = setLastChanges (feedName, changes);
  // notify global state on bus
  quest.evt (`${feedName}.changed`, changes);
  quest.log.verb (`${feedName}.changed`);
  // change feed public
  sub.get ('branches').forEach (branch => {
    const branchChanges = getPublicChanges (branch);
    branchChanges.filter (v => v).forEach ((v, k) => {
      quest.evt (`${feedName}.${k}.changed`, v);
      quest.log.verb (`${feedName}.${k}.changed`);
      publicChangeFeeds = resetPropertyChanged ([branch, k]);
      return true;
    });
    return true;
  });
};

// Register quest's according rc.json
goblin.registerQuest ('upsert', quest => {
  quest.goblin.do ();
  const state = goblin.getState ();
  quest.log.info (`${JSON.stringify (state.toJS (), null, 2)}`);
});

goblin.registerQuest ('unsubscribe', (quest, msg) => {
  let state = goblin.getState ();
  const sub = getSubscription (state, msg.data.feed);
  const unsub = sub.get ('unsubscribe');
  if (unsub) {
    unsub ();
  }
  quest.goblin.do ();
  quest.log.info ('Unsubscribe done!');
  state = goblin.getState ();
  quest.log.info (`${JSON.stringify (state.toJS (), null, 2)}`);
});

goblin.registerQuest ('subscribe', (quest, msg) => {
  // subscribe to store and filter
  quest.goblin.do ();
  const unsubscribe = goblin.store.subscribe (() =>
    handleChanges (quest, msg.data.feed)
  );
  quest.dispatch ('registerUnsubscribe', {func: unsubscribe});
  quest.log.info ('Subscription done!');
  const state = goblin.getState ();
  quest.log.info (`${JSON.stringify (state.toJS (), null, 2)}`);
});

module.exports = goblin.quests;
