#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { createRequire } from 'module';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const customRequire = createRequire(import.meta.url);

// Replace __dirname with ES module equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Dynamically resolve commands path
const commandsPath = path.resolve(__dirname, '../commands');

// Replace dynamic `require` with `import()`
const initCommand = (await import(path.join(commandsPath, 'init.js'))).initCommand;
const deployCommand = (await import(path.join(commandsPath, 'deploy.js'))).deployCommand;
const pullCommand = (await import(path.join(commandsPath, 'pull.js'))).pullCommand;

// Update the `packageJson` path to resolve correctly
const packageJsonPath = path.resolve(__dirname, '../../package.json');
const packageJson = customRequire(packageJsonPath);

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