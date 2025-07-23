// Rename this file to lib-only.test.ts and add TypeScript type annotations.

// Unit tests for library components only (no CLI execution)
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { PolicyIntrospector } from '../src/lib/introspector.js';
import { parseExpression, generateHelperCall, analyzeExpression } from '../src/lib/expression-parser.js';
import { ConfigGenerator } from '../src/lib/generator.js';

describe('PolicyIntrospector', () => {
  let introspector: PolicyIntrospector;
  let mockDbManager: any;

  beforeEach(() => {
    mockDbManager = {
      client: {
        query: async (sql: string, params: any) => {
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

  test('should normalize PostgreSQL command names', () => {
    assert.strictEqual(introspector.normalizeCommand('r'), 'SELECT');
    assert.strictEqual(introspector.normalizeCommand('a'), 'INSERT');
    assert.strictEqual(introspector.normalizeCommand('w'), 'UPDATE');
    assert.strictEqual(introspector.normalizeCommand('d'), 'DELETE');
    assert.strictEqual(introspector.normalizeCommand('*'), 'ALL');
  });

  test('should parse PostgreSQL roles arrays', () => {
    assert.deepStrictEqual(introspector.parseRoles('{user,admin}'), ['user', 'admin']);
    assert.deepStrictEqual(introspector.parseRoles('{authenticated_user}'), ['authenticated_user']);
    assert.deepStrictEqual(introspector.parseRoles('{}'), []);
    assert.deepStrictEqual(introspector.parseRoles(null), []);
  });

  test('should extract policies from database', async () => {
    const policies = await introspector.extractPolicies();
    assert.strictEqual(policies.length, 1);
    assert.strictEqual(policies[0].name, 'user_isolation');
    assert.strictEqual(policies[0].command, 'SELECT');
  });
});

describe('Expression Parser', () => {
  test('should parse simple boolean values', () => {
    const trueResult = parseExpression('true');
    assert.strictEqual(trueResult.helper, 'publicAccess');
    assert.strictEqual(trueResult.confidence, 1.0);

    const falseResult = parseExpression('false');
    assert.strictEqual(falseResult.helper, 'noAccess');
    assert.strictEqual(falseResult.confidence, 1.0);
  });

  test('should parse currentUserId expressions', () => {
    const result = parseExpression("user_id = current_setting('app.current_user_id')::uuid");
    assert.strictEqual(result.helper, 'currentUserId');
    assert.strictEqual(result.params.column, 'user_id');
    assert.strictEqual(result.confidence, 0.9);
  });

  test('should parse tenantId expressions', () => {
    const result = parseExpression("tenant_id = current_setting('app.tenant_id')::uuid");
    assert.strictEqual(result.helper, 'tenantId');
    assert.strictEqual(result.params.column, 'tenant_id');
    assert.strictEqual(result.confidence, 0.9);
  });

  test('should generate helper calls', () => {
    assert.strictEqual(generateHelperCall({ helper: 'publicAccess' }), 'publicAccess()');
    assert.strictEqual(generateHelperCall({ helper: 'noAccess' }), 'noAccess()');
    
    const currentUserResult = generateHelperCall({ 
      helper: 'currentUserId', 
      params: { column: 'user_id' } 
    });
    assert.strictEqual(currentUserResult, 'currentUserId()');
  });

  test('should analyze expressions', () => {
    const parsed = { helper: 'custom', confidence: 0.0 };
    const analysis = analyzeExpression(parsed);
    assert.ok(analysis.suggestions.length > 0);
  });
});

describe('ConfigGenerator', () => {
  let generator: ConfigGenerator;
  const samplePolicies = [
    {
      name: 'user_isolation',
      table: 'users',
      schema: 'public',
      command: 'SELECT',
      roles: ['authenticated_user'],
      permissive: true,
      expression: "user_id = current_setting('app.current_user_id')::uuid",
      withCheck: null
    }
  ];

  beforeEach(() => {
    generator = new ConfigGenerator({
      format: 'typescript',
      addComments: false,
      maskConnection: true,
      connectionString: 'postgresql://user:pass@localhost:5432/mydb'
    });
  });

  test('should generate TypeScript config', () => {
    const config = generator.generateConfig(samplePolicies);
    assert.ok(config.includes('import'), 'Should contain import statements');
    assert.ok(config.includes('config()'), 'Should contain config builder');
    assert.ok(config.includes('.addPolicy'), 'Should contain policies');
    assert.ok(config.includes('export default'), 'Should export config');
  });

  test('should generate JSON config', () => {
    generator.options.format = 'json';
    const config = generator.generateConfig(samplePolicies);
    const parsed = JSON.parse(config);
    assert.ok(parsed.database, 'Should have database config');
    assert.ok(Array.isArray(parsed.policies), 'Should have policies array');
  });

  test('should format roles correctly', () => {
    assert.strictEqual(generator.formatRoles(['user']), '"user"');
    assert.strictEqual(generator.formatRoles(['admin', 'user']), '"admin", "user"');
    assert.strictEqual(generator.formatRoles([]), '"public"');
  });

  test('should mask connection strings', () => {
    const original = 'postgresql://user:secret123@localhost:5432/mydb';
    const masked = generator.maskConnectionString(original);
    assert.ok(masked.includes('user:***@'));
    assert.ok(!masked.includes('secret123'));
  });

  test('should group policies by table', () => {
    const grouped = generator.groupPoliciesByTable(samplePolicies);
    assert.ok(grouped.users);
    assert.strictEqual(grouped.users.length, 1);
  });
});