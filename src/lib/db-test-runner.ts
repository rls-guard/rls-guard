// Database Test Runner - Execute RLS policy tests against real PostgreSQL database
import { Client } from 'pg';
import { DatabaseManager } from './database.js';

export interface DbTestConfig {
  name?: string;
  data: Record<string, Record<string, any>[]>;
  contexts: TestContext[];
  policies: PolicyDefinition[];
  assertions: TestAssertion[];
  database?: {
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
  };
}

export interface TestContext {
  user: string;
  role: string;
  settings?: Record<string, string>;
}

export interface PolicyDefinition {
  name: string;
  table: string;
  command: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  roles: string[];
  expression: string;
  permissive?: boolean;
}

export interface TestAssertion {
  context: string;
  table: string;
  command: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  expectedRows?: Record<string, any>[];
  expectedCount?: number;
  shouldPass?: boolean;
  row?: Record<string, any>; // For INSERT/UPDATE tests
}

export interface DbTestResult {
  passed: boolean;
  total: number;
  failures: DbTestFailure[];
}

export interface DbTestFailure {
  assertion: TestAssertion;
  actual: any;
  expected: any;
  message: string;
  error?: string;
}

/**
 * Database Test Runner - Executes tests against real PostgreSQL database
 */
export class DatabaseTestRunner {
  private dbManager: DatabaseManager;
  private testDbName: string;
  private originalDbName: string;

  constructor(connectionString?: string) {
    this.testDbName = `rls_guard_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.originalDbName = '';
    
    // Create database manager for test database setup
    const testConnectionString = connectionString || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
    if (!testConnectionString) {
      throw new Error('Database connection string required. Set TEST_DATABASE_URL or DATABASE_URL environment variable.');
    }
    
    this.dbManager = DatabaseManager.fromConnectionString(testConnectionString);
  }

  /**
   * Run database tests with full setup and teardown
   */
  async runTests(config: DbTestConfig): Promise<DbTestResult> {
    let testDb: DatabaseManager | null = null;
    
    try {
      // 1. Create test database
      testDb = await this.setupTestDatabase();
      
      // 2. Create tables and seed data
      await this.seedTestData(testDb, config.data);
      
      // 3. Create roles and users for test contexts
      await this.setupTestContexts(testDb, config.contexts);
      
      // 4. Deploy RLS policies
      await this.deployPolicies(testDb, config.policies);
      
      // 5. Execute test assertions
      const result = await this.executeAssertions(testDb, config.assertions, config.contexts);
      
      return result;
      
    } finally {
      // 6. Cleanup test database
      if (testDb) {
        await this.teardownTestDatabase();
      }
    }
  }

  /**
   * Create isolated test database
   */
  private async setupTestDatabase(): Promise<DatabaseManager> {
    // Connect to postgres database to create test database
    const adminClient = new Client({
      ...this.dbManager.getConnectionConfig(),
      database: 'postgres'
    });
    
    await adminClient.connect();
    
    try {
      // Create test database
      await adminClient.query(`CREATE DATABASE "${this.testDbName}"`);
      
      // Create test database manager
      const testDbManager = DatabaseManager.fromConnectionString(
        this.dbManager.getConnectionString().replace(/\/[^\/]*$/, `/${this.testDbName}`)
      );
      
      await testDbManager.connect();
      return testDbManager;
      
    } finally {
      await adminClient.end();
    }
  }

  /**
   * Create tables and insert test data
   */
  private async seedTestData(db: DatabaseManager, data: Record<string, Record<string, any>[]>): Promise<void> {
    for (const [tableName, rows] of Object.entries(data)) {
      if (rows.length === 0) continue;
      
      // Infer table schema from first row
      const firstRow = rows[0];
      const columns = Object.keys(firstRow);
      
      // Create table with inferred schema
      const columnDefs = columns.map(col => {
        const value = firstRow[col];
        let type = 'TEXT';
        
        if (typeof value === 'number') {
          type = Number.isInteger(value) ? 'INTEGER' : 'NUMERIC';
        } else if (typeof value === 'boolean') {
          type = 'BOOLEAN';
        } else if (value instanceof Date) {
          type = 'TIMESTAMP';
        } else if (typeof value === 'string' && value.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          type = 'UUID';
        }
        
        return `"${col}" ${type}`;
      }).join(', ');
      
      await db.query(`CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefs})`);
      
      // Insert test data
      for (const row of rows) {
        const values = columns.map(col => row[col]);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        const columnNames = columns.map(col => `"${col}"`).join(', ');
        
        await db.query(
          `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`,
          values
        );
      }
      
      // Enable RLS on the table
      await db.query(`ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY`);
    }
  }

  /**
   * Create PostgreSQL roles and users for test contexts
   */
  private async setupTestContexts(db: DatabaseManager, contexts: TestContext[]): Promise<void> {
    const createdRoles = new Set<string>();
    
    for (const context of contexts) {
      // Create role if not exists
      if (!createdRoles.has(context.role)) {
        await db.query(`CREATE ROLE "${context.role}" NOLOGIN`).catch(() => {
          // Role might already exist, ignore error
        });
        createdRoles.add(context.role);
      }
      
      // Create user if not exists
      await db.query(`CREATE ROLE "${context.user}" LOGIN IN ROLE "${context.role}"`).catch(() => {
        // User might already exist, ignore error
      });
      
      // Grant table permissions
      const tables = await db.query(`
        SELECT tablename FROM pg_tables 
        WHERE schemaname = 'public'
      `);
      
      for (const table of tables.rows) {
        await db.query(`GRANT ALL ON TABLE "${table.tablename}" TO "${context.role}"`);
      }
    }
  }

  /**
   * Deploy RLS policies to test database
   */
  private async deployPolicies(db: DatabaseManager, policies: PolicyDefinition[]): Promise<void> {
    for (const policy of policies) {
      const policyType = policy.permissive === false ? 'RESTRICTIVE' : 'PERMISSIVE';
      const roles = policy.roles.map(role => `"${role}"`).join(', ');
      
      const createPolicySQL = `
        CREATE POLICY "${policy.name}" ON "${policy.table}"
        AS ${policyType}
        FOR ${policy.command}
        TO ${roles}
        USING (${policy.expression})
      `;
      
      await db.query(createPolicySQL);
    }
  }

  /**
   * Execute test assertions against the database
   */
  private async executeAssertions(
    db: DatabaseManager, 
    assertions: TestAssertion[], 
    contexts: TestContext[]
  ): Promise<DbTestResult> {
    const failures: DbTestFailure[] = [];
    
    for (const assertion of assertions) {
      try {
        const context = contexts.find(c => c.user === assertion.context);
        if (!context) {
          failures.push({
            assertion,
            actual: null,
            expected: `context for user ${assertion.context}`,
            message: `Context not found for user: ${assertion.context}`
          });
          continue;
        }
        
        // Set user context for this assertion
        await this.setUserContext(db, context);
        
        // Execute assertion based on command type
        await this.executeAssertion(db, assertion, failures);
        
      } catch (error) {
        failures.push({
          assertion,
          actual: error,
          expected: 'successful execution',
          message: `Error executing assertion: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    return {
      passed: failures.length === 0,
      total: assertions.length,
      failures
    };
  }

  /**
   * Set user context for database session
   */
  private async setUserContext(db: DatabaseManager, context: TestContext): Promise<void> {
    // Set role
    await db.query(`SET ROLE "${context.user}"`);
    
    // Set custom settings
    await db.query(`SET app.current_user_id = '${context.user}'`);
    await db.query(`SET app.user_role = '${context.role}'`);
    
    if (context.settings) {
      for (const [key, value] of Object.entries(context.settings)) {
        await db.query(`SET app.${key} = '${value}'`);
      }
    }
  }

  /**
   * Execute individual assertion
   */
  private async executeAssertion(
    db: DatabaseManager, 
    assertion: TestAssertion, 
    failures: DbTestFailure[]
  ): Promise<void> {
    switch (assertion.command) {
      case 'SELECT':
        await this.executeSelectAssertion(db, assertion, failures);
        break;
        
      case 'INSERT':
      case 'UPDATE':
        await this.executeModifyAssertion(db, assertion, failures);
        break;
        
      default:
        throw new Error(`Unsupported assertion command: ${assertion.command}`);
    }
  }

  /**
   * Execute SELECT assertion
   */
  private async executeSelectAssertion(
    db: DatabaseManager, 
    assertion: TestAssertion, 
    failures: DbTestFailure[]
  ): Promise<void> {
    const result = await db.query(`SELECT * FROM "${assertion.table}" ORDER BY id`);
    const actualRows = result.rows;
    
    if (assertion.expectedRows) {
      if (!this.deepEqual(actualRows, assertion.expectedRows)) {
        failures.push({
          assertion,
          actual: actualRows,
          expected: assertion.expectedRows,
          message: `Row mismatch for ${assertion.context} selecting from ${assertion.table}`
        });
      }
    } else if (assertion.expectedCount !== undefined) {
      if (actualRows.length !== assertion.expectedCount) {
        failures.push({
          assertion,
          actual: actualRows.length,
          expected: assertion.expectedCount,
          message: `Count mismatch for ${assertion.context} selecting from ${assertion.table}`
        });
      }
    }
  }

  /**
   * Execute INSERT/UPDATE assertion
   */
  private async executeModifyAssertion(
    db: DatabaseManager, 
    assertion: TestAssertion, 
    failures: DbTestFailure[]
  ): Promise<void> {
    if (!assertion.row) {
      throw new Error('Row data required for INSERT/UPDATE assertions');
    }
    
    try {
      if (assertion.command === 'INSERT') {
        const columns = Object.keys(assertion.row);
        const values = Object.values(assertion.row);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        const columnNames = columns.map(col => `"${col}"`).join(', ');
        
        await db.query(
          `INSERT INTO "${assertion.table}" (${columnNames}) VALUES (${placeholders})`,
          values
        );
      } else if (assertion.command === 'UPDATE') {
        // Assume first column is ID for UPDATE
        const columns = Object.keys(assertion.row);
        const idColumn = columns[0];
        const idValue = assertion.row[idColumn];
        
        const setClauses = columns.slice(1).map((col, i) => `"${col}" = $${i + 2}`).join(', ');
        const values = columns.slice(1).map(col => assertion.row[col]);
        
        await db.query(
          `UPDATE "${assertion.table}" SET ${setClauses} WHERE "${idColumn}" = $1`,
          [idValue, ...values]
        );
      }
      
      // If we reach here, operation succeeded
      if (assertion.shouldPass === false) {
        failures.push({
          assertion,
          actual: true,
          expected: false,
          message: `Expected ${assertion.command} to fail for ${assertion.context} but it succeeded`
        });
      }
      
    } catch (error) {
      // Operation failed
      if (assertion.shouldPass !== false) {
        failures.push({
          assertion,
          actual: false,
          expected: true,
          message: `Expected ${assertion.command} to succeed for ${assertion.context} but it failed`,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Cleanup test database
   */
  private async teardownTestDatabase(): Promise<void> {
    // Disconnect from test database
    await this.dbManager.disconnect();
    
    // Connect to postgres database to drop test database
    const adminClient = new Client({
      ...this.dbManager.getConnectionConfig(),
      database: 'postgres'
    });
    
    await adminClient.connect();
    
    try {
      // Terminate connections to test database
      await adminClient.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = '${this.testDbName}' AND pid <> pg_backend_pid()
      `);
      
      // Drop test database
      await adminClient.query(`DROP DATABASE "${this.testDbName}"`);
      
    } finally {
      await adminClient.end();
    }
  }

  /**
   * Deep equality check for test results
   */
  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();
    }
    
    if (!a || !b || (typeof a !== 'object' && typeof b !== 'object')) {
      return a === b;
    }
    
    if (a === null || a === undefined || b === null || b === undefined) {
      return false;
    }
    
    if (a.prototype !== b.prototype) return false;
    
    let keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) {
      return false;
    }
    
    return keys.every(k => this.deepEqual(a[k], b[k]));
  }
}