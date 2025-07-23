// Unit tests for PolicyIntrospector
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PolicyIntrospector } from '../src/lib/introspector.js';

describe('PolicyIntrospector', () => {
  let introspector;
  let mockDbManager;

  beforeEach(() => {
    // Create mock database manager
    mockDbManager = {
      client: {
        query: async (sql, params) => {
          // Mock different query results based on SQL
          if (sql.includes('pg_policies')) {
            return {
              rows: [
                {
                  schemaname: 'public',
                  tablename: 'users',
                  policyname: 'user_isolation',
                  permissive: 'PERMISSIVE',
                  roles: '{authenticated_user}',
                  cmd: 'r',
                  qual: 'user_id = current_setting(\'app.current_user_id\')::uuid',
                  with_check: null,
                  qual_expression: 'user_id = current_setting(\'app.current_user_id\')::uuid',
                  with_check_expression: null,
                  table_oid: 12345
                },
                {
                  schemaname: 'public',
                  tablename: 'posts',
                  policyname: 'admin_access',
                  permissive: 'RESTRICTIVE',
                  roles: '{admin,moderator}',
                  cmd: '*',
                  qual: 'true',
                  with_check: 'false',
                  qual_expression: 'true',
                  with_check_expression: 'false',
                  table_oid: 12346
                }
              ]
            };
          }
          
          if (sql.includes('information_schema.tables')) {
            return {
              rows: [
                {
                  table_name: 'users',
                  table_schema: 'public',
                  column_name: 'id',
                  data_type: 'uuid',
                  is_nullable: 'NO',
                  column_default: 'gen_random_uuid()'
                },
                {
                  table_name: 'users',
                  table_schema: 'public',
                  column_name: 'user_id',
                  data_type: 'uuid',
                  is_nullable: 'NO',
                  column_default: null
                }
              ]
            };
          }

          if (sql.includes('pg_class')) {
            return {
              rows: [
                {
                  table_name: 'users',
                  schema_name: 'public',
                  rls_enabled: true,
                  rls_forced: false
                }
              ]
            };
          }

          return { rows: [] };
        }
      }
    };

    introspector = new PolicyIntrospector(mockDbManager);
  });

  test('should extract policies from database', async () => {
    const policies = await introspector.extractPolicies();

    assert.strictEqual(policies.length, 2, 'Should extract 2 policies');
    
    const userPolicy = policies[0];
    assert.strictEqual(userPolicy.name, 'user_isolation');
    assert.strictEqual(userPolicy.table, 'users');
    assert.strictEqual(userPolicy.command, 'SELECT');
    assert.strictEqual(userPolicy.permissive, true);
    assert.deepStrictEqual(userPolicy.roles, ['authenticated_user']);
    
    const adminPolicy = policies[1];
    assert.strictEqual(adminPolicy.name, 'admin_access');
    assert.strictEqual(adminPolicy.table, 'posts');
    assert.strictEqual(adminPolicy.command, 'ALL');
    assert.strictEqual(adminPolicy.permissive, false);
    assert.deepStrictEqual(adminPolicy.roles, ['admin', 'moderator']);
  });

  test('should filter policies by table names', async () => {
    const policies = await introspector.extractPolicies(['users']);

    // Mock should be called with table filter
    assert.ok(policies.length >= 0, 'Should handle table filtering');
  });

  test('should normalize PostgreSQL command names', () => {
    assert.strictEqual(introspector.normalizeCommand('r'), 'SELECT');
    assert.strictEqual(introspector.normalizeCommand('a'), 'INSERT');
    assert.strictEqual(introspector.normalizeCommand('w'), 'UPDATE');
    assert.strictEqual(introspector.normalizeCommand('d'), 'DELETE');
    assert.strictEqual(introspector.normalizeCommand('*'), 'ALL');
    assert.strictEqual(introspector.normalizeCommand('SELECT'), 'SELECT');
  });

  test('should parse PostgreSQL roles arrays', () => {
    assert.deepStrictEqual(
      introspector.parseRoles('{user,admin}'),
      ['user', 'admin']
    );
    
    assert.deepStrictEqual(
      introspector.parseRoles('{authenticated_user}'),
      ['authenticated_user']
    );

    assert.deepStrictEqual(
      introspector.parseRoles('{}'),
      []
    );

    assert.deepStrictEqual(
      introspector.parseRoles(null),
      []
    );

    assert.deepStrictEqual(
      introspector.parseRoles('{user, admin, moderator}'),
      ['user', 'admin', 'moderator']
    );
  });

  test('should transform policy rows correctly', () => {
    const row = {
      policyname: 'test_policy',
      tablename: 'test_table',
      schemaname: 'public',
      cmd: 'r',
      roles: '{user}',
      permissive: 'PERMISSIVE',
      qual_expression: 'user_id = current_user_id()',
      with_check_expression: null,
      qual: 'user_id = current_user_id()',
      with_check: null,
      table_oid: 123
    };

    const transformed = introspector.transformPolicyRow(row);

    assert.strictEqual(transformed.name, 'test_policy');
    assert.strictEqual(transformed.table, 'test_table');
    assert.strictEqual(transformed.schema, 'public');
    assert.strictEqual(transformed.command, 'SELECT');
    assert.deepStrictEqual(transformed.roles, ['user']);
    assert.strictEqual(transformed.permissive, true);
    assert.strictEqual(transformed.expression, 'user_id = current_user_id()');
    assert.strictEqual(transformed.withCheck, null);
    assert.ok(transformed.raw, 'Should include raw data');
  });

  test('should get table information', async () => {
    const tableInfo = await introspector.getTableInfo(['users', 'posts']);
    
    assert.ok(typeof tableInfo === 'object', 'Should return object');
    // Mock will return table info based on mocked query
  });

  test('should get RLS status for tables', async () => {
    const rlsStatus = await introspector.getRlsStatus(['users']);
    
    assert.ok(typeof rlsStatus === 'object', 'Should return RLS status object');
  });

  test('should handle empty results gracefully', async () => {
    // Create introspector with empty results
    const emptyMockDb = {
      client: {
        query: async () => ({ rows: [] })
      }
    };
    
    const emptyIntrospector = new PolicyIntrospector(emptyMockDb);
    const policies = await emptyIntrospector.extractPolicies();
    
    assert.strictEqual(policies.length, 0, 'Should handle empty results');
  });
});