import { Command } from 'commander';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
import chalk from 'chalk';
import { DatabaseManager } from '../lib/database.js';
import { PolicyIntrospector } from '../lib/introspector.js';
import { ConfigGenerator } from '../lib/generator.js';
import { loadConfig } from '../lib/config.js';

const pullCommand = new Command('pull');

pullCommand
  .description('Extract existing RLS policies from database and generate rls.config.ts')
  .option('-o, --output <file>', 'Output file path', 'rls.config.ts')
  .option('-t, --tables <tables>', 'Comma-separated list of tables to extract')
  .option('-f, --format <format>', 'Output format: typescript|json', 'typescript')
  .option('-c, --comments', 'Add explanatory comments', false)
  .option('--config <url>', 'Configuration file path', 'rls.config.ts')
  .option('--no-mask', 'Don\'t mask sensitive connection info')
  .action(async (options) => {
    try {
      const config = await loadConfig('rls.config.ts');

      console.log(chalk.blue('🔍') + ' Starting RLS policy extraction...\n');
      
      // Get database connection
      const connectionString = config.database.url || options.connection || process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error('Database connection required. Use --connection or set DATABASE_URL environment variable');
      }
      
      console.log(chalk.blue('🔌') + ' Connecting to PostgreSQL database...');
      const dbManager = new DatabaseManager({ url: connectionString });
      
      try {
        await dbManager.connect();
        await dbManager.validateConnection();
        console.log(chalk.green('✅') + ' Successfully connected to database\n');
        
        // Extract policies
        console.log(chalk.blue('📋') + ' Extracting RLS policies...');
        const introspector = new PolicyIntrospector({ client: dbManager.getClient() });
        const tableFilter = options.tables ? options.tables.split(',').map((t: string) => t.trim()) : null;
        const policies = await introspector.extractPolicies(tableFilter);
        
        if (policies.length === 0) {
          console.log(chalk.yellow('⚠️ ') + ' No RLS policies found in the database');
          return;
        }
        
        console.log(chalk.green('✅') + ` Found ${policies.length} policies across ${getUniqueTableCount(policies)} tables\n`);
        
        // Generate config file
        console.log(chalk.blue('📝') + ' Generating configuration file...');
        const generator = new ConfigGenerator({
          format: options.format,
          addComments: options.comments,
          maskConnection: options.mask,
          connectionString: connectionString
        });
        
        const configContent = generator.generateConfig(policies);
        
        // Write to file
        const outputPath = resolve(options.output);
        writeFileSync(outputPath, configContent);
        
        console.log(chalk.green('🎉') + ` Successfully generated ${options.output}`);
        console.log('');
        console.log('Next steps:');
        console.log('1. Review the generated configuration');
        console.log('2. Test with ' + chalk.cyan('rls-guard deploy --dry-run'));
        console.log('3. Make any necessary adjustments');
        
      } finally {
        await dbManager.close();
      }
      
    } catch (error) {
      console.error(chalk.red('❌') + ' Pull failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

function getUniqueTableCount(policies: any[]) {
  return new Set(policies.map(p => p.table)).size;
}

export { pullCommand };