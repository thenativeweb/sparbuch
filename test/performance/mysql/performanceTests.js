'use strict';

const env = require('../../shared/env'),
      Eventstore = require('../../../src/mysql/Eventstore'),
      getTestsFor = require('../getTestsFor');

suite.skip('mysql/Eventstore', function () {
  this.timeout(90 * 1000);

  getTestsFor(Eventstore, {
    url: env.MYSQL_URL_PERFORMANCE,
    type: 'mysql'
  });
});
