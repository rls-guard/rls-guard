// RLS Guard - Configuration Library (CommonJS)
// This file contains the types and builders for defining RLS policies

interface Policy {
  name: string;
  table: string;
  command: string;
  expression: string;
  roles: string[];
  permissive?: boolean;
}

interface DatabaseConfig {
  url?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
}

export interface Config {
  database: DatabaseConfig;
  policies: Policy[];
}

class PolicyBuilder {
  private policy: Partial<Policy>;

  constructor() {
    this.policy = {};
  }

  name(name: string) {
    this.policy.name = name;
    return this;
  }

  onTable(table: string) {
    this.policy.table = table;
    return this;
  }

  forCommand(command: string) {
    this.policy.command = command;
    return this;
  }

  withExpression(expression: string) {
    this.policy.expression = expression;
    return this;
  }

  forRoles(...roles: string[]) {
    this.policy.roles = roles;
    return this;
  }

  asPermissive() {
    this.policy.permissive = true;
    return this;
  }

  asRestrictive() {
    this.policy.permissive = false;
    return this;
  }

  build(): Policy {
    if (!this.policy.name || !this.policy.table || !this.policy.command || 
        !this.policy.expression || !this.policy.roles) {
      throw new Error('Policy is missing required fields');
    }
    return this.policy as Policy;
  }
}

class DatabaseBuilder {
  private config: Partial<DatabaseConfig>;

  constructor() {
    this.config = {};
  }

  connectionUrl(url: string) {
    this.config.url = url;
    return this;
  }

  host(host: string) {
    this.config.host = host;
    return this;
  }

  port(port: number) {
    this.config.port = port;
    return this;
  }

  database(database: string) {
    this.config.database = database;
    return this;
  }

  username(username: string) {
    this.config.username = username;
    return this;
  }

  password(password: string) {
    this.config.password = password;
    return this;
  }

  ssl(enabled: boolean = true) {
    this.config.ssl = enabled;
    return this;
  }

  build(): DatabaseConfig {
    if (!this.config.url && !this.config.host) {
      throw new Error('Either connection URL or host must be specified');
    }
    return this.config as DatabaseConfig;
  }
}

class ConfigBuilder {
  private config: Config;

  constructor() {
    this.config = { database: '', policies: [] } as Config;
  }

  database(builder: (db: DatabaseBuilder) => DatabaseBuilder) {
    this.config.database = builder(new DatabaseBuilder()).build();
    return this;
  }

  addPolicy(builder: (pb: PolicyBuilder) => PolicyBuilder) {
    const policy = builder(new PolicyBuilder()).build();
    this.config.policies.push(policy);
    return this;
  }

  build(): Config {
    if (!this.config.database) {
      throw new Error('Database configuration is required');
    }
    return this.config;
  }

  export(filename: string = 'rls.config.json') {
    const fs = require('fs');
    const config = this.build();
    fs.writeFileSync(filename, JSON.stringify(config, null, 2));
  }
}

// Helper functions for common RLS patterns
const currentUserId = (column: string = 'user_id') => 
  `${column} = current_setting('app.current_user_id')::uuid`;

const tenantId = (column: string = 'tenant_id') =>
  `${column} = current_setting('app.tenant_id')::uuid`;

const recentData = (column: string = 'created_at', days: number = 90) =>
  `${column} >= current_date - interval '${days} days'`;

const ownerOnly = (userColumn: string = 'user_id', ownerColumn: string = 'owner_id') =>
  `${userColumn} = ${ownerColumn}`;

const roleCheck = (role: string) =>
  `current_setting('app.user_role') = '${role}'`;

const timeWindow = (column: string, hours: number) =>
  `${column} >= now() - interval '${hours} hours'`;

const publicAccess = () => 'true';

const noAccess = () => 'false';

// Convenience functions
const policy = () => new PolicyBuilder();
const database = () => new DatabaseBuilder();
const config = () => new ConfigBuilder();

// Export everything
export {
  PolicyBuilder,
  DatabaseBuilder,
  ConfigBuilder,
  currentUserId,
  tenantId,
  recentData,
  ownerOnly,
  roleCheck,
  timeWindow,
  publicAccess,
  noAccess,
  policy,
  database,
  config,
};