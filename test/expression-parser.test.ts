// Unit tests for expression parser
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseExpression, generateHelperCall, analyzeExpression } from '../src/lib/expression-parser.js';

describe('Expression Parser', () => {
  describe('parseExpression', () => {
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

      const customColumn = parseExpression("owner_id = current_setting('app.current_user_id')::uuid");
      assert.strictEqual(customColumn.helper, 'currentUserId');
      assert.strictEqual(customColumn.params.column, 'owner_id');
    });

    test('should parse tenantId expressions', () => {
      const result = parseExpression("tenant_id = current_setting('app.tenant_id')::uuid");
      assert.strictEqual(result.helper, 'tenantId');
      assert.strictEqual(result.params.column, 'tenant_id');
      assert.strictEqual(result.confidence, 0.9);
    });

    test('should parse roleCheck expressions', () => {
      const result = parseExpression("current_setting('app.user_role') = 'admin'");
      assert.strictEqual(result.helper, 'roleCheck');
      assert.strictEqual(result.params.role, 'admin');
      assert.strictEqual(result.confidence, 0.9);
    });

    test('should parse recentData expressions', () => {
      const result = parseExpression("created_at >= current_date - interval '30 days'");
      assert.strictEqual(result.helper, 'recentData');
      assert.strictEqual(result.params.column, 'created_at');
      assert.strictEqual(result.params.days, 30);
      assert.strictEqual(result.confidence, 0.8);
    });

    test('should parse timeWindow expressions', () => {
      const result = parseExpression("updated_at >= now() - interval '24 hours'");
      assert.strictEqual(result.helper, 'timeWindow');
      assert.strictEqual(result.params.column, 'updated_at');
      assert.strictEqual(result.params.hours, 24);
      assert.strictEqual(result.confidence, 0.8);
    });

    test('should parse ownerOnly expressions', () => {
      const result = parseExpression("user_id = owner_id");
      assert.strictEqual(result.helper, 'ownerOnly');
      assert.strictEqual(result.params.userColumn, 'user_id');
      assert.strictEqual(result.params.ownerColumn, 'owner_id');
      assert.strictEqual(result.confidence, 0.6);
    });

    test('should handle complex expressions with AND/OR', () => {
      const result = parseExpression("user_id = current_setting('app.current_user_id')::uuid AND status = 'active'");
      assert.strictEqual(result.helper, 'complex');
      assert.ok(result.conditions.length > 0, 'Should have parsed conditions');
    });

    test('should handle unknown expressions as custom', () => {
      const result = parseExpression("some_custom_function() = 'value'");
      assert.strictEqual(result.helper, 'custom');
      assert.strictEqual(result.confidence, 0.0);
      assert.ok(result.reason, 'Should include reason for custom classification');
    });

    test('should handle empty or null expressions', () => {
      const nullResult = parseExpression(null);
      assert.strictEqual(nullResult.helper, 'publicAccess');

      const emptyResult = parseExpression('');
      assert.strictEqual(emptyResult.helper, 'publicAccess');

      const whitespaceResult = parseExpression('   ');
      assert.strictEqual(whitespaceResult.helper, 'publicAccess');
    });

    test('should be case insensitive', () => {
      const result = parseExpression("USER_ID = CURRENT_SETTING('app.current_user_id')::UUID");
      assert.strictEqual(result.helper, 'currentUserId');
      assert.strictEqual(result.params.column, 'USER_ID');
    });
  });

  describe('generateHelperCall', () => {
    test('should generate publicAccess calls', () => {
      const parsed = { helper: 'publicAccess' };
      const call = generateHelperCall(parsed);
      assert.strictEqual(call, 'publicAccess()');
    });

    test('should generate noAccess calls', () => {
      const parsed = { helper: 'noAccess' };
      const call = generateHelperCall(parsed);
      assert.strictEqual(call, 'noAccess()');
    });

    test('should generate currentUserId calls with default column', () => {
      const parsed = { helper: 'currentUserId', params: { column: 'user_id' } };
      const call = generateHelperCall(parsed);
      assert.strictEqual(call, 'currentUserId()');
    });

    test('should generate currentUserId calls with custom column', () => {
      const parsed = { helper: 'currentUserId', params: { column: 'owner_id' } };
      const call = generateHelperCall(parsed);
      assert.strictEqual(call, 'currentUserId("owner_id")');
    });

    test('should generate tenantId calls', () => {
      const parsed = { helper: 'tenantId', params: { column: 'tenant_id' } };
      const call = generateHelperCall(parsed);
      assert.strictEqual(call, 'tenantId()');

      const customParsed = { helper: 'tenantId', params: { column: 'org_id' } };
      const customCall = generateHelperCall(customParsed);
      assert.strictEqual(customCall, 'tenantId("org_id")');
    });

    test('should generate roleCheck calls', () => {
      const parsed = { helper: 'roleCheck', params: { role: 'admin' } };
      const call = generateHelperCall(parsed);
      assert.strictEqual(call, 'roleCheck("admin")');
    });

    test('should generate recentData calls with defaults', () => {
      const parsed = { helper: 'recentData', params: { column: 'created_at', days: 90 } };
      const call = generateHelperCall(parsed);
      assert.strictEqual(call, 'recentData()');
    });

    test('should generate recentData calls with custom values', () => {
      const parsed = { helper: 'recentData', params: { column: 'updated_at', days: 30 } };
      const call = generateHelperCall(parsed);
      assert.strictEqual(call, 'recentData("updated_at", 30)');
    });

    test('should generate timeWindow calls', () => {
      const parsed = { helper: 'timeWindow', params: { column: 'last_seen', hours: 24 } };
      const call = generateHelperCall(parsed);
      assert.strictEqual(call, 'timeWindow("last_seen", 24)');
    });

    test('should generate ownerOnly calls with defaults', () => {
      const parsed = { helper: 'ownerOnly', params: { userColumn: 'user_id', ownerColumn: 'owner_id' } };
      const call = generateHelperCall(parsed);
      assert.strictEqual(call, 'ownerOnly()');
    });

    test('should generate ownerOnly calls with custom columns', () => {
      const parsed = { helper: 'ownerOnly', params: { userColumn: 'current_user', ownerColumn: 'created_by' } };
      const call = generateHelperCall(parsed);
      assert.strictEqual(call, 'ownerOnly("current_user", "created_by")');
    });

    test('should handle complex expressions', () => {
      const parsed = { 
        helper: 'complex', 
        raw: 'user_id = current_user AND status = active',
        conditions: []
      };
      const call = generateHelperCall(parsed);
      assert.ok(call.includes(parsed.raw), 'Should include raw expression in comment');
    });

    test('should handle custom expressions', () => {
      const parsed = { helper: 'custom', raw: 'custom_function() = true' };
      const call = generateHelperCall(parsed);
      assert.strictEqual(call, '"custom_function() = true"');
    });

    test('should handle null or undefined parsed objects', () => {
      const call = generateHelperCall(null);
      assert.ok(call.includes('"'), 'Should return quoted string for null input');

      const undefinedCall = generateHelperCall(undefined);
      assert.ok(undefinedCall.includes('"'), 'Should return quoted string for undefined input');
    });
  });

  describe('analyzeExpression', () => {
    test('should warn about low confidence mappings', () => {
      const parsed = { helper: 'ownerOnly', confidence: 0.3 };
      const analysis = analyzeExpression(parsed);

      assert.ok(analysis.warnings.length > 0, 'Should have warnings for low confidence');
      assert.ok(analysis.suggestions.length > 0, 'Should have suggestions for low confidence');
    });

    test('should suggest improvements for custom expressions', () => {
      const parsed = { helper: 'custom', confidence: 0.0 };
      const analysis = analyzeExpression(parsed);

      assert.ok(analysis.suggestions.length > 0, 'Should have suggestions for custom expressions');
      assert.ok(
        analysis.suggestions.some(s => s.includes('helper function')),
        'Should suggest helper function usage'
      );
    });

    test('should warn about ambiguous ownerOnly patterns', () => {
      const parsed = { helper: 'ownerOnly', confidence: 0.6 };
      const analysis = analyzeExpression(parsed);

      assert.ok(
        analysis.warnings.some(w => w.includes('Simple column comparison')),
        'Should warn about simple column comparisons'
      );
    });

    test('should handle high confidence expressions without warnings', () => {
      const parsed = { helper: 'currentUserId', confidence: 0.9 };
      const analysis = analyzeExpression(parsed);

      assert.strictEqual(analysis.warnings.length, 0, 'Should not have warnings for high confidence');
      assert.strictEqual(analysis.confidence, 0.9, 'Should preserve confidence score');
    });
  });
});