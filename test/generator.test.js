// Unit tests for ConfigGenerator
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ConfigGenerator } from '../src/lib/generator.js';

describe('ConfigGenerator', () => {
  let generator;
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
    },
    {
      name: 'admin_access',
      table: 'users',
      schema: 'public',
      command: 'ALL',
      roles: ['admin'],
      permissive: true,
      expression: 'true',
      withCheck: null
    },
    {
      name: 'restrictive_policy',
      table: 'sensitive_data',
      schema: 'public',
      command: 'SELECT',
      roles: ['public'],
      permissive: false,
      expression: 'false',
      withCheck: 'false'
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

  describe('generateConfig', () => {
    test('should generate TypeScript config by default', () => {
      const config = generator.generateConfig(samplePolicies);
      
      assert.ok(config.includes('import'), 'Should contain import statements');
      assert.ok(config.includes('config()'), 'Should contain config builder');
      assert.ok(config.includes('.addPolicy'), 'Should contain policies');
      assert.ok(config.includes('export default'), 'Should export config');
    });

    test('should generate JSON config when format is json', () => {
      generator.options.format = 'json';
      const config = generator.generateConfig(samplePolicies);
      
      const parsed = JSON.parse(config);
      assert.ok(parsed.database, 'Should have database config');
      assert.ok(Array.isArray(parsed.policies), 'Should have policies array');
      assert.strictEqual(parsed.policies.length, 3, 'Should have all policies');
    });
  });

  describe('generateTypeScriptConfig', () => {
    test('should include proper imports', () => {
      const config = generator.generateTypeScriptConfig(samplePolicies);
      
      assert.ok(config.includes("import { config"), 'Should import config');
      assert.ok(config.includes('currentUserId'), 'Should import helper functions');
      assert.ok(config.includes('publicAccess'), 'Should import helper functions');
    });

    test('should generate database configuration', () => {
      const config = generator.generateTypeScriptConfig(samplePolicies);
      
      assert.ok(config.includes('.database(db => db'), 'Should have database config');
      assert.ok(config.includes('.connectionUrl'), 'Should have connection URL');
    });

    test('should generate policy configurations', () => {
      const config = generator.generateTypeScriptConfig(samplePolicies);
      
      assert.ok(config.includes('.addPolicy(p => p'), 'Should have policy builder');
      assert.ok(config.includes('.name("user_isolation")'), 'Should have policy names');
      assert.ok(config.includes('.onTable("users")'), 'Should have table names');
      assert.ok(config.includes('.forCommand("SELECT")'), 'Should have commands');
      assert.ok(config.includes('.forRoles("authenticated_user")'), 'Should have roles');
    });

    test('should handle restrictive policies', () => {
      const config = generator.generateTypeScriptConfig(samplePolicies);
      
      assert.ok(config.includes('.asRestrictive()'), 'Should mark restrictive policies');
    });

    test('should include comments when enabled', () => {
      generator.options.addComments = true;
      const config = generator.generateTypeScriptConfig(samplePolicies);
      
      assert.ok(config.includes('//'), 'Should contain comments');
      assert.ok(config.includes('Generated from'), 'Should have generation comment');
    });
  });

  describe('generateSinglePolicy', () => {
    test('should generate basic policy configuration', () => {
      const policy = samplePolicies[0];
      const policyConfig = generator.generateSinglePolicy(policy);
      
      assert.ok(policyConfig.includes('.name("user_isolation")'), 'Should have policy name');
      assert.ok(policyConfig.includes('.onTable("users")'), 'Should have table name');
      assert.ok(policyConfig.includes('.forCommand("SELECT")'), 'Should have command');
      assert.ok(policyConfig.includes('.forRoles("authenticated_user")'), 'Should have roles');
    });

    test('should map expressions to helper functions', () => {
      const policy = samplePolicies[0];
      const policyConfig = generator.generateSinglePolicy(policy);
      
      assert.ok(policyConfig.includes('currentUserId()'), 'Should map to currentUserId helper');
    });

    test('should handle multiple roles', () => {
      const multiRolePolicy = {
        ...samplePolicies[0],
        roles: ['admin', 'moderator', 'user']
      };
      
      const policyConfig = generator.generateSinglePolicy(multiRolePolicy);
      assert.ok(policyConfig.includes('"admin", "moderator", "user"'), 'Should format multiple roles');
    });

    test('should add asRestrictive for non-permissive policies', () => {
      const restrictivePolicy = samplePolicies[2];
      const policyConfig = generator.generateSinglePolicy(restrictivePolicy);
      
      assert.ok(policyConfig.includes('.asRestrictive()'), 'Should add asRestrictive');
    });
  });

  describe('formatRoles', () => {
    test('should format single role', () => {
      const formatted = generator.formatRoles(['user']);
      assert.strictEqual(formatted, '"user"');
    });

    test('should format multiple roles', () => {
      const formatted = generator.formatRoles(['admin', 'user']);
      assert.strictEqual(formatted, '"admin", "user"');
    });

    test('should handle empty roles array', () => {
      const formatted = generator.formatRoles([]);
      assert.strictEqual(formatted, '"public"');
    });

    test('should handle null roles', () => {
      const formatted = generator.formatRoles(null);
      assert.strictEqual(formatted, '"public"');
    });
  });

  describe('groupPoliciesByTable', () => {
    test('should group policies by table name', () => {
      const grouped = generator.groupPoliciesByTable(samplePolicies);
      
      assert.ok(grouped.users, 'Should have users table group');
      assert.ok(grouped.sensitive_data, 'Should have sensitive_data table group');
      assert.strictEqual(grouped.users.length, 2, 'Should have 2 policies for users table');
      assert.strictEqual(grouped.sensitive_data.length, 1, 'Should have 1 policy for sensitive_data table');
    });

    test('should sort policies within each table by name', () => {
      const grouped = generator.groupPoliciesByTable(samplePolicies);
      
      const userPolicies = grouped.users;
      assert.ok(userPolicies[0].name <= userPolicies[1].name, 'Policies should be sorted by name');
    });
  });

  describe('maskConnectionString', () => {
    test('should mask password in connection string', () => {
      const original = 'postgresql://user:secret123@localhost:5432/mydb';
      const masked = generator.maskConnectionString(original);
      
      assert.ok(masked.includes('user:***@'), 'Should mask password');
      assert.ok(!masked.includes('secret123'), 'Should not contain original password');
      assert.ok(masked.includes('localhost:5432/mydb'), 'Should preserve other parts');
    });

    test('should handle connection strings without password', () => {
      const original = 'postgresql://user@localhost:5432/mydb';
      const masked = generator.maskConnectionString(original);
      
      // Should not crash on strings without password
      assert.ok(masked.includes('user@localhost'), 'Should preserve original format');
    });
  });

  describe('generatePolicyComments', () => {
    test('should generate comments for low confidence expressions', () => {
      generator.options.addComments = true;
      
      const policy = samplePolicies[0];
      const parsed = { helper: 'custom', confidence: 0.3 };
      const analysis = { warnings: ['Low confidence'], suggestions: [] };
      
      const comments = generator.generatePolicyComments(policy, parsed, analysis);
      
      assert.ok(comments.includes('//'), 'Should contain comment markers');
      assert.ok(comments.includes('confidence'), 'Should mention confidence');
      assert.ok(comments.includes('Low confidence'), 'Should include warnings');
    });

    test('should include with_check information when present', () => {
      generator.options.addComments = true;
      
      const policy = {
        ...samplePolicies[0],
        withCheck: 'user_id = current_user_id()'
      };
      
      const parsed = { helper: 'currentUserId', confidence: 0.9 };
      const analysis = { warnings: [], suggestions: [] };
      
      const comments = generator.generatePolicyComments(policy, parsed, analysis);
      
      assert.ok(comments.includes('WITH CHECK'), 'Should mention WITH CHECK');
    });
  });

  describe('options handling', () => {
    test('should use default options when not provided', () => {
      const defaultGenerator = new ConfigGenerator();
      
      assert.strictEqual(defaultGenerator.options.format, 'typescript');
      assert.strictEqual(defaultGenerator.options.addComments, false);
      assert.strictEqual(defaultGenerator.options.maskConnection, true);
    });

    test('should override default options', () => {
      const customGenerator = new ConfigGenerator({
        format: 'json',
        addComments: true,
        maskConnection: false
      });
      
      assert.strictEqual(customGenerator.options.format, 'json');
      assert.strictEqual(customGenerator.options.addComments, true);
      assert.strictEqual(customGenerator.options.maskConnection, false);
    });
  });
});