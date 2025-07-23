#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Import commands
import { initCommand } from '../src/commands/init.js';
import { deployCommand } from '../src/commands/deploy.js';
import { pullCommand } from '../src/commands/pull.js';

const packageJson = require('../package.json');

const program = new Command();

program
  .name('rls-guard')
  .description('A CLI tool for managing PostgreSQL Row Level Security (RLS) policies as code')
  .version(packageJson.version);

// Add commands
program.addCommand(initCommand);
program.addCommand(deployCommand);
program.addCommand(pullCommand);

// Show help if no command provided
if (process.argv.length <= 2) {
  console.log(chalk.blue('🔒 RLS Guard') + ' - PostgreSQL Row Level Security Policy Management\n');
  console.log('Available commands:');
  console.log('  ' + chalk.green('init') + '    Create a new rls.config.ts file with example policies');
  console.log('  ' + chalk.green('deploy') + '  Deploy RLS policies to your PostgreSQL database');
  console.log('  ' + chalk.green('pull') + '    Extract existing RLS policies from database');
  console.log('');
  console.log("Use 'rls-guard [command] --help' for more information about a command.");
  process.exit(0);
}

program.parse();