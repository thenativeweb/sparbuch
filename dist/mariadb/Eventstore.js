'use strict';

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

var _slicedToArray2 = _interopRequireDefault(require("@babel/runtime/helpers/slicedToArray"));

var _regenerator = _interopRequireDefault(require("@babel/runtime/regenerator"));

var _asyncToGenerator2 = _interopRequireDefault(require("@babel/runtime/helpers/asyncToGenerator"));

var _classCallCheck2 = _interopRequireDefault(require("@babel/runtime/helpers/classCallCheck"));

var _createClass2 = _interopRequireDefault(require("@babel/runtime/helpers/createClass"));

var _possibleConstructorReturn2 = _interopRequireDefault(require("@babel/runtime/helpers/possibleConstructorReturn"));

var _getPrototypeOf2 = _interopRequireDefault(require("@babel/runtime/helpers/getPrototypeOf"));

var _inherits2 = _interopRequireDefault(require("@babel/runtime/helpers/inherits"));

var _require = require('events'),
    EventEmitter = _require.EventEmitter,
    _require2 = require('stream'),
    PassThrough = _require2.PassThrough;

var cloneDeep = require('lodash/cloneDeep'),
    DsnParser = require('dsn-parser'),
    _require3 = require('commands-events'),
    Event = _require3.Event,
    flatten = require('lodash/flatten'),
    limitAlphanumeric = require('limit-alphanumeric'),
    mysql = require('mysql2/promise'),
    retry = require('async-retry');

var omitByDeep = require('../omitByDeep');

var Eventstore =
/*#__PURE__*/
function (_EventEmitter) {
  (0, _inherits2.default)(Eventstore, _EventEmitter);

  function Eventstore() {
    (0, _classCallCheck2.default)(this, Eventstore);
    return (0, _possibleConstructorReturn2.default)(this, (0, _getPrototypeOf2.default)(Eventstore).apply(this, arguments));
  }

  (0, _createClass2.default)(Eventstore, [{
    key: "getDatabase",
    value: function () {
      var _getDatabase = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee2() {
        var _this = this;

        var database;
        return _regenerator.default.wrap(function _callee2$(_context2) {
          while (1) {
            switch (_context2.prev = _context2.next) {
              case 0:
                _context2.next = 2;
                return retry(
                /*#__PURE__*/
                (0, _asyncToGenerator2.default)(
                /*#__PURE__*/
                _regenerator.default.mark(function _callee() {
                  var connection;
                  return _regenerator.default.wrap(function _callee$(_context) {
                    while (1) {
                      switch (_context.prev = _context.next) {
                        case 0:
                          _context.next = 2;
                          return _this.pool.getConnection();

                        case 2:
                          connection = _context.sent;
                          return _context.abrupt("return", connection);

                        case 4:
                        case "end":
                          return _context.stop();
                      }
                    }
                  }, _callee, this);
                })));

              case 2:
                database = _context2.sent;
                return _context2.abrupt("return", database);

              case 4:
              case "end":
                return _context2.stop();
            }
          }
        }, _callee2, this);
      }));

      function getDatabase() {
        return _getDatabase.apply(this, arguments);
      }

      return getDatabase;
    }()
  }, {
    key: "initialize",
    value: function () {
      var _initialize = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee3(_ref2) {
        var _this2 = this;

        var url, namespace, _getParts, host, port, user, password, database, connection, query;

        return _regenerator.default.wrap(function _callee3$(_context3) {
          while (1) {
            switch (_context3.prev = _context3.next) {
              case 0:
                url = _ref2.url, namespace = _ref2.namespace;

                if (url) {
                  _context3.next = 3;
                  break;
                }

                throw new Error('Url is missing.');

              case 3:
                if (namespace) {
                  _context3.next = 5;
                  break;
                }

                throw new Error('Namespace is missing.');

              case 5:
                this.namespace = "store_".concat(limitAlphanumeric(namespace));
                _getParts = new DsnParser(url).getParts(), host = _getParts.host, port = _getParts.port, user = _getParts.user, password = _getParts.password, database = _getParts.database;
                this.pool = mysql.createPool({
                  host: host,
                  port: port,
                  user: user,
                  password: password,
                  database: database,
                  multipleStatements: true
                });
                this.pool.on('connection', function (connection) {
                  connection.on('error', function () {
                    _this2.emit('disconnect');
                  });
                  connection.on('end', function () {
                    _this2.emit('disconnect');
                  });
                });
                _context3.next = 11;
                return this.getDatabase();

              case 11:
                connection = _context3.sent;
                query = "\n      CREATE FUNCTION IF NOT EXISTS UuidToBin(_uuid BINARY(36))\n        RETURNS BINARY(16)\n        RETURN UNHEX(CONCAT(\n          SUBSTR(_uuid, 15, 4),\n          SUBSTR(_uuid, 10, 4),\n          SUBSTR(_uuid, 1, 8),\n          SUBSTR(_uuid, 20, 4),\n          SUBSTR(_uuid, 25)\n        ));\n\n      CREATE FUNCTION IF NOT EXISTS UuidFromBin(_bin BINARY(16))\n        RETURNS BINARY(36)\n        RETURN LCASE(CONCAT_WS('-',\n          HEX(SUBSTR(_bin,  5, 4)),\n          HEX(SUBSTR(_bin,  3, 2)),\n          HEX(SUBSTR(_bin,  1, 2)),\n          HEX(SUBSTR(_bin,  9, 2)),\n          HEX(SUBSTR(_bin, 11))\n        ));\n\n      CREATE TABLE IF NOT EXISTS ".concat(this.namespace, "_events (\n        position SERIAL,\n        aggregateId BINARY(16) NOT NULL,\n        revision INT NOT NULL,\n        event JSON NOT NULL,\n        hasBeenPublished BOOLEAN NOT NULL,\n\n        PRIMARY KEY(position),\n        UNIQUE (aggregateId, revision)\n      ) ENGINE=InnoDB;\n\n      CREATE TABLE IF NOT EXISTS ").concat(this.namespace, "_snapshots (\n        aggregateId BINARY(16) NOT NULL,\n        revision INT NOT NULL,\n        state JSON NOT NULL,\n\n        PRIMARY KEY(aggregateId, revision)\n      ) ENGINE=InnoDB;\n    ");
                _context3.next = 15;
                return connection.query(query);

              case 15:
                _context3.next = 17;
                return connection.release();

              case 17:
              case "end":
                return _context3.stop();
            }
          }
        }, _callee3, this);
      }));

      function initialize(_x) {
        return _initialize.apply(this, arguments);
      }

      return initialize;
    }()
  }, {
    key: "getLastEvent",
    value: function () {
      var _getLastEvent = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee4(aggregateId) {
        var connection, _ref3, _ref4, rows, event;

        return _regenerator.default.wrap(function _callee4$(_context4) {
          while (1) {
            switch (_context4.prev = _context4.next) {
              case 0:
                if (aggregateId) {
                  _context4.next = 2;
                  break;
                }

                throw new Error('Aggregate id is missing.');

              case 2:
                _context4.next = 4;
                return this.getDatabase();

              case 4:
                connection = _context4.sent;
                _context4.prev = 5;
                _context4.next = 8;
                return connection.execute("\n        SELECT event, position\n          FROM ".concat(this.namespace, "_events\n          WHERE aggregateId = UuidToBin(?)\n          ORDER BY revision DESC\n          LIMIT 1\n        "), [aggregateId]);

              case 8:
                _ref3 = _context4.sent;
                _ref4 = (0, _slicedToArray2.default)(_ref3, 1);
                rows = _ref4[0];

                if (!(rows.length === 0)) {
                  _context4.next = 13;
                  break;
                }

                return _context4.abrupt("return");

              case 13:
                event = Event.wrap(JSON.parse(rows[0].event));
                event.metadata.position = Number(rows[0].position);
                return _context4.abrupt("return", event);

              case 16:
                _context4.prev = 16;
                _context4.next = 19;
                return connection.release();

              case 19:
                return _context4.finish(16);

              case 20:
              case "end":
                return _context4.stop();
            }
          }
        }, _callee4, this, [[5,, 16, 20]]);
      }));

      function getLastEvent(_x2) {
        return _getLastEvent.apply(this, arguments);
      }

      return getLastEvent;
    }()
  }, {
    key: "getEventStream",
    value: function () {
      var _getEventStream = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee5(aggregateId, options) {
        var fromRevision, toRevision, connection, passThrough, eventStream, onEnd, onError, onResult, unsubscribe;
        return _regenerator.default.wrap(function _callee5$(_context5) {
          while (1) {
            switch (_context5.prev = _context5.next) {
              case 0:
                if (aggregateId) {
                  _context5.next = 2;
                  break;
                }

                throw new Error('Aggregate id is missing.');

              case 2:
                options = options || {};
                fromRevision = options.fromRevision || 1;
                toRevision = options.toRevision || Math.pow(2, 31) - 1;

                if (!(fromRevision > toRevision)) {
                  _context5.next = 7;
                  break;
                }

                throw new Error('From revision is greater than to revision.');

              case 7:
                _context5.next = 9;
                return this.getDatabase();

              case 9:
                connection = _context5.sent;
                passThrough = new PassThrough({
                  objectMode: true
                });
                eventStream = connection.connection.execute("\n      SELECT event, position, hasBeenPublished\n        FROM ".concat(this.namespace, "_events\n        WHERE aggregateId = UuidToBin(?)\n          AND revision >= ?\n          AND revision <= ?\n        ORDER BY revision"), [aggregateId, fromRevision, toRevision]);

                unsubscribe = function unsubscribe() {
                  connection.release();
                  eventStream.removeListener('end', onEnd);
                  eventStream.removeListener('error', onError);
                  eventStream.removeListener('result', onResult);
                };

                onEnd = function onEnd() {
                  unsubscribe();
                  passThrough.end();
                };

                onError = function onError(err) {
                  unsubscribe();
                  passThrough.emit('error', err);
                  passThrough.end();
                };

                onResult = function onResult(row) {
                  var event = Event.wrap(JSON.parse(row.event));
                  event.metadata.position = Number(row.position);
                  event.metadata.published = Boolean(row.hasBeenPublished);
                  passThrough.write(event);
                };

                eventStream.on('end', onEnd);
                eventStream.on('error', onError);
                eventStream.on('result', onResult);
                return _context5.abrupt("return", passThrough);

              case 20:
              case "end":
                return _context5.stop();
            }
          }
        }, _callee5, this);
      }));

      function getEventStream(_x3, _x4) {
        return _getEventStream.apply(this, arguments);
      }

      return getEventStream;
    }()
  }, {
    key: "getUnpublishedEventStream",
    value: function () {
      var _getUnpublishedEventStream = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee6() {
        var connection, passThrough, eventStream, onEnd, onError, onResult, unsubscribe;
        return _regenerator.default.wrap(function _callee6$(_context6) {
          while (1) {
            switch (_context6.prev = _context6.next) {
              case 0:
                _context6.next = 2;
                return this.getDatabase();

              case 2:
                connection = _context6.sent;
                passThrough = new PassThrough({
                  objectMode: true
                });
                eventStream = connection.connection.execute("\n      SELECT event, position, hasBeenPublished\n        FROM ".concat(this.namespace, "_events\n        WHERE hasBeenPublished = false\n        ORDER BY position\n    "));

                unsubscribe = function unsubscribe() {
                  connection.release();
                  eventStream.removeListener('end', onEnd);
                  eventStream.removeListener('error', onError);
                  eventStream.removeListener('result', onResult);
                };

                onEnd = function onEnd() {
                  unsubscribe();
                  passThrough.end();
                };

                onError = function onError(err) {
                  unsubscribe();
                  passThrough.emit('error', err);
                  passThrough.end();
                };

                onResult = function onResult(row) {
                  var event = Event.wrap(JSON.parse(row.event));
                  event.metadata.position = Number(row.position);
                  event.metadata.published = Boolean(row.hasBeenPublished);
                  passThrough.write(event);
                };

                eventStream.on('end', onEnd);
                eventStream.on('error', onError);
                eventStream.on('result', onResult);
                return _context6.abrupt("return", passThrough);

              case 13:
              case "end":
                return _context6.stop();
            }
          }
        }, _callee6, this);
      }));

      function getUnpublishedEventStream() {
        return _getUnpublishedEventStream.apply(this, arguments);
      }

      return getUnpublishedEventStream;
    }()
  }, {
    key: "saveEvents",
    value: function () {
      var _saveEvents = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee7(_ref5) {
        var events, connection, placeholders, values, i, event, text, _ref6, _ref7, rows, _i;

        return _regenerator.default.wrap(function _callee7$(_context7) {
          while (1) {
            switch (_context7.prev = _context7.next) {
              case 0:
                events = _ref5.events;

                if (events) {
                  _context7.next = 3;
                  break;
                }

                throw new Error('Events are missing.');

              case 3:
                if (!(Array.isArray(events) && events.length === 0)) {
                  _context7.next = 5;
                  break;
                }

                throw new Error('Events are missing.');

              case 5:
                events = cloneDeep(flatten([events]));
                _context7.next = 8;
                return this.getDatabase();

              case 8:
                connection = _context7.sent;
                placeholders = [], values = [];
                i = 0;

              case 11:
                if (!(i < events.length)) {
                  _context7.next = 24;
                  break;
                }

                event = events[i];

                if (event.metadata) {
                  _context7.next = 15;
                  break;
                }

                throw new Error('Metadata are missing.');

              case 15:
                if (!(event.metadata.revision === undefined)) {
                  _context7.next = 17;
                  break;
                }

                throw new Error('Revision is missing.');

              case 17:
                if (!(event.metadata.revision < 1)) {
                  _context7.next = 19;
                  break;
                }

                throw new Error('Revision must not be less than 1.');

              case 19:
                placeholders.push('(UuidToBin(?), ?, ?, ?)');
                values.push(event.aggregate.id, event.metadata.revision, JSON.stringify(event), event.metadata.published);

              case 21:
                i++;
                _context7.next = 11;
                break;

              case 24:
                text = "\n      INSERT INTO ".concat(this.namespace, "_events\n        (aggregateId, revision, event, hasBeenPublished)\n      VALUES\n        ").concat(placeholders.join(','), ";\n    ");
                _context7.prev = 25;
                _context7.next = 28;
                return connection.execute(text, values);

              case 28:
                _context7.next = 30;
                return connection.execute('SELECT LAST_INSERT_ID() AS position;');

              case 30:
                _ref6 = _context7.sent;
                _ref7 = (0, _slicedToArray2.default)(_ref6, 1);
                rows = _ref7[0];

                // We only get the ID of the first inserted row, but since it's all in a
                // single INSERT statement, the database guarantees that the positions are
                // sequential, so we easily calculate them by ourselves.
                for (_i = 0; _i < events.length; _i++) {
                  events[_i].metadata.position = Number(rows[0].position) + _i;
                }

                return _context7.abrupt("return", events);

              case 37:
                _context7.prev = 37;
                _context7.t0 = _context7["catch"](25);

                if (!(_context7.t0.code === 'ER_DUP_ENTRY' && _context7.t0.sqlMessage.endsWith('for key \'aggregateId\''))) {
                  _context7.next = 41;
                  break;
                }

                throw new Error('Aggregate id and revision already exist.');

              case 41:
                throw _context7.t0;

              case 42:
                _context7.prev = 42;
                connection.release();
                return _context7.finish(42);

              case 45:
              case "end":
                return _context7.stop();
            }
          }
        }, _callee7, this, [[25, 37, 42, 45]]);
      }));

      function saveEvents(_x5) {
        return _saveEvents.apply(this, arguments);
      }

      return saveEvents;
    }()
  }, {
    key: "markEventsAsPublished",
    value: function () {
      var _markEventsAsPublished = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee8(_ref8) {
        var aggregateId, fromRevision, toRevision, connection;
        return _regenerator.default.wrap(function _callee8$(_context8) {
          while (1) {
            switch (_context8.prev = _context8.next) {
              case 0:
                aggregateId = _ref8.aggregateId, fromRevision = _ref8.fromRevision, toRevision = _ref8.toRevision;

                if (aggregateId) {
                  _context8.next = 3;
                  break;
                }

                throw new Error('Aggregate id is missing.');

              case 3:
                if (fromRevision) {
                  _context8.next = 5;
                  break;
                }

                throw new Error('From revision is missing.');

              case 5:
                if (toRevision) {
                  _context8.next = 7;
                  break;
                }

                throw new Error('To revision is missing.');

              case 7:
                if (!(fromRevision > toRevision)) {
                  _context8.next = 9;
                  break;
                }

                throw new Error('From revision is greater than to revision.');

              case 9:
                _context8.next = 11;
                return this.getDatabase();

              case 11:
                connection = _context8.sent;
                _context8.prev = 12;
                _context8.next = 15;
                return connection.execute("\n        UPDATE ".concat(this.namespace, "_events\n          SET hasBeenPublished = true\n          WHERE aggregateId = UuidToBin(?)\n            AND revision >= ?\n            AND revision <= ?\n      "), [aggregateId, fromRevision, toRevision]);

              case 15:
                _context8.prev = 15;
                _context8.next = 18;
                return connection.release();

              case 18:
                return _context8.finish(15);

              case 19:
              case "end":
                return _context8.stop();
            }
          }
        }, _callee8, this, [[12,, 15, 19]]);
      }));

      function markEventsAsPublished(_x6) {
        return _markEventsAsPublished.apply(this, arguments);
      }

      return markEventsAsPublished;
    }()
  }, {
    key: "getSnapshot",
    value: function () {
      var _getSnapshot = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee9(aggregateId) {
        var connection, _ref9, _ref10, rows;

        return _regenerator.default.wrap(function _callee9$(_context9) {
          while (1) {
            switch (_context9.prev = _context9.next) {
              case 0:
                if (aggregateId) {
                  _context9.next = 2;
                  break;
                }

                throw new Error('Aggregate id is missing.');

              case 2:
                _context9.next = 4;
                return this.getDatabase();

              case 4:
                connection = _context9.sent;
                _context9.prev = 5;
                _context9.next = 8;
                return connection.execute("\n        SELECT state, revision\n          FROM ".concat(this.namespace, "_snapshots\n          WHERE aggregateId = UuidToBin(?)\n          ORDER BY revision DESC\n          LIMIT 1\n      "), [aggregateId]);

              case 8:
                _ref9 = _context9.sent;
                _ref10 = (0, _slicedToArray2.default)(_ref9, 1);
                rows = _ref10[0];

                if (!(rows.length === 0)) {
                  _context9.next = 13;
                  break;
                }

                return _context9.abrupt("return");

              case 13:
                return _context9.abrupt("return", {
                  revision: rows[0].revision,
                  state: JSON.parse(rows[0].state)
                });

              case 14:
                _context9.prev = 14;
                _context9.next = 17;
                return connection.release();

              case 17:
                return _context9.finish(14);

              case 18:
              case "end":
                return _context9.stop();
            }
          }
        }, _callee9, this, [[5,, 14, 18]]);
      }));

      function getSnapshot(_x7) {
        return _getSnapshot.apply(this, arguments);
      }

      return getSnapshot;
    }()
  }, {
    key: "saveSnapshot",
    value: function () {
      var _saveSnapshot = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee10(_ref11) {
        var aggregateId, revision, state, connection;
        return _regenerator.default.wrap(function _callee10$(_context10) {
          while (1) {
            switch (_context10.prev = _context10.next) {
              case 0:
                aggregateId = _ref11.aggregateId, revision = _ref11.revision, state = _ref11.state;

                if (aggregateId) {
                  _context10.next = 3;
                  break;
                }

                throw new Error('Aggregate id is missing.');

              case 3:
                if (revision) {
                  _context10.next = 5;
                  break;
                }

                throw new Error('Revision is missing.');

              case 5:
                if (state) {
                  _context10.next = 7;
                  break;
                }

                throw new Error('State is missing.');

              case 7:
                state = omitByDeep(state, function (value) {
                  return value === undefined;
                });
                _context10.next = 10;
                return this.getDatabase();

              case 10:
                connection = _context10.sent;
                _context10.prev = 11;
                _context10.next = 14;
                return connection.execute("\n        INSERT IGNORE INTO ".concat(this.namespace, "_snapshots\n          (aggregateId, revision, state)\n          VALUES (UuidToBin(?), ?, ?);\n      "), [aggregateId, revision, JSON.stringify(state)]);

              case 14:
                _context10.prev = 14;
                _context10.next = 17;
                return connection.release();

              case 17:
                return _context10.finish(14);

              case 18:
              case "end":
                return _context10.stop();
            }
          }
        }, _callee10, this, [[11,, 14, 18]]);
      }));

      function saveSnapshot(_x8) {
        return _saveSnapshot.apply(this, arguments);
      }

      return saveSnapshot;
    }()
  }, {
    key: "getReplay",
    value: function () {
      var _getReplay = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee11(options) {
        var fromPosition, toPosition, connection, passThrough, eventStream, onEnd, onError, onResult, unsubscribe;
        return _regenerator.default.wrap(function _callee11$(_context11) {
          while (1) {
            switch (_context11.prev = _context11.next) {
              case 0:
                options = options || {};
                fromPosition = options.fromPosition || 1;
                toPosition = options.toPosition || Math.pow(2, 31) - 1;

                if (!(fromPosition > toPosition)) {
                  _context11.next = 5;
                  break;
                }

                throw new Error('From position is greater than to position.');

              case 5:
                _context11.next = 7;
                return this.getDatabase();

              case 7:
                connection = _context11.sent;
                passThrough = new PassThrough({
                  objectMode: true
                });
                eventStream = connection.connection.execute("\n      SELECT event, position\n        FROM ".concat(this.namespace, "_events\n        WHERE position >= ?\n          AND position <= ?\n        ORDER BY position\n      "), [fromPosition, toPosition]);

                unsubscribe = function unsubscribe() {
                  connection.release();
                  eventStream.removeListener('end', onEnd);
                  eventStream.removeListener('error', onError);
                  eventStream.removeListener('result', onResult);
                };

                onEnd = function onEnd() {
                  unsubscribe();
                  passThrough.end();
                };

                onError = function onError(err) {
                  unsubscribe();
                  passThrough.emit('error', err);
                  passThrough.end();
                };

                onResult = function onResult(row) {
                  var event = Event.wrap(JSON.parse(row.event));
                  event.metadata.position = Number(row.position);
                  passThrough.write(event);
                };

                eventStream.on('end', onEnd);
                eventStream.on('error', onError);
                eventStream.on('result', onResult);
                return _context11.abrupt("return", passThrough);

              case 18:
              case "end":
                return _context11.stop();
            }
          }
        }, _callee11, this);
      }));

      function getReplay(_x9) {
        return _getReplay.apply(this, arguments);
      }

      return getReplay;
    }()
  }, {
    key: "destroy",
    value: function () {
      var _destroy = (0, _asyncToGenerator2.default)(
      /*#__PURE__*/
      _regenerator.default.mark(function _callee12() {
        return _regenerator.default.wrap(function _callee12$(_context12) {
          while (1) {
            switch (_context12.prev = _context12.next) {
              case 0:
                if (!this.pool) {
                  _context12.next = 3;
                  break;
                }

                _context12.next = 3;
                return this.pool.end();

              case 3:
              case "end":
                return _context12.stop();
            }
          }
        }, _callee12, this);
      }));

      function destroy() {
        return _destroy.apply(this, arguments);
      }

      return destroy;
    }()
  }]);
  return Eventstore;
}(EventEmitter);

module.exports = Eventstore;