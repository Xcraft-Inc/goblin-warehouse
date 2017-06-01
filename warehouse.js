'use strict';

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return {
    handlers: require ('./lib/service.js'),
    rc: {
      upsert: {
        parallel: true,
        desc: 'update or insert a new state branch',
        options: {
          params: {
            required: 'branch',
            optional: 'data',
          },
        },
      },
      remove: {
        parallel: true,
        desc: 'remove a state branch',
        options: {
          params: {
            required: 'branch',
          },
        },
      },
      'feed.add': {
        parallel: true,
        desc: 'add a branch to a feed',
        options: {
          params: {
            required: 'feed',
            optional: 'branch',
          },
        },
      },
      'feed.del': {
        parallel: true,
        desc: 'delete a branch from a feed',
        options: {
          params: {
            required: 'feed',
            optional: 'branch',
          },
        },
      },
      subscribe: {
        parallel: true,
        desc: 'create a subscription feed',
        options: {
          params: {
            required: 'feed',
            optional: 'branches...',
          },
        },
      },
      resend: {
        parallel: true,
        desc: 'resend a subscription feed',
        options: {
          params: {
            required: 'feed',
          },
        },
      },
      unsubscribe: {
        parallel: true,
        desc: 'unsubscribe from a feed',
        options: {
          params: {
            required: 'feed',
          },
        },
      },
      save: {
        parallel: true,
        desc: 'persist data warehouse state',
        options: {
          params: {},
        },
      },
      load: {
        parallel: true,
        desc: 'load persisted data warehouse state',
        options: {
          params: {},
        },
      },
    },
  };
};
