import pg from 'pg';

const { Client } = pg;

export class DatabaseManager {
  constructor(dbConfig) {
    this.config = dbConfig;
    this.client = null;
  }
  
  async connect() {
    const connectionString = this.config.url || this.buildConnectionString();
    
    this.client = new Client({
      connectionString: connectionString
    });
    
    await this.client.connect();
  }
  
  async close() {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }
  
  async validateConnection() {
    const result = await this.client.query('SELECT 1 as test');
    return result.rows[0].test === 1;
  }
  
  async tableExists(tableName) {
    const result = await this.client.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      ) as exists`,
      [tableName]
    );
    return result.rows[0].exists;
  }
  
  async enableRLS(tableName) {
    await this.client.query(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
  }
  
  async dropPolicyIfExists(policyName, tableName) {
    await this.client.query(`DROP POLICY IF EXISTS ${policyName} ON ${tableName}`);
  }
  
  async createPolicy(policy) {
    const sql = this.generateCreatePolicySQL(policy);
    await this.client.query(sql);
  }
  
  generateCreatePolicySQL(policy) {
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
    
    return sql;
  }
  
  buildConnectionString() {
    const { host = 'localhost', port = 5432, database, username, password, ssl } = this.config;
    let connStr = `postgresql://${username}:${password}@${host}:${port}/${database}`;
    
    if (ssl === false) {
      connStr += '?sslmode=disable';
    }
    
    return connStr;
  }
}