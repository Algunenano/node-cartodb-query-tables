'use strict';

const assert = require('assert');
const QueryTables = require('../../lib/querytables');
const SubstitutionTokens = require('../../lib/utils/substitution_tokens');
const PSQL = require('cartodb-psql');

describe('QueryTables', function() {

    /* Auxiliar function to create a mocked connection */
    function createMockConnection(err, rows) {
        return {
            query: function(sql, params, callback, readonly) {
                if (typeof params === 'function') {
                  readonly = callback;
                  callback = params;
                  params = [];
                }
                // Queries should never contain tokens
                assert.equal(SubstitutionTokens.hasTokens(sql), false);

                const result = err ? null : { rows: rows };
                return callback(err, result);
            }
        };
    }

    /* Auxiliar function to create a database connection */
    function createDBConnection() {
        const dbParams = Object.assign({}, require('../test_config').postgres);
        const dbPoolParams = {};
        let connection;
        assert.doesNotThrow(() => { connection = new PSQL(dbParams, dbPoolParams);});
        assert.ok(connection);
        return connection;
    }

    /* Auxiliar function to create a connection to the FDW database */
    function createFDWDBConnection() {
        const dbParams = Object.assign({}, require('../test_config').postgres);
        dbParams.dbname = dbParams.fdw_dbname;
        const dbPoolParams = {};
        let connection;
        assert.doesNotThrow(() => { connection = new PSQL(dbParams, dbPoolParams);});
        assert.ok(connection);
        return connection;
    }

    describe('getQueryStatements', function() {
        /* These tests come from cartodb-postgresql (test/CDB_QueryStatementsTest.sql) */
        let connection;
        before((done) => {
            connection = createDBConnection();
            done();
        });

        after(done => {
            connection.end();
            done();
        });

        it('Should work with a standard query', function(done) {
            const s = QueryTables.getQueryStatements('SELECT * FROM geometry_columns;');
            assert.equal(s.length, 1);
            assert.equal(s[0], 'SELECT * FROM geometry_columns');
            done();
        });

        it('Should work with a query without ";"', function(done) {
            const s = QueryTables.getQueryStatements('SELECT * FROM geometry_columns');
            assert.equal(s.length, 1);
            assert.equal(s[0], 'SELECT * FROM geometry_columns');
            done();
        });

        it('Should work with a query starting with ";"', function(done) {
            const s = QueryTables.getQueryStatements(';;;;SELECT * FROM geometry_columns');
            assert.equal(s.length, 1);
            assert.equal(s[0], 'SELECT * FROM geometry_columns');
            done();
        });

        it('Should work with multiqueries', function(done) {
            const s = QueryTables.getQueryStatements(`
SELECT * FROM geometry_columns;
SELECT 1;
SELECT 2 = 3;
`);
            assert.equal(s.length, 3);
            assert.equal(s[0], `SELECT * FROM geometry_columns`);
            assert.equal(s[1], `SELECT 1`);
            assert.equal(s[2], `SELECT 2 = 3`);

            done();
        });

        it('Should work with quoted commands', function(done) {
/* jshint ignore:start */
            const s = QueryTables.getQueryStatements(`
CREATE table "my'tab;le" ("$" int);
SELECT '1','$$', '$hello$', "$" FROM "my'tab;le";
CREATE function "hi'there" ("'" text default '$') returns void as $h$ declare a int; b text; begin b='hi'; return; end; $h$ language 'plpgsql';
SELECT 5;
`);
            assert.equal(s.length, 4);
            assert.equal(s[0], `CREATE table "my'tab;le" ("$" int)`);
            assert.equal(s[1], `SELECT '1','$$', '$hello$', "$" FROM "my'tab;le"`);
            assert.equal(s[2], `CREATE function "hi'there" ("'" text default '$') returns void as $h$ declare a int; b text; begin b='hi'; return; end; $h$ language 'plpgsql'`);
            assert.equal(s[3], `SELECT 5`);
/* jshint ignore:end */
            done();
        });

        it('Should work with quoted inserts', function(done) {
            const s = QueryTables.getQueryStatements(`
INSER INTO "my''""t" values ('''','""'';;');
SELECT $qu;oted$ hi $qu;oted$;
`);
            assert.equal(s.length, 2);
            assert.equal(s[0], `INSER INTO "my''""t" values ('''','""'';;')`);
            assert.equal(s[1], `SELECT $qu;oted$ hi $qu;oted$`);
            done();
        });

        it('Should work with line breaks mid sentence', function(done) {
            const s = QueryTables.getQueryStatements(`
SELECT
1 ; SELECT
2
`);
            assert.equal(s.length, 2);
            assert.equal(s[0], `SELECT
1`);
            assert.equal(s[1], `SELECT
2`);
            done();
        });

        // This is an insane input, illegal sql
        // we are really only testing that it does not
        // take forever to process..
        // The actual result is not correct, so if the function
        // ever gets fixed check if it's better
        it('Should not crash with illegal sql', function(done) {
            const s = QueryTables.getQueryStatements(`

    /a
    $b$
    $c$d
    ;
`);
            assert.ok(s);
            done();
        });

        it('Should work with quoted values', function(done) {
            const s = QueryTables.getQueryStatements(`
SELECT $quoted$ hi
$quoted$;
`);
            assert.equal(s.length, 1);
            assert.equal(s[0], `SELECT $quoted$ hi
$quoted$`);
            done();
        });
    });

    describe('getQueryMetadataModel', function() {
        let connection;
        let fdw_connection;
        const db = require('../test_config').postgres;

        before((done) => {
            connection = createDBConnection();
            fdw_connection = createFDWDBConnection();

            const params = {};
            const readOnly = false;

            fdw_connection.query(`
                CREATE SCHEMA IF NOT EXISTS remote_schema;
                CREATE TABLE IF NOT EXISTS remote_schema.remote_table ( a integer );
            `, params, (err) => {
                assert.ok(!err, err);

            connection.query(`
                    CREATE SCHEMA IF NOT EXISTS cartodb;
                    CREATE TABLE IF NOT EXISTS cartodb.CDB_TableMetadata (
                        tabname regclass not null primary key,
                        updated_at timestamp with time zone not null default now()
                      );
                    CREATE TABLE t1(a integer);
                    CREATE TABLE t2(a integer);
                    CREATE TABLE t3(b text);
                    CREATE TABLE "t with space" (a integer);
                    CREATE TABLE "tablena\'me" (a integer);

                    CREATE SCHEMA IF NOT EXISTS local_fdw;
                    CREATE EXTENSION postgres_fdw;
                    CREATE SERVER remote_server
                        FOREIGN DATA WRAPPER postgres_fdw
                        OPTIONS (host '${db.host}', port '${db.port}', dbname '${db.fdw_dbname}');
                    CREATE USER MAPPING FOR ${db.user}
                        SERVER remote_server
                        OPTIONS (user '${db.user}' ${db.password ? `, password '${db.password}'` : ''});
                    IMPORT FOREIGN SCHEMA remote_schema
                    FROM SERVER remote_server INTO local_fdw;

                    `, params, (err) => {
                assert.ok(!err, err);
                done();
            }, readOnly);


            }, readOnly);
        });

        after(done => {
            connection.end();
            fdw_connection.end();
            done();
        });

        const queries = [
            { sql : 'TABLE t1;',
              expected : `${db.dbname}:public.t1` },
            { sql : 'SELECT * FROM t2;',
              expected : `${db.dbname}:public.t2` },
            { sql : 'SELECT * FROM t2',
              expected : `${db.dbname}:public.t2` },
            { sql : 'SELECT * FROM t1 UNION ALL SELECT * from t2;',
              expected : `${db.dbname}:public.t1,public.t2` },
            { sql : 'SELECT * FROM t1 NATURAL JOIN "t with space";',
              expected : `${db.dbname}:public.t1,public."t with space"`},
            { sql : 'WITH s1 AS (SELECT * FROM t1) SELECT * FROM t2;',
              expected : `${db.dbname}:public.t2`},
            { sql : 'SELECT 1;',
              expected : '' },
            { sql : 'TABLE t1; TABLE t2;',
              expected : `${db.dbname}:public.t1,public.t2`},
            { sql : "Select * from t3 where b = ';'; TABLE t2",
              expected : `${db.dbname}:public.t2,public.t3`},
            { sql : 'TABLE t1; TABLE t1;',
              expected : `${db.dbname}:public.t1`},
            { sql : 'SELECT * FROM "tablena\'me";',
              expected : `${db.dbname}:public."tablena'me"`},
            { sql : 'SELECT * FROM local_fdw.remote_table',
              expected : `${db.fdw_dbname}:local_fdw.remote_table`}
        ];

        // TODO: Test updated_at (fdw and not)

        queries.forEach(q => {
            it('should return a DatabaseTables model (' + q.sql + ')', function(done) {

                QueryTables.getQueryMetadataModel(connection, q.sql, function (err, result) {
                    assert.ok(!err, err);
                    assert.ok(result);
                    assert.equal(result.getCacheChannel(), q.expected);
                    return done();
                });
            });
        });


        const tokens = ['pixel_width', 'pixel_height', 'scale_denominator'];
        tokens.forEach(token => {
            it('should not call Postgres with token: ' + token, function(done) {

                const query = 'Select 1 from t1 where 1 != ' + '!' + token + '!';
                QueryTables.getQueryMetadataModel(connection, query, function (err, result) {
                    assert.ok(!err, err);
                    assert.ok(result);
                    assert.equal(result.getCacheChannel(), `${db.dbname}:public.t1`);
                    return done();
                });
            });
        });

        it('should not call Postgres with token: bbox', function(done) {

            const query = 'Select 1 from t1 where 1 != ST_Area(!bbox!)';
            QueryTables.getQueryMetadataModel(connection, query, function (err, result) {
                assert.ok(!err, err);
                assert.ok(result);
                assert.equal(result.getCacheChannel(), `${db.dbname}:public.t1`);
                return done();
            });
        });

        it('should rethrow db errors', function(done) {
            const mockConnection = createMockConnection(new Error('foo-bar-error'));
            QueryTables.getQueryMetadataModel(mockConnection, 'foo-bar-query', function (err) {
                assert.ok(err);
                assert.ok(err.message.match(/foo-bar-error/));
                return done();
            });
        });

    });

});
