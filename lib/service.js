'use strict';

const path = require ('path');

const goblinName = path.basename (module.parent.filename, '.js');

const Goblin = require ('xcraft-core-goblin');

// Define initial logic values
const logicState = new Goblin.Shredder ({
  _subscriptions: {},
  _changes: {},
});

logicState.enableLogger ();

let changeFeeds = new Goblin.Shredder ({});
let publicChangeFeeds = new Goblin.Shredder ({});

const setLastChanges = (feed, changes) => {
  return changeFeeds.set (feed, changes);
};

const getPublicChanges = branch => {
  return publicChangeFeeds.get (branch, {});
};

const resetPropertyChanged = path => {
  return publicChangeFeeds.set (path, false);
};

const setPropertyChanged = (path, hasChanged) => {
  return publicChangeFeeds.set (path, hasChanged);
};

// Define logic handlers according rc.json
const logicHandlers = {
  upsert: (state, action) => {
    // upsert
    const newState = state.set (action.meta.branch, action.meta.data);
    //handle public changes
    const hasChanged = (oldvalue, newvalue) => {
      if (typeof newvalue === 'object') {
        return !newvalue.equals (oldvalue);
      }
      return newvalue !== oldvalue;
    };
    newState.get (`${action.meta.branch}.public`, {}).forEach ((v, k) => {
      const old = state.get ([action.meta.branch, 'public', k], null);
      publicChangeFeeds = setPropertyChanged (
        [action.meta.branch, k],
        hasChanged (old, v)
      );
      return true;
    });
    return newState;
  },
  subscribe: (state, action) => {
    return state.set (['_subscriptions', action.meta.feed], {
      branches: action.meta.branches,
      unsubscribe: null,
    });
  },
  unsubscribe: (state, action) => {
    return state.del (['_subscriptions', action.meta.feed]);
  },
  registerUnsubscribe: (state, action) => {
    return state.set (
      `_subscriptions.${action.meta.feed}.unsubscribe`,
      action.payload.func
    );
  },
};

const pc = {
  upsert: {
    mode: 'all',
  },
};
// Create a Goblin with initial state and handlers
const goblin = new Goblin (goblinName, logicState, logicHandlers, pc);

const getSubscription = (state, feedName) => {
  return state.get (['_subscriptions', feedName]);
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

  if (changeFeeds.get (feedName, {}).equals (changes)) {
    return;
  }

  changeFeeds = setLastChanges (feedName, changes);
  // notify global state on bus
  quest.evt (`${feedName}.changed`, changes);
  // change feed public
  sub.get ('branches', {}).forEach (branch => {
    const branchChanges = getPublicChanges (branch);
    branchChanges.filter (v => v).forEach ((v, k) => {
      quest.evt (`${feedName}.${k}.changed`, state.get ([branch, 'public', k]));
      publicChangeFeeds = resetPropertyChanged ([branch, k]);
      return true;
    });
    return true;
  });
};

// Register quest's according rc.json
goblin.registerQuest ('upsert', function* (quest) {
  quest.goblin.do ();
  yield quest.saveState ();
});

goblin.registerQuest ('unsubscribe', (quest, msg) => {
  const state = goblin.getState ();
  const sub = getSubscription (state, msg.data.feed);
  const unsub = sub.get ('unsubscribe');
  if (unsub) {
    unsub ();
    quest.log.info ('Unsubscribe called!');
  }
  quest.goblin.do ();
  quest.log.info ('Unsubscribe done!');
});

goblin.registerQuest ('subscribe', (quest, msg) => {
  // subscribe to store and filter
  quest.goblin.do ();
  const unsubscribe = goblin.store.subscribe (() =>
    handleChanges (quest, msg.data.feed)
  );
  quest.dispatch ('registerUnsubscribe', {func: unsubscribe});
  quest.log.info ('Subscription done!');
});

module.exports = goblin.quests;
