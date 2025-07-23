// Simplified database integration tests
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from 'pg';

describe('Database Integration Tests', () => {
  let dbConnectionString;
  let testClient;
  let testDir;
  let originalCwd;
  let hasDatabase = false;

  before(async () => {
    // Create temporary directory for test files
    const tempDirPath = join(tmpdir(), 'rls-guard-test-' + Date.now());
    mkdirSync(tempDirPath, { recursive: true });
    testDir = tempDirPath;
    originalCwd = process.cwd();
    
    // Try to connect to test database
    dbConnectionString = process.env.TEST_DATABASE_URL || 'postgresql://postgres:password@localhost:5432/rls_guard_test';
    
    try {
      testClient = new Client({ connectionString: dbConnectionString });
      await testClient.connect();
      await testClient.query('SELECT 1');
      hasDatabase = true;
      console.log('✅ Connected to test database');
      
      // Set up test schema and data
      await setupTestData();
      
    } catch (error) {
      console.log('⚠️  No test database available, running limited tests');
      console.log('   Set TEST_DATABASE_URL to run full database integration tests');
      hasDatabase = false;
      testClient = null;
    }
    
    // Change to test directory  
    process.chdir(testDir);
  });

  after(async () => {
    if (testClient) {
      await testClient.end();
    }
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
    if (originalCwd) {
      process.chdir(originalCwd);
    }
  });

  async function setupTestData() {
    // Clean up any existing test data
    await testClient.query(`
      DROP SCHEMA IF EXISTS test_schema CASCADE;
      CREATE SCHEMA test_schema;
      SET search_path TO test_schema;
    `);
    
    // Create test tables
    await testClient.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        email VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      
      CREATE TABLE posts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        title VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Enable RLS
    await testClient.query(`
      ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
    `);
    
    // Create test policies
    await testClient.query(`
      CREATE POLICY user_isolation ON users
        FOR SELECT TO authenticated_user
        USING (user_id = current_setting('app.current_user_id')::uuid);
      
      CREATE POLICY admin_access ON users  
        FOR ALL TO admin
        USING (true);
        
      CREATE POLICY recent_posts ON posts
        FOR SELECT TO public
        USING (created_at >= current_date - interval '30 days');
    `);
  }

  test('CLI shows pull command help', () => {
    const output = execSync(`node ${resolve(originalCwd, 'bin/cli.js')} pull --help`, { encoding: 'utf8' });
    assert.ok(output.includes('Extract existing RLS policies'), 'Should show pull description');
    assert.ok(output.includes('--connection'), 'Should show connection option');
  });

  test('Pull command fails without database connection', () => {
    try {
      execSync(`node ${resolve(originalCwd, 'bin/cli.js')} pull`, { stdio: 'pipe' });
      assert.fail('Should have failed without database connection');
    } catch (error) {
      assert.ok(error.status !== 0, 'Should exit with non-zero status');
    }
  });

  test('Pull command with invalid connection shows error', () => {
    try {
      execSync(`node ${resolve(originalCwd, 'bin/cli.js')} pull --connection "postgresql://invalid:invalid@nonexistent:5432/test"`, { 
        stdio: 'pipe',
        timeout: 5000
      });
      assert.fail('Should have failed with invalid connection');
    } catch (error) {
      assert.ok(error.status !== 0, 'Should exit with non-zero status');
    }
  });

  test('Pull policies from real database', async (t) => {
    if (!hasDatabase) {
      t.skip('No test database available');
      return;
    }

    const pullCmd = `node ${resolve(originalCwd, 'bin/cli.js')} pull --connection "${dbConnectionString}" --output pulled.config.ts --comments`;
    
    const output = execSync(pullCmd, { encoding: 'utf8' });
    
    assert.ok(output.includes('Successfully generated'), 'Pull command should succeed');
    assert.ok(existsSync('pulled.config.ts'), 'Config file should be created');
    
    const configContent = readFileSync('pulled.config.ts', 'utf8');
    
    // Check structure
    assert.ok(configContent.includes('import { config'), 'Should have imports');
    assert.ok(configContent.includes('export default'), 'Should export config');
    
    // Check policies
    assert.ok(configContent.includes('user_isolation'), 'Should contain user policy');
    assert.ok(configContent.includes('admin_access'), 'Should contain admin policy');
    assert.ok(configContent.includes('recent_posts'), 'Should contain posts policy');
    
    // Check helper function mapping
    assert.ok(configContent.includes('currentUserId()'), 'Should map to helper');
    assert.ok(configContent.includes('publicAccess()'), 'Should map to helper');
    assert.ok(configContent.includes('recentData('), 'Should map to helper');
  });

  test('Pull policies in JSON format', async (t) => {
    if (!hasDatabase) {
      t.skip('No test database available');
      return;
    }

    const pullCmd = `node ${resolve(originalCwd, 'bin/cli.js')} pull --connection "${dbConnectionString}" --output config.json --format json`;
    
    const output = execSync(pullCmd, { encoding: 'utf8' });
    assert.ok(output.includes('Successfully generated'), 'Should succeed');
    
    const configContent = readFileSync('config.json', 'utf8');
    const config = JSON.parse(configContent);
    
    assert.ok(config.database, 'Should have database config');
    assert.ok(Array.isArray(config.policies), 'Should have policies array');
    assert.ok(config.policies.length >= 3, 'Should have test policies');
  });

  test('Deploy configuration works with generated config', async (t) => {
    if (!hasDatabase) {
      t.skip('No test database available');
      return;
    }

    // Pull configuration
    const pullCmd = `node ${resolve(originalCwd, 'bin/cli.js')} pull --connection "${dbConnectionString}" --output deploy-test.ts`;
    execSync(pullCmd, { encoding: 'utf8' });
    
    // Test dry run
    const dryRunCmd = `node ${resolve(originalCwd, 'bin/cli.js')} deploy --config deploy-test.ts --dry-run`;
    const dryRunOutput = execSync(dryRunCmd, { encoding: 'utf8' });
    
    assert.ok(dryRunOutput.includes('CREATE POLICY') || dryRunOutput.includes('already exists'), 'Should show SQL or skip existing');
  });

  test('Filter policies by table', async (t) => {
    if (!hasDatabase) {
      t.skip('No test database available');
      return;
    }

    const pullCmd = `node ${resolve(originalCwd, 'bin/cli.js')} pull --connection "${dbConnectionString}" --output users-only.ts --tables users`;
    
    const output = execSync(pullCmd, { encoding: 'utf8' });
    assert.ok(output.includes('Successfully generated'), 'Should succeed');
    
    const configContent = readFileSync('users-only.ts', 'utf8');
    
    // Should only contain users policies
    assert.ok(configContent.includes('user_isolation'), 'Should have users policy');
    assert.ok(configContent.includes('admin_access'), 'Should have users policy');
    assert.ok(!configContent.includes('recent_posts'), 'Should not have posts policy');
  });

  test('Handle empty database gracefully', async (t) => {
    if (!hasDatabase) {
      t.skip('No test database available');
      return;
    }

    // Create empty schema
    await testClient.query(`
      DROP SCHEMA IF EXISTS empty_schema CASCADE;
      CREATE SCHEMA empty_schema;
      SET search_path TO empty_schema;
      CREATE TABLE test_table (id INT);
      ALTER TABLE test_table ENABLE ROW LEVEL SECURITY;
    `);
    
    const pullCmd = `node ${resolve(originalCwd, 'bin/cli.js')} pull --connection "${dbConnectionString}" --output empty.ts`;
    
    const output = execSync(pullCmd, { encoding: 'utf8' });
    assert.ok(output.includes('No RLS policies found'), 'Should report no policies');
    assert.ok(!existsSync('empty.ts'), 'Should not create file');
    
    // Restore test schema
    await setupTestData();
  });
});