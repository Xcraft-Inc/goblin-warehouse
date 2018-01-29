'use strict';

/**
 * Retrieve the inquirer definition for xcraft-core-server
 */
module.exports = [
  {
    type: 'list',
    name: 'mode',
    message: 'use mode',
    choices: ['master', 'slave'],
    default: 'master',
  },
];
