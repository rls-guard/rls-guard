// Rename this file to init.ts and add TypeScript type annotations.

import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';

const initCommand = new Command('init');

initCommand
  .description('Create a new rls.config.ts file with example policies')
  .option('-o, --output <file>', 'Output file path', 'rls.config.ts')
  .action((options) => {
    const configPath = resolve(options.output);
    
    const configTemplate = `// rls-guard configuration file
// Define your PostgreSQL connection and RLS policies
import { config, currentUserId, tenantId, publicAccess, noAccess, recentData, ownerOnly, roleCheck, timeWindow } from 'rls-guard';

// Build your RLS configuration using the fluent API
const configBuilder = config()
  .database(db => db
    // Update this with your PostgreSQL connection URL
    .connectionUrl("postgresql://username:password@localhost:5432/database_name")
    
    // Or use individual parameters:
    // .host("localhost")
    // .port(5432) 
    // .database("mydb")
    // .username("user")
    // .password("pass")
    // .ssl(true)
  )
  
  // Example: Users can only see their own records
  .addPolicy(p => p
    .name("user_isolation")
    .onTable("users")
    .forCommand("SELECT")
    .withExpression(currentUserId())
    .forRoles("authenticated_user")
  )
  
  // Example: Users can only update their own profile
  .addPolicy(p => p
    .name("user_update_own")
    .onTable("user_profiles")
    .forCommand("UPDATE")
    .withExpression(currentUserId())
    .forRoles("authenticated_user")
    .asPermissive()
  )
  
  // Example: Admin users have full access
  .addPolicy(p => p
    .name("admin_full_access")
    .onTable("users")
    .forCommand("ALL")
    .withExpression(publicAccess()) // Always allow
    .forRoles("admin")
  )
  
  // Example: Tenant-based isolation for multi-tenant applications
  .addPolicy(p => p
    .name("tenant_isolation")
    .onTable("orders")
    .forCommand("ALL")
    .withExpression(tenantId())
    .forRoles("tenant_user", "tenant_admin")
  )
  
  // Example: Analysts can only see recent data
  .addPolicy(p => p
    .name("analyst_readonly")
    .onTable("analytics_data")
    .forCommand("SELECT")
    .withExpression(recentData("created_at", 90))
    .forRoles("analyst")
  )
  
  // Example: Owner-based access control
  .addPolicy(p => p
    .name("document_owner_access")
    .onTable("documents")
    .forCommand("ALL")
    .withExpression(ownerOnly("current_user_id", "owner_id"))
    .forRoles("app_user")
  )
  
  // Example: Role-based access with additional conditions
  .addPolicy(p => p
    .name("manager_department_access")
    .onTable("employee_records")
    .forCommand("SELECT")
    .withExpression(roleCheck("manager") + " AND department_id = current_setting('app.user_department_id')::int")
    .forRoles("manager")
  )
  
  // Example: Restrictive policy that blocks access by default
  .addPolicy(p => p
    .name("sensitive_data_restriction")
    .onTable("user_secrets")
    .forCommand("SELECT")
    .withExpression(noAccess()) // Block by default
    .forRoles("public")
    .asRestrictive()
  );

// Export configBuilder for the CLI to use
export default configBuilder;
`;

    try {
      writeFileSync(configPath, configTemplate);
      console.log(chalk.green('✅') + ` Created ${options.output}`);
      console.log('');
      console.log('Next steps:');
      console.log('1. Update the database connection URL');
      console.log('2. Define your RLS policies');
      console.log('3. Run ' + chalk.cyan("'rls-guard deploy'") + ' to apply the policies');
    } catch (error) {
      console.error(chalk.red('❌') + ` Failed to create ${options.output}:`, error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

export { initCommand };