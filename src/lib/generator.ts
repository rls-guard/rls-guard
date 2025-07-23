// ConfigGenerator - Generate TypeScript config files from extracted RLS policies
import { parseExpression, generateHelperCall, analyzeExpression } from './expression-parser.js';

export class ConfigGenerator {
  options: {
    format: string;
    addComments: boolean;
    maskConnection: boolean;
    connectionString?: string;
  };

  constructor(options: {
    format?: string;
    addComments?: boolean;
    maskConnection?: boolean;
    connectionString?: string;
  } = {}) {
    this.options = {
      format: options.format || 'typescript',
      addComments: options.addComments || false,
      maskConnection: options.maskConnection !== false,
      connectionString: options.connectionString,
      ...options
    };
  }

  /**
   * Generate configuration content from extracted policies
   * @param {Array} policies - Array of policy objects from introspector
   * @returns {string} Generated configuration content
   */
  generateConfig(policies: any[]): string {
    if (this.options.format === 'json') {
      return this.generateJsonConfig(policies);
    }
    
    return this.generateTypeScriptConfig(policies);
  }

  /**
   * Generate TypeScript configuration file
   * @param {Array} policies - Array of policy objects
   * @returns {string} TypeScript configuration content
   */
  generateTypeScriptConfig(policies: any[]): string {
    const imports = this.generateImports();
    const header = this.generateHeader();
    const databaseConfig = this.generateDatabaseConfig();
    const policyConfigs = this.generatePolicyConfigs(policies);
    const footer = this.generateFooter();

    return [imports, header, databaseConfig, policyConfigs, footer]
      .filter(section => section.trim().length > 0)
      .join('\n\n');
  }

  /**
   * Generate JSON configuration file
   * @param {Array} policies - Array of policy objects
   * @returns {string} JSON configuration content
   */
  generateJsonConfig(policies: any[]): string {
    const config = {
      database: this.extractDatabaseConfig(),
      policies: policies.map(policy => ({
        name: policy.name,
        table: policy.table,
        command: policy.command,
        expression: policy.expression,
        roles: policy.roles,
        permissive: policy.permissive,
        withCheck: policy.withCheck
      }))
    };

    return JSON.stringify(config, null, 2);
  }

  /**
   * Generate import statements for TypeScript config
   * @returns {string} Import statements
   */
  generateImports(): string {
    return `import { RLSConfig } from 'rls-guard';
const { config, currentUserId, tenantId, publicAccess, noAccess, recentData, ownerOnly, roleCheck, timeWindow } = RLSConfig;`;
  }

  /**
   * Generate header comment
   * @returns {string} Header comment
   */
  generateHeader(): string {
    if (!this.options.addComments) return '';
    
    return `// RLS Guard Configuration
// Generated from existing database policies on ${new Date().toISOString()}
// 
// This file contains the extracted RLS policies from your PostgreSQL database.
// Review and modify as needed before deploying.`;
  }

  /**
   * Generate database configuration section
   * @returns {string} Database configuration
   */
  generateDatabaseConfig(): string {
    const connectionConfig = this.generateConnectionConfig();
    
    return `const rlsConfig = config()
  .database(db => db${connectionConfig}
  )`;
  }

  /**
   * Generate connection configuration
   * @returns {string} Connection configuration
   */
  generateConnectionConfig(): string {
    if (!this.options.connectionString) {
      return `
    .connectionUrl(process.env.DATABASE_URL || "postgresql://user:pass@localhost:5432/mydb")`;
    }

    const masked = this.options.maskConnection 
      ? this.maskConnectionString(this.options.connectionString)
      : this.options.connectionString;

    return `
    .connectionUrl("${masked}")`;
  }

  /**
   * Generate policy configurations
   * @param {Array} policies - Array of policy objects
   * @returns {string} Policy configurations
   */
  generatePolicyConfigs(policies: any[]): string {
    if (policies.length === 0) {
      return '  // No policies found in database';
    }

    const policyGroups = this.groupPoliciesByTable(policies);
    const sections: string[] = [];

    for (const [tableName, tablePolicies] of Object.entries(policyGroups)) {
      const tableComment = this.options.addComments 
        ? `\n  // Policies for table: ${tableName}` 
        : '';
      
      const policySections = tablePolicies.map(policy => 
        this.generateSinglePolicy(policy)
      ).join('\n\n');

      sections.push(tableComment + '\n' + policySections);
    }

    return sections.join('\n');
  }

  /**
   * Generate configuration for a single policy
   * @param {Object} policy - Policy object
   * @returns {string} Single policy configuration
   */
  generateSinglePolicy(policy: any): string {
    const parsed = parseExpression(policy.expression);
    const helperCall = generateHelperCall(parsed);
    const analysis = analyzeExpression(parsed);
    
    let policyConfig = `  .addPolicy(p => p
    .name("${policy.name}")
    .onTable("${policy.table}")
    .forCommand("${policy.command}")
    .withExpression(${helperCall})
    .forRoles(${this.formatRoles(policy.roles)})`;

    // Add permissive/restrictive setting if not default
    if (!policy.permissive) {
      policyConfig += `
    .asRestrictive()`;
    }

    policyConfig += `
  )`;

    // Add comments about analysis if enabled
    if (this.options.addComments && (analysis.warnings.length > 0 || parsed.confidence < 0.8)) {
      const comments = this.generatePolicyComments(policy, parsed, analysis);
      policyConfig = comments + policyConfig;
    }

    return policyConfig;
  }

  /**
   * Generate comments for a policy
   * @param {Object} policy - Policy object
   * @param {Object} parsed - Parsed expression
   * @param {Object} analysis - Expression analysis
   * @returns {string} Policy comments
   */
  generatePolicyComments(policy: any, parsed: any, analysis: any): string {
    const lines: string[] = [];
    
    lines.push(`  // Policy: ${policy.name}`);
    
    if (policy.schema && policy.schema !== 'public') {
      lines.push(`  // Schema: ${policy.schema}`);
    }
    
    if (parsed.confidence < 0.8) {
      lines.push(`  // Note: Expression mapping confidence: ${(parsed.confidence * 100).toFixed(0)}%`);
      lines.push(`  // Original SQL: ${policy.expression}`);
    }
    
    if (analysis.warnings.length > 0) {
      lines.push(`  // Warnings: ${analysis.warnings.join(', ')}`);
    }
    
    if (policy.withCheck && policy.withCheck !== policy.expression) {
      lines.push(`  // WITH CHECK: ${policy.withCheck}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Format roles array for TypeScript
   * @param {Array} roles - Array of role names
   * @returns {string} Formatted roles
   */
  formatRoles(roles: string[]): string {
    if (!roles || roles.length === 0) {
      return '"public"';
    }
    
    if (roles.length === 1) {
      return `"${roles[0]}"`;
    }
    
    return roles.map(role => `"${role}"`).join(', ');
  }

  /**
   * Group policies by table name
   * @param {Array} policies - Array of policy objects
   * @returns {Object} Policies grouped by table
   */
  groupPoliciesByTable(policies: any[]): { [key: string]: any[] } {
    const groups: { [key: string]: any[] } = {};
    
    policies.forEach(policy => {
      if (!groups[policy.table]) {
        groups[policy.table] = [];
      }
      groups[policy.table].push(policy);
    });

    // Sort policies within each table by name
    Object.values(groups).forEach(tablePolicies => {
      tablePolicies.sort((a, b) => a.name.localeCompare(b.name));
    });

    return groups;
  }

  /**
   * Generate footer of the configuration file
   * @returns {string} Footer content
   */
  generateFooter(): string {
    return `
export default rlsConfig;`;
  }

  /**
   * Extract database configuration from connection string
   * @returns {Object} Database configuration object
   */
  extractDatabaseConfig(): { url: string } {
    if (!this.options.connectionString) {
      return { url: "postgresql://user:pass@localhost:5432/mydb" };
    }

    const masked = this.options.maskConnection 
      ? this.maskConnectionString(this.options.connectionString)
      : this.options.connectionString;

    return { url: masked };
  }

  /**
   * Mask sensitive information in connection string
   * @param {string} connectionString - Original connection string
   * @returns {string} Masked connection string
   */
  maskConnectionString(connectionString: string): string {
    return connectionString.replace(
      /postgresql:\/\/([^:]+):([^@]+)@/,
      'postgresql://$1:***@'
    );
  }
}