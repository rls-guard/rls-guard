// Integration tests for the CLI commands
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';

describe('CLI Integration', () => {
  test('should show version', () => {
    const output = execSync('node bin/cli.js --version', { encoding: 'utf8', cwd: process.cwd() });
    assert.ok(output.includes('0.0.1'), 'Should show correct version');
  });

  test('should show help when no args provided', () => {
    const output = execSync('node bin/cli.js', { encoding: 'utf8', cwd: process.cwd() });
    assert.ok(output.includes('RLS Guard'), 'Should show RLS Guard title');
    assert.ok(output.includes('init'), 'Should show init command');
    assert.ok(output.includes('deploy'), 'Should show deploy command');
    assert.ok(output.includes('pull'), 'Should show pull command');
  });

  test('should show init command help', () => {
    const output = execSync('node bin/cli.js init --help', { encoding: 'utf8', cwd: process.cwd() });
    assert.ok(output.includes('Create a new rls.config.ts'), 'Should show init description');
    assert.ok(output.includes('Options:'), 'Should show options');
  });

  test('should show deploy command help', () => {
    const output = execSync('node bin/cli.js deploy --help', { encoding: 'utf8', cwd: process.cwd() });
    assert.ok(output.includes('Deploy RLS policies'), 'Should show deploy description');
    assert.ok(output.includes('--dry-run'), 'Should show dry-run option');
    assert.ok(output.includes('--config'), 'Should show config option');
  });

  test('should show pull command help', () => {
    const output = execSync('node bin/cli.js pull --help', { encoding: 'utf8', cwd: process.cwd() });
    assert.ok(output.includes('Extract existing RLS policies'), 'Should show pull description');
    assert.ok(output.includes('--output'), 'Should show output option');
    assert.ok(output.includes('--tables'), 'Should show tables option');
    assert.ok(output.includes('--format'), 'Should show format option');
    assert.ok(output.includes('--connection'), 'Should show connection option');
  });

  test('should fail pull command without database connection', () => {
    try {
      execSync('node bin/cli.js pull', { stdio: 'pipe', cwd: process.cwd() });
      assert.fail('Should have failed without database connection');
    } catch (error) {
      assert.ok(error.status !== 0, 'Should exit with non-zero status');
      const errorOutput = error.stderr?.toString() || '';
      assert.ok(
        errorOutput.includes('connection') || errorOutput.includes('DATABASE_URL'),
        'Should show connection error'
      );
    }
  });

  test('should fail deploy command without config file', () => {
    try {
      execSync('node bin/cli.js deploy --dry-run', { stdio: 'pipe', cwd: '/tmp' });
      assert.fail('Should have failed without config file');
    } catch (error) {
      assert.ok(error.status !== 0, 'Should exit with non-zero status');
    }
  });
});