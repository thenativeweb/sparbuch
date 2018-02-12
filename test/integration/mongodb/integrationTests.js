'use strict';

const env = require('../../helpers/env'),
      getTestsFor = require('../getTestsFor');

suite('mongodb/integration', function () {
  this.timeout(10 * 1000);

  getTestsFor({
    type: 'mongodb',
    url: env.MONGO_URL_INTEGRATION
  });
});
