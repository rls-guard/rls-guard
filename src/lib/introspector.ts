// PolicyIntrospector - Extract RLS policies from PostgreSQL database
import { parseExpression } from './expression-parser.js';
import { Client } from 'pg';

interface PolicyRow {
  schemaname: string;
  tablename: string;
  policyname: string;
  permissive: 'PERMISSIVE' | 'RESTRICTIVE';
  roles: string;
  cmd: string;
  qual: string;
  with_check: string;
  qual_expression?: string;
  with_check_expression?: string;
  table_oid: number;
}

interface TransformedPolicy {
  name: string;
  table: string;
  schema: string;
  command: string;
  roles: string[];
  permissive: boolean;
  expression: string;
  withCheck: string;
  raw: {
    qual: string;
    with_check: string;
    table_oid: number;
  };
}

interface TableInfo {
  schema: string;
  columns: ColumnInfo[];
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default: string;
}

interface RlsStatus {
  enabled: boolean;
  forced: boolean;
  schema: string;
}

export class PolicyIntrospector {
  db: { client: Client };

  constructor(dbManager: { client: Client }) {
    this.db = dbManager;
  }

  /**
   * Extract all RLS policies from the database
   * @param {string[]|null} tableFilter - Optional list of tables to filter by
   * @returns {Promise<Array>} Array of policy objects
   */
  async extractPolicies(tableFilter: string[] | null = null): Promise<TransformedPolicy[]> {
    const query = `
      SELECT 
        pol.schemaname,
        pol.tablename,
        pol.policyname,
        pol.permissive,
        pol.roles,
        pol.cmd,
        pol.qual,
        pol.with_check,
        pol.qual as qual_expression,
        pol.with_check as with_check_expression,
        t.oid as table_oid
      FROM pg_policies pol
      JOIN pg_class t ON t.relname = pol.tablename
      JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = pol.schemaname
      WHERE pol.schemaname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
      ${tableFilter ? 'AND pol.tablename = ANY($1)' : ''}
      ORDER BY pol.schemaname, pol.tablename, pol.policyname;
    `;

    const params = tableFilter ? [tableFilter] : [];
    const result = await this.db.client.query(query, params);

    return result.rows.map(row => this.transformPolicyRow(row));
  }

  /**
   * Transform a raw policy row from PostgreSQL into our standard format
   * @param {Object} row - Raw policy row from pg_policies
   * @returns {Object} Transformed policy object
   */
  transformPolicyRow(row: PolicyRow): TransformedPolicy {
    const policy: TransformedPolicy = {
      name: row.policyname,
      table: row.tablename,
      schema: row.schemaname,
      command: this.normalizeCommand(row.cmd),
      roles: this.parseRoles(row.roles),
      permissive: row.permissive === 'PERMISSIVE',
      expression: row.qual_expression || 'true',
      withCheck: row.with_check_expression || '',
      raw: {
        qual: row.qual,
        with_check: row.with_check,
        table_oid: row.table_oid
      }
    };

    return policy;
  }

  /**
   * Normalize PostgreSQL command names to our standard format
   * @param {string} cmd - PostgreSQL command (SELECT, INSERT, etc.)
   * @returns {string} Normalized command name
   */
  normalizeCommand(cmd: string): string {
    const commandMap: { [key: string]: string } = {
      'r': 'SELECT',
      'a': 'INSERT', 
      'w': 'UPDATE',
      'd': 'DELETE',
      '*': 'ALL'
    };
    
    return commandMap[cmd] || cmd;
  }

  /**
   * Parse PostgreSQL roles array into JavaScript array
   * @param {string} rolesString - PostgreSQL roles array string like {user,admin}
   * @returns {string[]} Array of role names
   */
  parseRoles(rolesString: string): string[] {
    if (!rolesString) return [];
    
    // Remove curly braces and split by comma
    return rolesString
      .replace(/[{}]/g, '')
      .split(',')
      .map(role => role.trim())
      .filter(role => role.length > 0);
  }

  /**
   * Get table information for context
   * @param {string[]} tableNames - List of table names
   * @returns {Promise<Object>} Table metadata
   */
  async getTableInfo(tableNames: string[]): Promise<{ [key: string]: TableInfo }> {
    if (!tableNames || tableNames.length === 0) return {};

    const query = `
      SELECT 
        t.table_name,
        t.table_schema,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default
      FROM information_schema.tables t
      LEFT JOIN information_schema.columns c ON c.table_name = t.table_name 
        AND c.table_schema = t.table_schema
      WHERE t.table_name = ANY($1)
        AND t.table_schema NOT IN ('information_schema', 'pg_catalog')
      ORDER BY t.table_name, c.ordinal_position;
    `;

    const result = await this.db.client.query(query, [tableNames]);
    const tables: { [key: string]: TableInfo } = {};

    result.rows.forEach(row => {
      if (!tables[row.table_name]) {
        tables[row.table_name] = {
          schema: row.table_schema,
          columns: []
        };
      }

      if (row.column_name) {
        tables[row.table_name].columns.push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === 'YES',
          default: row.column_default
        });
      }
    });

    return tables;
  }

  /**
   * Check if RLS is enabled on tables
   * @param {string[]} tableNames - List of table names to check
   * @returns {Promise<Object>} Map of table name to RLS status
   */
  async getRlsStatus(tableNames: string[]): Promise<{ [key: string]: RlsStatus }> {
    if (!tableNames || tableNames.length === 0) return {};

    const query = `
      SELECT 
        c.relname as table_name,
        n.nspname as schema_name,
        c.relrowsecurity as rls_enabled,
        c.relforcerowsecurity as rls_forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = ANY($1)
        AND c.relkind = 'r'
        AND n.nspname NOT IN ('information_schema', 'pg_catalog');
    `;

    const result = await this.db.client.query(query, [tableNames]);
    const status: { [key: string]: RlsStatus } = {};

    result.rows.forEach(row => {
      status[row.table_name] = {
        enabled: row.rls_enabled,
        forced: row.rls_forced,
        schema: row.schema_name
      };
    });

    return status;
  }
}