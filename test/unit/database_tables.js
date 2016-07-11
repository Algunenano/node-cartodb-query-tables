'use strict';

var assert = require('assert');
var DatabaseTables = require('../../lib/models/database_tables');

describe('DatabaseTables', function() {

    describe('getCacheChannel', function() {
        it('should group cache-channel tables by database name', function() {
            var tables = new DatabaseTables([
                {dbname: 'db1', schema_name: 'public', table_name: 'tableone'},
                {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'}
            ]);

            assert.equal(tables.getCacheChannel(), 'db1:public.tableone,public.tabletwo');
        });

        it('should support tables coming from different databases', function() {
            var tables = new DatabaseTables([
                {dbname: 'db1', schema_name: 'public', table_name: 'tableone'},
                {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'},
                {dbname: 'db2', schema_name: 'public', table_name: 'tablethree'}
            ]);

            assert.equal(tables.getCacheChannel(), 'db1:public.tableone,public.tabletwo;;db2:public.tablethree');
        });

        describe('skipNotUpdatedAtTables', function() {
            var scenarios = [
                {
                    tables: [
                        {dbname: 'db1', schema_name: 'public', table_name: 'tableone'},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'}
                    ],
                    expectedCacheChannel: ''
                },
                {
                    tables: [
                        {dbname: 'db1', schema_name: 'public', table_name: 'tableone', updated_at: null},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'}
                    ],
                    expectedCacheChannel: ''
                },
                {
                    tables: [
                        {dbname: 'db1', schema_name: 'public', table_name: 'tableone', updated_at: undefined},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'}
                    ],
                    expectedCacheChannel: ''
                },
                {
                    tables: [
                        {dbname: 'db1', schema_name: 'public', table_name: 'tableone', updated_at: Date.now()},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'}
                    ],
                    expectedCacheChannel: 'db1:public.tableone'
                },
                {
                    tables: [
                        {dbname: 'db1', schema_name: 'public', table_name: 'tableone', updated_at: Date.now()},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo', updated_at: Date.now()}
                    ],
                    expectedCacheChannel: 'db1:public.tableone,public.tabletwo'
                },
                {
                    tables: [
                        {dbname: 'db1', schema_name: 'public', table_name: 'tableone', updated_at: Date.now()},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'},
                        {dbname: 'db2', schema_name: 'public', table_name: 'tablethree', updated_at: Date.now()}
                    ],
                    expectedCacheChannel: 'db1:public.tableone;;db2:public.tablethree'
                }
            ];
            scenarios.forEach(function(scenario) {
                it('should get an cache channel skipping tables with no updated_at', function() {
                    var tables = new DatabaseTables(scenario.tables);

                    var cacheChannel = tables.getCacheChannel(true);
                    assert.equal(cacheChannel, scenario.expectedCacheChannel);
                });
            });
        });
    });

    describe('getLastUpdatedAt', function() {

        it('should return latest of the known dates', function() {
            var tables = new DatabaseTables([
                {dbname: 'db1', schema_name: 'public', table_name: 'tableone', updated_at: new Date(12345678)},
                {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo', updated_at: new Date(1234567891)},
                {dbname: 'db2', schema_name: 'public', table_name: 'tablethree', updated_at: null}
            ]);
            assert.equal(tables.getLastUpdatedAt(), 1234567891);
        });

        it('getSafeLastUpdatedAt should return fallback date if a table date is unknown', function() {
            var tables = new DatabaseTables([
                {dbname: 'db2', schema_name: 'public', table_name: 'tablethree', updated_at: null}
            ]);
            assert.equal(tables.getLastUpdatedAt('FALLBACK'), 'FALLBACK');
        });

        it('getSafeLastUpdatedAt should return fallback date if no tables were found', function() {
            var tables = new DatabaseTables([]);
            assert.equal(tables.getLastUpdatedAt('FALLBACK'), 'FALLBACK');
        });
    });

    describe('key', function() {

        var KEY_LENGTH = 8;

        it('should get an array of keys for multiple tables', function() {
            var tables = new DatabaseTables([
                {dbname: 'db1', schema_name: 'public', table_name: 'tableone'},
                {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'}
            ]);

            var keys = tables.key();
            assert.equal(keys.length, 2);
            assert.equal(keys[0].length, KEY_LENGTH);
            assert.equal(keys[1].length, KEY_LENGTH);
        });

        it('should return proper surrogate-key (db:schema.table)', function() {
            var tables = new DatabaseTables([
                {dbname: 'db1', schema_name: 'public', table_name: 'tableone', updated_at: new Date(12345678)},
            ]);
            assert.deepEqual(tables.key(), ['t:8ny9He']);
        });
        it('should keep escaped tables escaped (db:"sch-ema".table)', function() {
            var tables = new DatabaseTables([
                {dbname: 'db1', schema_name: '"sch-ema"', table_name: 'tableone', updated_at: new Date(12345678)},
            ]);
            assert.deepEqual(tables.key(), ['t:oVg75u']);
        });

        describe('skipNotUpdatedAtTables', function() {
            var scenarios = [
                {
                    tables: [
                        {dbname: 'db1', schema_name: 'public', table_name: 'tableone'},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'}
                    ],
                    expectedLength: 0
                },
                {
                    tables: [
                        {dbname: 'db1', schema_name: 'public', table_name: 'tableone', updated_at: null},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'}
                    ],
                    expectedLength: 0
                },
                {
                    tables: [
                        {dbname: 'db1', schema_name: 'public', table_name: 'tableone', updated_at: undefined},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'}
                    ],
                    expectedLength: 0
                },
                {
                    tables: [
                        {dbname: 'db1', schema_name: 'public', table_name: 'tableone', updated_at: Date.now()},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'}
                    ],
                    expectedLength: 1
                },
                {
                    tables: [
                        {dbname: 'db1', schema_name: 'public', table_name: 'tableone', updated_at: Date.now()},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo', updated_at: Date.now()}
                    ],
                    expectedLength: 2
                },
                {
                    tables: [
                        {dbname: 'db1', schema_name: 'public', table_name: 'tableone', updated_at: Date.now()},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tabletwo'},
                        {dbname: 'db1', schema_name: 'public', table_name: 'tablethree', updated_at: Date.now()}
                    ],
                    expectedLength: 2
                }
            ];
            scenarios.forEach(function(scenario) {
                it('should get an array for multiple tables skipping the ones with no updated_at', function() {
                    var tables = new DatabaseTables(scenario.tables);

                    var keys = tables.key(true);
                    assert.equal(keys.length, scenario.expectedLength);
                    keys.forEach(function(key) {
                        assert.equal(key.length, KEY_LENGTH);
                    });
                });
            });
        });
    });
});
