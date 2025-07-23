// RLS Guard - Configuration Library (CommonJS)
// This file contains the types and builders for defining RLS policies

class PolicyBuilder {
  constructor() {
    this.policy = {};
  }

  name(name) {
    this.policy.name = name;
    return this;
  }

  onTable(table) {
    this.policy.table = table;
    return this;
  }

  forCommand(command) {
    this.policy.command = command;
    return this;
  }

  withExpression(expression) {
    this.policy.expression = expression;
    return this;
  }

  forRoles(...roles) {
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

  build() {
    if (!this.policy.name || !this.policy.table || !this.policy.command || 
        !this.policy.expression || !this.policy.roles) {
      throw new Error('Policy is missing required fields');
    }
    return this.policy;
  }
}

class DatabaseBuilder {
  constructor() {
    this.config = {};
  }

  connectionUrl(url) {
    this.config.url = url;
    return this;
  }

  host(host) {
    this.config.host = host;
    return this;
  }

  port(port) {
    this.config.port = port;
    return this;
  }

  database(database) {
    this.config.database = database;
    return this;
  }

  username(username) {
    this.config.username = username;
    return this;
  }

  password(password) {
    this.config.password = password;
    return this;
  }

  ssl(enabled = true) {
    this.config.ssl = enabled;
    return this;
  }

  build() {
    if (!this.config.url && !this.config.host) {
      throw new Error('Either connection URL or host must be specified');
    }
    return this.config;
  }
}

class ConfigBuilder {
  constructor() {
    this.config = { policies: [] };
  }

  database(builder) {
    this.config.database = builder(new DatabaseBuilder()).build();
    return this;
  }

  addPolicy(builder) {
    const policy = builder(new PolicyBuilder()).build();
    this.config.policies.push(policy);
    return this;
  }

  build() {
    if (!this.config.database) {
      throw new Error('Database configuration is required');
    }
    return this.config;
  }

  export(filename = 'rls.config.json') {
    const fs = require('fs');
    const config = this.build();
    fs.writeFileSync(filename, JSON.stringify(config, null, 2));
  }
}

// Helper functions for common RLS patterns
const currentUserId = (column = 'user_id') => 
  `${column} = current_setting('app.current_user_id')::uuid`;

const tenantId = (column = 'tenant_id') =>
  `${column} = current_setting('app.tenant_id')::uuid`;

const recentData = (column = 'created_at', days = 90) =>
  `${column} >= current_date - interval '${days} days'`;

const ownerOnly = (userColumn = 'user_id', ownerColumn = 'owner_id') =>
  `${userColumn} = ${ownerColumn}`;

const roleCheck = (role) =>
  `current_setting('app.user_role') = '${role}'`;

const timeWindow = (column, hours) =>
  `${column} >= now() - interval '${hours} hours'`;

const publicAccess = () => 'true';

const noAccess = () => 'false';

// Convenience functions
const policy = () => new PolicyBuilder();
const database = () => new DatabaseBuilder();
const config = () => new ConfigBuilder();

// Export everything
module.exports = {
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
  config
};