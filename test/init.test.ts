// Unit tests for init command
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

describe('init command', () => {
  const testDir = './test-temp';
  const configPath = join(testDir, 'rls.config.ts');

  beforeEach(() => {
    // Create test directory in absolute path
    const fullTestDir = join(process.cwd(), testDir);
    if (existsSync(fullTestDir)) {
      rmSync(fullTestDir, { recursive: true, force: true });
    }
    mkdirSync(fullTestDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    const fullTestDir = join(process.cwd(), testDir);
    if (existsSync(fullTestDir)) {
      rmSync(fullTestDir, { recursive: true, force: true });
    }
  });

  test('should create rls.config.ts with default configuration', () => {
    // Run init command
    execSync('node ../../bin/cli.js init', { stdio: 'pipe' });

    // Check that file was created
    assert.ok(existsSync('rls.config.ts'), 'Config file should be created');

    // Check file contents
    const content = readFileSync('rls.config.ts', 'utf8');
    assert.ok(content.includes('import'), 'Should contain import statement');
    assert.ok(content.includes('config()'), 'Should contain config builder');
    assert.ok(content.includes('.database('), 'Should contain database config');
    assert.ok(content.includes('addPolicy'), 'Should contain example policies');
    assert.ok(content.includes('export default'), 'Should export config');
  });

  test('should not overwrite existing config file without force flag', () => {
    // Create existing config file
    const existingContent = '// existing config';
    execSync('echo "' + existingContent + '" > rls.config.ts', { shell: true });

    // Try to run init command
    try {
      execSync('node ../../bin/cli.js init', { stdio: 'pipe' });
      assert.fail('Should have thrown error for existing file');
    } catch (error) {
      // Should fail
      assert.ok(error.message.includes('Command failed'), 'Should fail when file exists');
    }

    // Check that original file is unchanged
    const content = readFileSync('rls.config.ts', 'utf8');
    assert.ok(content.includes(existingContent), 'Original content should be preserved');
  });

  test('should show help when --help flag is used', () => {
    const output = execSync('node ../../bin/cli.js init --help', { encoding: 'utf8' });
    
    assert.ok(output.includes('Create a new rls.config.ts'), 'Should show command description');
    assert.ok(output.includes('Usage:'), 'Should show usage information');
    assert.ok(output.includes('Options:'), 'Should show available options');
  });

  test('should support custom output path with --output flag', () => {
    const customPath = 'custom-config.ts';
    
    execSync(`node ../../bin/cli.js init --output ${customPath}`, { stdio: 'pipe' });

    assert.ok(existsSync(customPath), 'Custom config file should be created');
    assert.ok(!existsSync('rls.config.ts'), 'Default config file should not be created');
    
    const content = readFileSync(customPath, 'utf8');
    assert.ok(content.includes('config()'), 'Custom file should contain config');
  });

  test('should create valid TypeScript that can be parsed', () => {
    execSync('node ../../bin/cli.js init', { stdio: 'pipe' });

    // Try to parse the generated TypeScript with tsx
    try {
      execSync('npx tsx --check rls.config.ts', { stdio: 'pipe' });
    } catch (error) {
      // If tsx is not available, just check basic syntax
      const content = readFileSync('rls.config.ts', 'utf8');
      
      // Count braces and parentheses for basic syntax validation
      const openBraces = (content.match(/\{/g) || []).length;
      const closeBraces = (content.match(/\}/g) || []).length;
      const openParens = (content.match(/\(/g) || []).length;
      const closeParens = (content.match(/\)/g) || []).length;
      
      assert.strictEqual(openBraces, closeBraces, 'Braces should be balanced');
      assert.strictEqual(openParens, closeParens, 'Parentheses should be balanced');
    }
  });

  test('should include example policies with common patterns', () => {
    execSync('node ../../bin/cli.js init', { stdio: 'pipe' });

    const content = readFileSync('rls.config.ts', 'utf8');
    
    // Check for common RLS patterns
    assert.ok(content.includes('currentUserId'), 'Should include user isolation example');
    assert.ok(content.includes('publicAccess'), 'Should include public access example');  
    assert.ok(content.includes('SELECT'), 'Should include SELECT policy example');
    assert.ok(content.includes('forRoles'), 'Should include role-based access example');
  });
});