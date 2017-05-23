'use strict';

const path = require ('path');

const goblinName = path.basename (module.parent.filename, '.js');

const Goblin = require ('xcraft-core-goblin');
const transit = require ('transit-immutable-js');
// Define initial logic values
const logicState = {
  _subscriptions: {},
  _changes: {},
};

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
    const newState = state.set (action.get ('branch'), action.get ('data'));
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
    return state.set (
      ['_subscriptions', action.get ('feed'), 'branches'],
      action.get ('branches')
    );
  },
  'feed.add': (state, action) => {
    const branches = state.get ([
      '_subscriptions',
      action.get ('feed'),
      'branches',
    ]);
    const newBranches = branches.push (action.get ('branch'));
    return state.set (
      ['_subscriptions', action.get ('feed'), 'branches'],
      newBranches
    );
  },
  'feed.del': (state, action) => {
    const branches = state.get ([
      '_subscriptions',
      action.get ('feed'),
      'branches',
    ]);
    const newBranches = branches.unpush (action.get ('branch'));
    return state.set (
      ['_subscriptions', action.get ('feed'), 'branches'],
      newBranches
    );
  },
  unsubscribe: (state, action) => {
    return state.del (['_subscriptions', action.meta.feed]);
  },
  registerUnsubscribe: (state, action) => {
    return state.set (
      `_subscriptions.${action.get ('feed')}.unsubscribe`,
      action.payload.func
    );
  },
};

const getSubscription = (state, feed) => {
  return state.get (['_subscriptions', feed]);
};

const handleChanges = (quest, feed) => {
  const state = quest.goblin.getState ();
  // quest.log.info (`handle changes for state:\n ${JSON.stringify (state.toJS (), null, 2)}`);
  const sub = getSubscription (state, feed);
  if (!sub) {
    return;
  }
  const changes = state.filter ((v, key) => {
    return sub.get ('branches').includes (key);
  });

  if (changeFeeds.get (feed, {}).equals (changes)) {
    return;
  }

  changeFeeds = setLastChanges (feed, changes);
  // notify global state on bus
  const payload = transit.toJSON (changes.state);
  quest.evt (`${feed}.changed`, payload);

  // change feed public
  sub.get ('branches', {}).forEach (branch => {
    const branchChanges = getPublicChanges (branch);
    branchChanges.filter (v => v).forEach ((v, k) => {
      quest.evt (
        `${feed}.${k}.changed`,
        state.get ([branch, 'public', k]).state
      );
      publicChangeFeeds = resetPropertyChanged ([branch, k]);
      return true;
    });
    return true;
  });
};

// Register quest's according rc.json
Goblin.registerQuest (goblinName, 'save', function* (quest) {
  yield quest.saveState ();
});

Goblin.registerQuest (goblinName, 'load', function* (quest) {
  yield quest.loadState ();
});

Goblin.registerQuest (goblinName, 'upsert', quest => {
  quest.do ();
});

Goblin.registerQuest (goblinName, 'resend', (quest, msg) => {
  const state = quest.goblin.getState ();
  const feed = msg.get ('feed');
  const sub = getSubscription (state, feed);
  if (!sub) {
    return;
  }
  const changes = state.filter ((v, key) => {
    return sub.get ('branches').includes (key);
  });

  const payload = transit.toJSON (changes.state);
  quest.evt (`${feed}.changed`, payload);
});

Goblin.registerQuest (goblinName, 'unsubscribe', (quest, msg) => {
  const state = quest.goblin.getState ();
  const sub = getSubscription (state, msg.get ('feed'));
  const unsub = sub.get ('unsubscribe');
  if (unsub) {
    unsub ();
    quest.log.info ('Unsubscribe called!');
  }
  quest.do ();
  quest.log.info ('Unsubscribe done!');
});

Goblin.registerQuest (goblinName, 'subscribe', (quest, msg) => {
  // check for existing
  const feed = msg.get ('feed');
  const state = quest.goblin.getState ();
  const sub = getSubscription (state, feed);
  if (sub) {
    const unsub = sub.get ('unsubscribe');
    if (unsub) {
      unsub ();
      quest.log.info ('Unsubscribe to previous feed...');
    }
  }

  // subscribe to store and filter
  quest.do ();
  const unsubscribe = quest.goblin.store.subscribe (() =>
    handleChanges (quest, msg.data.feed)
  );
  quest.dispatch ('registerUnsubscribe', {feed, func: unsubscribe});
  quest.log.info ('Subscription done!');
});

Goblin.registerQuest (goblinName, 'feed.add', (quest, msg) => {
  const sub = getSubscription (quest.goblin.getState (), msg.get ('feed'));
  if (sub.get ('branches').has (msg.get ('branch'))) {
    return false;
  }

  quest.do ();
  return true;
});

Goblin.registerQuest (goblinName, 'feed.del', (quest, msg) => {
  const sub = getSubscription (quest.goblin.getState (), msg.get ('feed'));
  if (!sub.get ('branches').has (msg.get ('branch'))) {
    return false;
  }

  quest.do ();
  return true;
});

const pc = {
  upsert: {
    mode: 'last',
  },
};

// Singleton
const quests = Goblin.configure (goblinName, logicState, logicHandlers, pc);
Goblin.createSingle (goblinName);
module.exports = quests;
