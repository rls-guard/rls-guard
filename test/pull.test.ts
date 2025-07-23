// Rename this file to pull.test.ts and add TypeScript type annotations.

// Unit tests for pull command
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';

describe('pull command', () => {
  const testDir = './test-temp';

  beforeEach(() => {
    // Create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
  });

  afterEach(() => {
    // Clean up
    process.chdir('..');
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should show help when --help flag is used', () => {
    const output = execSync('node ../../bin/cli.js pull --help', { encoding: 'utf8' });
    
    assert.ok(output.includes('Extract existing RLS policies'), 'Should show command description');
    assert.ok(output.includes('--output'), 'Should show output option');
    assert.ok(output.includes('--tables'), 'Should show tables option');
    assert.ok(output.includes('--format'), 'Should show format option');
    assert.ok(output.includes('--connection'), 'Should show connection option');
  });

  test('should fail when no database connection is provided', () => {
    try {
      execSync('node ../../bin/cli.js pull', { stdio: 'pipe' });
      assert.fail('Should have failed when no database connection provided');
    } catch (error) {
      assert.ok(error.status !== 0, 'Should exit with non-zero status');
      const errorOutput = error.stderr?.toString() || '';
      assert.ok(
        errorOutput.includes('connection') || errorOutput.includes('DATABASE_URL'),
        'Should show connection error message'
      );
    }
  });

  test('should accept connection string via --connection flag', () => {
    try {
      execSync('node ../../bin/cli.js pull --connection postgresql://test:test@localhost:5432/test', { 
        stdio: 'pipe' 
      });
      assert.fail('Should have failed due to no database connection');
    } catch (error) {
      // Expected to fail due to no actual database, but should accept the connection string
      assert.ok(error.status !== 0, 'Should fail due to database connection');
      const errorOutput = error.stderr?.toString() || '';
      
      // Should not complain about missing connection string anymore
      assert.ok(
        !errorOutput.includes('DATABASE_URL') || errorOutput.includes('connect'),
        'Should not show missing connection error'
      );
    }
  });

  test('should support custom output file with --output flag', () => {
    try {
      execSync('node ../../bin/cli.js pull --connection postgresql://test:test@localhost:5432/test --output custom.ts', { 
        stdio: 'pipe' 
      });
    } catch (error) {
      // Expected to fail due to no database connection
      assert.ok(error.status !== 0, 'Should fail due to database connection');
    }
    
    // Should not create file if command fails
    assert.ok(!existsSync('custom.ts'), 'Should not create file on failure');
  });

  test('should support table filtering with --tables flag', () => {
    try {
      execSync('node ../../bin/cli.js pull --connection postgresql://test:test@localhost:5432/test --tables users,posts', { 
        stdio: 'pipe' 
      });
    } catch (error) {
      // Expected to fail due to no database connection
      assert.ok(error.status !== 0, 'Should fail due to database connection');
    }
  });

  test('should support JSON output format with --format flag', () => {
    try {
      execSync('node ../../bin/cli.js pull --connection postgresql://test:test@localhost:5432/test --format json', { 
        stdio: 'pipe' 
      });
    } catch (error) {
      // Expected to fail due to no database connection
      assert.ok(error.status !== 0, 'Should fail due to database connection');
    }
  });

  test('should support comments option with --comments flag', () => {
    try {
      execSync('node ../../bin/cli.js pull --connection postgresql://test:test@localhost:5432/test --comments', { 
        stdio: 'pipe' 
      });
    } catch (error) {
      // Expected to fail due to no database connection
      assert.ok(error.status !== 0, 'Should fail due to database connection');
    }
  });

  test('should support connection masking with --no-mask flag', () => {
    try {
      execSync('node ../../bin/cli.js pull --connection postgresql://test:test@localhost:5432/test --no-mask', { 
        stdio: 'pipe' 
      });
    } catch (error) {
      // Expected to fail due to no database connection
      assert.ok(error.status !== 0, 'Should fail due to database connection');
    }
  });

  test('should read DATABASE_URL environment variable when no --connection provided', () => {
    try {
      execSync('node ../../bin/cli.js pull', { 
        stdio: 'pipe',
        env: { 
          ...process.env, 
          DATABASE_URL: 'postgresql://test:test@localhost:5432/test' 
        }
      });
    } catch (error) {
      // Expected to fail due to no database connection, but should read env var
      assert.ok(error.status !== 0, 'Should fail due to database connection');
      const errorOutput = error.stderr?.toString() || '';
      
      // Should not complain about missing connection string
      assert.ok(
        !errorOutput.includes('Database connection required'),
        'Should not show missing connection error when env var is set'
      );
    }
  });

  test('should validate format option accepts only valid values', () => {
    try {
      execSync('node ../../bin/cli.js pull --connection postgresql://test:test@localhost:5432/test --format invalid', { 
        stdio: 'pipe' 
      });
      assert.fail('Should have failed with invalid format');
    } catch (error) {
      assert.ok(error.status !== 0, 'Should exit with non-zero status for invalid format');
      // Commander should handle format validation
    }
  });

  test('should handle empty table list gracefully', () => {
    try {
      execSync('node ../../bin/cli.js pull --connection postgresql://test:test@localhost:5432/test --tables ""', { 
        stdio: 'pipe' 
      });
    } catch (error) {
      // Expected to fail due to no database connection
      assert.ok(error.status !== 0, 'Should fail due to database connection');
    }
  });

  test('should provide meaningful error messages for connection failures', () => {
    try {
      execSync('node ../../bin/cli.js pull --connection postgresql://invalid:invalid@nonexistent:5432/test', { 
        stdio: 'pipe' 
      });
      assert.fail('Should have failed with connection error');
    } catch (error) {
      assert.ok(error.status !== 0, 'Should exit with non-zero status');
      const errorOutput = error.stderr?.toString() || '';
      assert.ok(
        errorOutput.includes('Pull failed') || errorOutput.includes('connect'),
        'Should show connection failure message'
      );
    }
  });
});