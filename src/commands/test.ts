// Test Command - Run local RLS policy tests
import { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import chalk from 'chalk';
import { testPolicies, TestResult, TestPoliciesConfig } from '../lib/testing.js';
import { DatabaseTestRunner, DbTestConfig } from '../lib/db-test-runner.js';

export function createTestCommand() {
  return new Command('test')
    .description('Run local RLS policy tests')
    .option('-f, --file <file>', 'Test file to run', 'rls.test.ts')
    .option('-c, --config <config>', 'RLS config file', 'rls.config.ts')
    .option('--pattern <pattern>', 'Test file pattern', '*.test.ts')
    .option('--with-database', 'Run tests against real PostgreSQL database')
    .option('--db-url <url>', 'Database connection URL for testing')
    .option('--verbose', 'Show detailed output')
    .action(async (options) => {
      try {
        await runTests(options);
      } catch (error) {
        console.error(chalk.red('Test execution failed:'));
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

async function runTests(options: any) {
  const { file, config, pattern, verbose, withDatabase, dbUrl } = options;
  
  const testMode = withDatabase ? 'Database' : 'Local';
  console.log(chalk.blue(`🧪 RLS Guard ${testMode} Policy Testing`));
  console.log('');

  // Find test files
  const testFiles = findTestFiles(file, pattern);
  
  if (testFiles.length === 0) {
    console.log(chalk.yellow('⚠️  No test files found'));
    console.log(`Looking for: ${file} or files matching ${pattern}`);
    return;
  }

  console.log(chalk.gray(`Found ${testFiles.length} test file(s):`));
  testFiles.forEach(f => console.log(chalk.gray(`  ${f}`)));
  console.log('');

  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  const allFailures: any[] = [];

  // Run each test file
  for (const testFile of testFiles) {
    console.log(chalk.cyan(`Running ${testFile}...`));
    
    try {
      const result = await runTestFile(testFile, config, verbose, withDatabase, dbUrl);
      
      totalTests += result.total;
      if (result.passed) {
        totalPassed += result.total;
        console.log(chalk.green(`✅ ${result.total} test(s) passed`));
      } else {
        const failed = result.failures.length;
        const passed = result.total - failed;
        totalPassed += passed;
        totalFailed += failed;
        allFailures.push(...result.failures);
        
        console.log(chalk.red(`❌ ${failed} test(s) failed, ${passed} passed`));
        
        if (verbose) {
          result.failures.forEach((failure, i) => {
            console.log(chalk.red(`  ${i + 1}. ${failure.message}`));
            console.log(chalk.gray(`     Expected: ${JSON.stringify(failure.expected)}`));
            console.log(chalk.gray(`     Actual:   ${JSON.stringify(failure.actual)}`));
          });
        }
      }
    } catch (error) {
      console.log(chalk.red(`❌ Error running test file: ${error instanceof Error ? error.message : String(error)}`));
      totalFailed++;
    }
    
    console.log('');
  }

  // Print summary
  console.log(chalk.bold('📊 Test Summary'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`Total tests: ${totalTests}`);
  console.log(chalk.green(`Passed: ${totalPassed}`));
  
  if (totalFailed > 0) {
    console.log(chalk.red(`Failed: ${totalFailed}`));
    console.log('');
    
    if (!verbose && allFailures.length > 0) {
      console.log(chalk.red('❌ Failures:'));
      allFailures.forEach((failure, i) => {
        console.log(chalk.red(`  ${i + 1}. ${failure.message}`));
      });
      console.log('');
      console.log(chalk.gray('Run with --verbose for detailed output'));
    }
    
    process.exit(1);
  } else {
    console.log(chalk.green('🎉 All tests passed!'));
  }
}

function findTestFiles(file: string, pattern: string): string[] {
  const files: string[] = [];
  
  // Check if specific file exists
  if (existsSync(file)) {
    files.push(file);
  }
  
  // TODO: Add glob pattern matching for finding multiple test files
  // For now, just check the specific file
  
  return files;
}

async function runTestFile(
  testFile: string, 
  configFile: string, 
  verbose: boolean, 
  withDatabase: boolean, 
  dbUrl?: string
): Promise<TestResult> {
  const testFilePath = resolve(testFile);
  
  if (!existsSync(testFilePath)) {
    throw new Error(`Test file not found: ${testFilePath}`);
  }

  try {
    // Import the test file (tsx handles .ts files)
    const testModule = await import(pathToFileURL(testFilePath).href);
    
    let testConfig: any;
    
    // Extract test configuration from module
    if (testModule.default && typeof testModule.default === 'object') {
      testConfig = testModule.default;
    } else if (testModule.testConfig) {
      testConfig = testModule.testConfig;
    } else {
      throw new Error('Test file must export a default config object or testConfig');
    }
    
    // Run tests based on mode
    if (withDatabase) {
      console.log(chalk.gray('  Using real PostgreSQL database'));
      const dbTestRunner = new DatabaseTestRunner(dbUrl);
      return await dbTestRunner.runTests(testConfig as DbTestConfig);
    } else {
      console.log(chalk.gray('  Using local simulation'));
      return testPolicies(testConfig as TestPoliciesConfig);
    }
    
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot resolve module')) {
      throw new Error(`Failed to import test file. Make sure it's a valid TypeScript/JavaScript module: ${error.message}`);
    }
    throw error;
  }
}

// Helper function to create a test file template
export function createTestTemplate(tableName: string = 'users'): string {
  return `// RLS Policy Test
import { testPolicies } from 'rls-guard/testing';

export const testConfig = {
  data: {
    ${tableName}: [
      { id: 1, user_id: 'user-123', name: 'Alice' },
      { id: 2, user_id: 'user-456', name: 'Bob' }
    ]
  },
  contexts: [
    { user: 'user-123', role: 'authenticated_user' },
    { user: 'user-456', role: 'authenticated_user' },
    { user: 'admin-1', role: 'admin' }
  ],
  policies: [
    {
      name: 'user_isolation',
      table: '${tableName}',
      command: 'SELECT' as const,
      roles: ['authenticated_user'],
      expression: "user_id = current_setting('app.current_user_id')"
    }
  ],
  assertions: [
    {
      context: 'user-123',
      table: '${tableName}',
      command: 'SELECT' as const,
      expectedRows: [{ id: 1, user_id: 'user-123', name: 'Alice' }]
    },
    {
      context: 'user-456', 
      table: '${tableName}',
      command: 'SELECT' as const,
      expectedCount: 1
    }
  ]
};

export default function() {
  return testPolicies(testConfig);
}
`;
}

const testCommand = createTestCommand();
export { testCommand };