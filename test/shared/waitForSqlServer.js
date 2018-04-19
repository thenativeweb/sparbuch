'use strict';

const { parse } = require('pg-connection-string'),
      { Connection, Request } = require('tedious'),
      retry = require('async-retry');

const createDatabase = async function ({ connection, database }) {
  if (!connection) {
    throw new Error('Connection is missing.');
  }
  if (!database) {
    throw new Error('Database is missing.');
  }

  const createDatabaseQuery = `
    IF NOT EXISTS(SELECT * from sys.databases WHERE name='${database}')
      CREATE DATABASE ${database}`;

  await new Promise((resolve, reject) => {
    const createDatabaseRequest = new Request(createDatabaseQuery, err => {
      if (err) {
        return reject(err);
      }

      console.log('database created');
      resolve();
    });

    connection.execSql(createDatabaseRequest);
  });
};

const waitForSqlServer = async function ({ url }) {
  if (!url) {
    throw new Error('Url is missing.');
  }

  const { host, port, user, password, database } = parse(url);

  const config = {
    server: host,
    options: {
      port
    },
    userName: user,
    password,
    database: 'master'
  };

  let connection;

  await retry(async () => {
    await new Promise((resolve, reject) => {
      connection = new Connection(config);

      let handleConnect,
          handleEnd;

      const removeListeners = () => {
        connection.removeListener('connect', handleConnect);
        connection.removeListener('end', handleEnd);
      };

      handleConnect = err => {
        removeListeners();

        if (err) {
          return reject(new Error('Could not connect.'));
        }

        resolve();
      };

      handleEnd = () => {
        removeListeners();

        reject(new Error('Could not connect.'));
      };

      connection.on('connect', handleConnect);
      connection.on('end', handleEnd);
    });
  });

  await createDatabase({ connection, database });

  await new Promise(resolve => {
    connection.once('end', resolve);

    connection.close();
  });
};

module.exports = waitForSqlServer;
