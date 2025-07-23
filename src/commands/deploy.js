import { Command } from 'commander';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import chalk from 'chalk';
import { DatabaseManager } from '../lib/database.js';

const deployCommand = new Command('deploy');

deployCommand
  .description('Deploy RLS policies to your PostgreSQL database')
  .option('--dry-run', 'Show SQL commands without executing them', false)
  .option('-c, --config <path>', 'Path to the RLS configuration file', 'rls.config.ts')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🚀') + ' Starting RLS policy deployment...\n');
      
      // Load configuration
      console.log(chalk.blue('📖') + ` Loading configuration from ${options.config}`);
      const config = await loadConfig(options.config);
      
      console.log(chalk.green('✅') + ' Configuration loaded successfully');
      console.log('   - Database: ' + maskConnectionString(config.database.url || buildConnectionString(config.database)));
      console.log('   - Policies: ' + config.policies.length + '\n');
      
      // Connect to database
      console.log(chalk.blue('🔌') + ' Connecting to PostgreSQL database...');
      const dbManager = new DatabaseManager(config.database);
      
      try {
        await dbManager.connect();
        await dbManager.validateConnection();
        console.log(chalk.green('✅') + ' Successfully connected to database\n');
        
        if (options.dryRun) {
          console.log(chalk.yellow('🔍') + ' Dry run mode - showing SQL commands that would be executed:\n');
        } else {
          // Validate tables exist (optional warning)
          console.log(chalk.blue('🔍') + ' Validating target tables...');
          await validateTables(dbManager, config.policies);
          console.log();
        }
        
        // Deploy policies
        await deployPolicies(dbManager, config.policies, options.dryRun);
        
        if (options.dryRun) {
          console.log(chalk.blue('💡') + ' Run without --dry-run to apply these changes to your database');
        } else {
          console.log(chalk.green('🎉') + ` Successfully deployed ${config.policies.length} RLS policies across ${getUniqueTableCount(config.policies)} tables`);
        }
        
      } finally {
        await dbManager.close();
      }
      
    } catch (error) {
      console.error(chalk.red('❌') + ' Deployment failed:', error.message);
      process.exit(1);
    }
  });

async function loadConfig(configPath) {
  const absolutePath = resolve(configPath);
  
  try {
    // Use tsx to run the TypeScript file directly
    const { spawn } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(spawn);
    
    // Execute tsx to load and export the config
    const process = spawn('npx', ['tsx', '--eval', `
      import configBuilder from '${absolutePath}';
      console.log(JSON.stringify(configBuilder.build(), null, 2));
    `], { stdio: ['pipe', 'pipe', 'pipe'] });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    return new Promise((resolve, reject) => {
      process.on('close', (code) => {
        if (code === 0) {
          try {
            const config = JSON.parse(stdout.trim());
            resolve(config);
          } catch (e) {
            reject(new Error(`Failed to parse configuration JSON: ${e.message}`));
          }
        } else {
          reject(new Error(`Failed to load configuration: ${stderr || 'Unknown error'}`));
        }
      });
    });
    
  } catch (error) {
    throw new Error(`Failed to load configuration: ${error.message}`);
  }
}

function maskConnectionString(connStr) {
  if (connStr.length > 50) {
    return connStr.slice(0, 20) + '...' + connStr.slice(-15);
  }
  return '***';
}

function buildConnectionString(dbConfig) {
  if (dbConfig.url) return dbConfig.url;
  
  const { host = 'localhost', port = 5432, database, username, password, ssl } = dbConfig;
  let connStr = `postgresql://${username}:${password}@${host}:${port}/${database}`;
  
  if (ssl === false) {
    connStr += '?sslmode=disable';
  }
  
  return connStr;
}

async function validateTables(dbManager, policies) {
  const tables = [...new Set(policies.map(p => p.table))];
  
  for (const table of tables) {
    try {
      const exists = await dbManager.tableExists(table);
      if (!exists) {
        console.log(chalk.yellow('⚠️ ') + ` Warning: Table '${table}' does not exist`);
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️ ') + ` Warning: Could not verify table '${table}': ${error.message}`);
    }
  }
}

async function deployPolicies(dbManager, policies, dryRun) {
  // Group policies by table
  const policiesByTable = {};
  for (const policy of policies) {
    if (!policiesByTable[policy.table]) {
      policiesByTable[policy.table] = [];
    }
    policiesByTable[policy.table].push(policy);
  }
  
  // Deploy policies table by table
  for (const [table, tablePolicies] of Object.entries(policiesByTable)) {
    console.log(chalk.blue('📋') + ` Processing table: ${table}`);
    
    if (dryRun) {
      // Show SQL commands for dry run
      console.log('  ALTER TABLE ' + table + ' ENABLE ROW LEVEL SECURITY;');
      
      for (const policy of tablePolicies) {
        console.log('  DROP POLICY IF EXISTS ' + policy.name + ' ON ' + table + ';');
        console.log('  ' + generateCreatePolicySQL(policy));
      }
    } else {
      // Execute actual deployment
      await dbManager.enableRLS(table);
      
      for (const policy of tablePolicies) {
        await dbManager.dropPolicyIfExists(policy.name, table);
        await dbManager.createPolicy(policy);
      }
    }
    
    console.log(chalk.green('✅') + ` Table ${table} processed successfully\n`);
  }
}

function generateCreatePolicySQL(policy) {
  let sql = `CREATE POLICY ${policy.name} ON ${policy.table}`;
  
  // Add policy type (restrictive/permissive) - must come before FOR clause
  if (policy.permissive === false) {
    sql += ' AS RESTRICTIVE';
  }
  
  // Add command type
  if (policy.command.toUpperCase() === 'ALL') {
    sql += ' FOR ALL';
  } else {
    sql += ` FOR ${policy.command.toUpperCase()}`;
  }
  
  // Add roles
  sql += ` TO ${policy.roles.join(', ')}`;
  
  // Add expression
  sql += ` USING (${policy.expression})`;
  
  return sql + ';';
}

function getUniqueTableCount(policies) {
  return new Set(policies.map(p => p.table)).size;
}

export { deployCommand };