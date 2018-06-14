'use strict';

const { EventEmitter } = require('events'),
      { parse } = require('url'),
      { PassThrough } = require('stream');

const cloneDeep = require('lodash/cloneDeep'),
      { Event } = require('commands-events'),
      flatten = require('lodash/flatten'),
      limitAlphanumeric = require('limit-alphanumeric'),
      { MongoClient } = require('mongodb');

const omitByDeep = require('../omitByDeep');

class Eventstore extends EventEmitter {
  constructor () {
    super();

    this.client = undefined;
    this.db = undefined;
    this.collections = {};
  }

  async initialize ({ url, namespace }) {
    if (!url) {
      throw new Error('Url is missing.');
    }
    if (!namespace) {
      throw new Error('Namespace is missing.');
    }

    this.namespace = `store_${limitAlphanumeric(namespace)}`;

    /* eslint-disable id-length */
    this.client = await MongoClient.connect(url, { w: 1 });
    /* eslint-enable id-length */

    const databaseName = parse(url).pathname.substring(1);

    this.db = this.client.db(databaseName);

    this.db.on('close', () => {
      this.emit('disconnect');
    });

    this.collections.events = this.db.collection(`${namespace}_events`);
    this.collections.snapshots = this.db.collection(`${namespace}_snapshots`);
    this.collections.counters = this.db.collection(`${namespace}_counters`);

    await this.collections.events.ensureIndex({ 'aggregate.id': 1 }, { name: `${this.namespace}_aggregateId` });
    await this.collections.events.ensureIndex({ 'aggregate.id': 1, 'metadata.revision': 1 }, { unique: true, name: `${this.namespace}_aggregateId_revision` });
    await this.collections.events.ensureIndex({ 'metadata.position': 1 }, { unique: true, name: `${this.namespace}_position` });
    await this.collections.snapshots.ensureIndex({ 'aggregate.id': 1 }, { unique: true });

    try {
      await this.collections.counters.insertOne({ _id: 'events', seq: 0 });
    } catch (ex) {
      if (ex.code === 11000 && ex.message.includes('_counters index: _id_ dup key')) {
        return;
      }

      throw ex;
    }
  }

  async getNextSequence (name) {
    const counter = await this.collections.counters.findOneAndUpdate({ _id: name }, {
      $inc: { seq: 1 }
    }, { returnOriginal: false });

    return counter.value.seq;
  }

  async getLastEvent (aggregateId) {
    if (!aggregateId) {
      throw new Error('Aggregate id is missing.');
    }

    const events = await this.collections.events.find({
      'aggregate.id': aggregateId
    }, {
      fields: { _id: 0 },
      sort: { 'metadata.revision': -1 },
      limit: 1
    }).toArray();

    if (events.length === 0) {
      return;
    }

    return Event.wrap(events[0]);
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

    const passThrough = new PassThrough({ objectMode: true });
    const eventStream = this.collections.events.find({
      $and: [
        { 'aggregate.id': aggregateId },
        { 'metadata.revision': { $gte: fromRevision }},
        { 'metadata.revision': { $lte: toRevision }}
      ]
    }, {
      fields: { _id: 0 },
      sort: 'metadata.revision'
    }).stream();

    let onData,
        onEnd,
        onError;

    const unsubscribe = function () {
      eventStream.removeListener('data', onData);
      eventStream.removeListener('end', onEnd);
      eventStream.removeListener('error', onError);
    };

    onData = function (data) {
      passThrough.write(Event.wrap(data));
    };

    onEnd = function () {
      unsubscribe();
      passThrough.end();

      // In the PostgreSQL eventstore, we call eventStream.end() here. In MongoDB,
      // this function apparently is not implemented. This note is just for
      // informational purposes to ensure that you are aware that the two
      // implementations differ here.
    };

    onError = function (err) {
      unsubscribe();
      passThrough.emit('error', err);
      passThrough.end();

      // In the PostgreSQL eventstore, we call eventStream.end() here. In MongoDB,
      // this function apparently is not implemented. This note is just for
      // informational purposes to ensure that you are aware that the two
      // implementations differ here.
    };

    eventStream.on('data', onData);
    eventStream.on('end', onEnd);
    eventStream.on('error', onError);

    return passThrough;
  }

  async getUnpublishedEventStream () {
    const passThrough = new PassThrough({ objectMode: true });
    const eventStream = this.collections.events.find({
      'metadata.published': false
    }, {
      fields: { _id: 0 },
      sort: 'metadata.position'
    }).stream();

    let onData,
        onEnd,
        onError;

    const unsubscribe = function () {
      eventStream.removeListener('data', onData);
      eventStream.removeListener('end', onEnd);
      eventStream.removeListener('error', onError);
    };

    onData = function (data) {
      passThrough.write(Event.wrap(data));
    };

    onEnd = function () {
      unsubscribe();
      passThrough.end();

      // In the PostgreSQL eventstore, we call eventStream.end() here. In MongoDB,
      // this function apparently is not implemented. This note is just for
      // informational purposes to ensure that you are aware that the two
      // implementations differ here.
    };

    onError = function (err) {
      unsubscribe();
      passThrough.emit('error', err);
      passThrough.end();

      // In the PostgreSQL eventstore, we call eventStream.end() here. In MongoDB,
      // this function apparently is not implemented. This note is just for
      // informational purposes to ensure that you are aware that the two
      // implementations differ here.
    };

    eventStream.on('data', onData);
    eventStream.on('end', onEnd);
    eventStream.on('error', onError);

    return passThrough;
  }

  async saveEvents ({ events }) {
    if (!events) {
      throw new Error('Events are missing.');
    }
    if (Array.isArray(events) && events.length === 0) {
      throw new Error('Events are missing.');
    }

    events = cloneDeep(flatten([ events ]));

    try {
      for (let i = 0; i < events.length; i++) {
        const event = events[i];

        if (!event.metadata) {
          throw new Error('Metadata are missing.');
        }
        if (event.metadata.revision === undefined) {
          throw new Error('Revision is missing.');
        }
        if (event.metadata.revision < 1) {
          throw new Error('Revision must not be less than 1.');
        }

        const seq = await this.getNextSequence('events');

        event.data = omitByDeep(event.data, value => value === undefined);
        event.metadata.position = seq;

        // Use cloned events here to hinder MongoDB from adding an _id property to
        // the original event objects.
        await this.collections.events.insertOne(cloneDeep(event));
      }
    } catch (ex) {
      if (ex.code === 11000 && ex.message.indexOf('_aggregateId_revision') !== -1) {
        throw new Error('Aggregate id and revision already exist.');
      }

      throw ex;
    }

    return events;
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

    await this.collections.events.update({
      'aggregate.id': aggregateId,
      'metadata.revision': {
        $gte: fromRevision,
        $lte: toRevision
      }
    }, {
      $set: {
        'metadata.published': true
      }
    }, {
      multi: true
    });
  }

  async getSnapshot (aggregateId) {
    if (!aggregateId) {
      throw new Error('Aggregate id is missing.');
    }

    const snapshot = await this.collections.snapshots.findOne({ aggregateId }, {
      fields: { _id: 0, revision: 1, state: 1 }
    });

    if (!snapshot) {
      return;
    }

    return snapshot;
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

    await this.collections.snapshots.update({
      aggregateId
    }, {
      aggregateId,
      state,
      revision
    }, {
      upsert: true
    });
  }

  async getReplay (options) {
    options = options || {};

    const fromPosition = options.fromPosition || 1;
    const toPosition = options.toPosition || 2 ** 31 - 1;

    if (fromPosition > toPosition) {
      throw new Error('From position is greater than to position.');
    }

    const passThrough = new PassThrough({ objectMode: true });
    const replayStream = this.collections.events.find({
      $and: [
        { 'metadata.position': { $gte: fromPosition }},
        { 'metadata.position': { $lte: toPosition }}
      ]
    }, {
      fields: { _id: 0 },
      sort: 'metadata.position'
    }).stream();

    let onData,
        onEnd,
        onError;

    const unsubscribe = function () {
      replayStream.removeListener('data', onData);
      replayStream.removeListener('end', onEnd);
      replayStream.removeListener('error', onError);
    };

    onData = function (data) {
      passThrough.write(Event.wrap(data));
    };

    onEnd = function () {
      unsubscribe();
      passThrough.end();

      // In the PostgreSQL eventstore, we call replayStream.end() here. In MongoDB,
      // this function apparently is not implemented. This note is just for
      // informational purposes to ensure that you are aware that the two
      // implementations differ here.
    };

    onError = function (err) {
      unsubscribe();
      passThrough.emit('error', err);
      passThrough.end();

      // In the PostgreSQL eventstore, we call replayStream.end() here. In MongoDB,
      // this function apparently is not implemented. This note is just for
      // informational purposes to ensure that you are aware that the two
      // implementations differ here.
    };

    replayStream.on('data', onData);
    replayStream.on('end', onEnd);
    replayStream.on('error', onError);

    return passThrough;
  }

  async destroy () {
    if (this.client) {
      await this.client.close(true);
    }
  }
}

module.exports = Eventstore;
