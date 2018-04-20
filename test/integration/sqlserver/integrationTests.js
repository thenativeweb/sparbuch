'use strict';

const env = require('../../shared/env'),
      getTestsFor = require('../getTestsFor');

suite('postgres/integration', function () {
  this.timeout(10 * 1000);

  getTestsFor({
    type: 'sqlserver',
    url: env.SQLSERVER_URL_INTEGRATION
  });
});