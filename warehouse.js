'use strict';

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function (config) {
  //TODO: handle slave/master run
  return require ('./lib/service.js');
};
