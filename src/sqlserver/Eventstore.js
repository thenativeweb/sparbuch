'use strict';

const { EventEmitter } = require('events'),
      { PassThrough } = require('stream');

const cloneDeep = require('lodash/cloneDeep'),
      { Event } = require('commands-events'),
      flatten = require('lodash/flatten'),
      limitAlphanumeric = require('limit-alphanumeric'),
      { parse } = require('pg-connection-string'),
      { Request, TYPES } = require('tedious');

const createPool = require('./createPool'),
      omitByDeep = require('../omitByDeep');

class Eventstore extends EventEmitter {
  async getDatabase () {
    const database = await this.pool.acquire().promise;

    return database;
  }

  async initialize ({ url, namespace }) {
    if (!url) {
      throw new Error('Url is missing.');
    }
    if (!namespace) {
      throw new Error('Namespace is missing.');
    }

    this.namespace = `store_${limitAlphanumeric(namespace)}`;

    const { host, port, user, password, database, encrypt = false } = parse(url);

    this.pool = createPool({
      host,
      port,
      user,
      password,
      database,
      encrypt,

      onError: () => {
        this.emit('error');
      },

      onDisconnect: () => {
        this.emit('disconnect');
      }
    });

    const connection = await this.getDatabase();

    const query = `
      BEGIN TRANSACTION setupTables;

      IF NOT EXISTS (SELECT [name] FROM sys.tables WHERE [name] = '${this.namespace}_events')
        BEGIN
          CREATE TABLE [${this.namespace}_events] (
            [position] BIGINT IDENTITY(1,1),
            [aggregateId] UNIQUEIDENTIFIER NOT NULL,
            [revision] INT NOT NULL,
            [event] NVARCHAR(4000) NOT NULL,
            [hasBeenPublished] BIT NOT NULL,

            CONSTRAINT [${this.namespace}_events_pk] PRIMARY KEY([position]),
            CONSTRAINT [${this.namespace}_aggregateId_revision] UNIQUE ([aggregateId], [revision])
          );
        END

      IF NOT EXISTS (SELECT [name] FROM sys.tables WHERE [name] = '${this.namespace}_snapshots')
        BEGIN
          CREATE TABLE [${this.namespace}_snapshots] (
            [aggregateId] UNIQUEIDENTIFIER NOT NULL,
            [revision] INT NOT NULL,
            [state] NVARCHAR(4000) NOT NULL,

            CONSTRAINT [${this.namespace}_snapshots_pk] PRIMARY KEY([aggregateId], [revision])
          );
        END

      COMMIT TRANSACTION setupTables;
    `;

    await new Promise((resolve, reject) => {
      const request = new Request(query, err => {
        if (err) {
          // When multiple clients initialize at the same time, e.g. during
          // integration tests, SQL Server might throw an error. In this case
          // we simply ignore it.
          if (err.message.match(/There is already an object named.*_events/)) {
            return resolve();
          }

          return reject(err);
        }

        resolve();
      });

      connection.execSql(request);
    });

    await this.pool.release(connection);
  }

  async getLastEvent (aggregateId) {
    if (!aggregateId) {
      throw new Error('Aggregate id is missing.');
    }

    const database = await this.getDatabase();

    try {
      const result = await new Promise((resolve, reject) => {
        let resultEvent;

        const request = new Request(`
          SELECT TOP(1) [event], [position]
            FROM ${this.namespace}_events
            WHERE [aggregateId] = @aggregateId
            ORDER BY [revision] DESC
          ;
        `, err => {
          if (err) {
            return reject(err);
          }

          resolve(resultEvent);
        });

        request.once('row', columns => {
          resultEvent = Event.wrap(JSON.parse(columns[0].value));

          resultEvent.metadata.position = Number(columns[1].value);
        });

        request.addParameter('aggregateId', TYPES.UniqueIdentifier, aggregateId);

        database.execSql(request);
      });

      if (!result) {
        return;
      }

      return result;
    } finally {
      await this.pool.release(database);
    }
  }

  async getEventStream (aggregateId, options) {
    if (!aggregateId) {
      throw new Error('Aggregate id is missing.');
    }

    options = options || {};

    const fromRevision = options.fromRevision || 1;
    const toRevision = options.toRevision || 2 ** 31 - 1;

    if (fromRevision > toRevision) {
      throw new Error('From revision is greater than to revision.');
    }

    const database = await this.getDatabase();

    const passThrough = new PassThrough({ objectMode: true });

    let onError,
        onRow,
        request;

    const unsubscribe = () => {
      this.pool.release(database);
      request.removeListener('row', onRow);
      request.removeListener('error', onError);
    };

    onError = err => {
      unsubscribe();
      passThrough.emit('error', err);
      passThrough.end();
    };

    onRow = columns => {
      const event = Event.wrap(JSON.parse(columns[0].value));

      event.metadata.position = Number(columns[1].value);
      event.metadata.published = columns[2].value;

      passThrough.write(event);
    };

    request = new Request(`
      SELECT [event], [position], [hasBeenPublished]
        FROM [${this.namespace}_events]
        WHERE [aggregateId] = @aggregateId
          AND [revision] >= @fromRevision
          AND [revision] <= @toRevision
        ORDER BY [revision]`, err => {
      unsubscribe();

      if (err) {
        passThrough.emit('error', err);
      }

      passThrough.end();
    });

    request.addParameter('aggregateId', TYPES.UniqueIdentifier, aggregateId);
    request.addParameter('fromRevision', TYPES.Int, fromRevision);
    request.addParameter('toRevision', TYPES.Int, toRevision);

    request.on('error', onError);
    request.on('row', onRow);

    database.execSql(request);

    return passThrough;
  }

  async getUnpublishedEventStream () {
    const database = await this.getDatabase();

    const passThrough = new PassThrough({ objectMode: true });

    let onError,
        onRow,
        request;

    const unsubscribe = () => {
      this.pool.release(database);
      request.removeListener('error', onError);
      request.removeListener('row', onRow);
    };

    onError = err => {
      unsubscribe();
      passThrough.emit('error', err);
      passThrough.end();
    };

    onRow = columns => {
      const event = Event.wrap(JSON.parse(columns[0].value));

      event.metadata.position = Number(columns[1].value);
      event.metadata.published = columns[2].value;

      passThrough.write(event);
    };

    request = new Request(`
      SELECT [event], [position], [hasBeenPublished]
        FROM [${this.namespace}_events]
        WHERE [hasBeenPublished] = 0
        ORDER BY [position]
      `, err => {
      unsubscribe();

      if (err) {
        passThrough.emit('error', err);
      }

      passThrough.end();
    });

    request.on('error', onError);
    request.on('row', onRow);

    database.execSql(request);

    return passThrough;
  }

  async saveEvents ({ events }) {
    if (!events) {
      throw new Error('Events are missing.');
    }

    events = cloneDeep(flatten([ events ]));

    const database = await this.getDatabase();

    const placeholders = [],
          values = [];

    let resultCount = 0;

    for (let i = 0; i < events.length; i++) {
      const event = events[i],
            rowId = i + 1;

      const row = [
        { key: `aggregateId${rowId}`, value: event.aggregate.id, type: TYPES.UniqueIdentifier },
        { key: `revision${rowId}`, value: event.metadata.revision, type: TYPES.Int },
        { key: `event${rowId}`, value: JSON.stringify(event), type: TYPES.NVarChar, options: { length: 4000 }},
        { key: `hasBeenPublished${rowId}`, value: event.metadata.published, type: TYPES.Bit }
      ];

      placeholders.push(`(@${row[0].key}, @${row[1].key}, @${row[2].key}, @${row[3].key})`);

      values.push(...row);
    }

    const text = `
      INSERT INTO [${this.namespace}_events] ([aggregateId], [revision], [event], [hasBeenPublished])
        OUTPUT INSERTED.position
      VALUES ${placeholders.join(',')};
    `;

    try {
      const updatedEvents = await new Promise((resolve, reject) => {
        let onRow;

        const request = new Request(text, err => {
          request.removeListener('row', onRow);

          if (err) {
            return reject(err);
          }

          resolve(events);
        });

        for (let i = 0; i < values.length; i++) {
          const value = values[i];

          request.addParameter(value.key, value.type, value.value, value.options);
        }

        onRow = columns => {
          events[resultCount].metadata.position = Number(columns[0].value);

          resultCount += 1;
        };

        request.on('row', onRow);

        database.execSql(request);
      });

      return updatedEvents;
    } catch (ex) {
      if (ex.code === 'EREQUEST' && ex.number === 2627 && ex.message.includes('_aggregateId_revision')) {
        throw new Error('Aggregate id and revision already exist.');
      }

      throw ex;
    } finally {
      await this.pool.release(database);
    }
  }

  async markEventsAsPublished ({ aggregateId, fromRevision, toRevision }) {
    if (!aggregateId) {
      throw new Error('Aggregate id is missing.');
    }
    if (!fromRevision) {
      throw new Error('From revision is missing.');
    }
    if (!toRevision) {
      throw new Error('To revision is missing.');
    }

    if (fromRevision > toRevision) {
      throw new Error('From revision is greater than to revision.');
    }

    const database = await this.getDatabase();

    try {
      await new Promise((resolve, reject) => {
        const request = new Request(`
          UPDATE [${this.namespace}_events]
            SET [hasBeenPublished] = 1
            WHERE [aggregateId] = @aggregateId
              AND [revision] >= @fromRevision
              AND [revision] <= @toRevision
          `, err => {
          if (err) {
            return reject(err);
          }

          resolve();
        });

        request.addParameter('aggregateId', TYPES.UniqueIdentifier, aggregateId);
        request.addParameter('fromRevision', TYPES.Int, fromRevision);
        request.addParameter('toRevision', TYPES.Int, toRevision);

        database.execSql(request);
      });
    } finally {
      await this.pool.release(database);
    }
  }

  async getSnapshot (aggregateId) {
    if (!aggregateId) {
      throw new Error('Aggregate id is missing.');
    }

    const database = await this.getDatabase();

    try {
      const result = await new Promise((resolve, reject) => {
        let resultRow;

        const request = new Request(`
          SELECT TOP(1) [state], [revision]
            FROM ${this.namespace}_snapshots
            WHERE [aggregateId] = @aggregateId
            ORDER BY [revision] DESC
          ;`, err => {
          if (err) {
            return reject(err);
          }

          resolve(resultRow);
        });

        request.once('row', columns => {
          resultRow = {
            state: JSON.parse(columns[0].value),
            revision: Number(columns[1].value)
          };
        });

        request.addParameter('aggregateId', TYPES.UniqueIdentifier, aggregateId);

        database.execSql(request);
      });

      if (!result) {
        return;
      }

      return result;
    } finally {
      await this.pool.release(database);
    }
  }

  async saveSnapshot ({ aggregateId, revision, state }) {
    if (!aggregateId) {
      throw new Error('Aggregate id is missing.');
    }
    if (!revision) {
      throw new Error('Revision is missing.');
    }
    if (!state) {
      throw new Error('State is missing.');
    }

    state = omitByDeep(state, value => value === undefined);

    const database = await this.getDatabase();

    try {
      await new Promise((resolve, reject) => {
        const request = new Request(`
          IF NOT EXISTS (SELECT TOP(1) * FROM ${this.namespace}_snapshots WHERE [aggregateId] = @aggregateId and [revision] = @revision)
            BEGIN
              INSERT INTO [${this.namespace}_snapshots] ([aggregateId], [revision], [state])
              VALUES (@aggregateId, @revision, @state);
            END
          `, err => {
          if (err) {
            return reject(err);
          }

          resolve();
        });

        request.addParameter('aggregateId', TYPES.UniqueIdentifier, aggregateId);
        request.addParameter('revision', TYPES.Int, revision);
        request.addParameter('state', TYPES.NVarChar, JSON.stringify(state), { length: 4000 });

        database.execSql(request);
      });
    } finally {
      await this.pool.release(database);
    }
  }

  async getReplay (options) {
    options = options || {};

    const fromPosition = options.fromPosition || 1;
    const toPosition = options.toPosition || 2 ** 31 - 1;

    if (fromPosition > toPosition) {
      throw new Error('From position is greater than to position.');
    }

    const database = await this.getDatabase();

    const passThrough = new PassThrough({ objectMode: true });

    let onError,
        onRow,
        request;

    const unsubscribe = () => {
      this.pool.release(database);
      request.removeListener('error', onError);
      request.removeListener('row', onRow);
    };

    onError = err => {
      unsubscribe();
      passThrough.emit('error', err);
      passThrough.end();
    };

    onRow = columns => {
      const event = Event.wrap(JSON.parse(columns[0].value));

      event.metadata.position = Number(columns[1].value);

      passThrough.write(event);
    };

    request = new Request(`
      SELECT [event], [position]
        FROM [${this.namespace}_events]
        WHERE [position] >= @fromPosition
          AND [position] <= @toPosition
        ORDER BY [position]`, err => {
      unsubscribe();

      if (err) {
        passThrough.emit('error', err);
      }

      passThrough.end();
    });

    request.addParameter('fromPosition', TYPES.BigInt, fromPosition);
    request.addParameter('toPosition', TYPES.BigInt, toPosition);

    request.on('error', onError);
    request.on('row', onRow);

    database.execSql(request);

    return passThrough;
  }

  async destroy () {
    if (this.pool) {
      await this.pool.destroy();
    }
  }
}

module.exports = Eventstore;
