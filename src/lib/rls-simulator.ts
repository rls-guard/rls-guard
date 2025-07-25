// RLS Simulator - Local policy evaluation without database
// This module simulates PostgreSQL RLS policy evaluation using mock data

export interface MockData {
  [tableName: string]: Record<string, any>[];
}

export interface UserContext {
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

/**
 * RLS Simulator class for local policy testing
 */
export class RLSSimulator {
  private data: MockData;
  private context: UserContext;
  private policies: PolicyDefinition[];

  constructor(data: MockData, policies: PolicyDefinition[] = []) {
    this.data = data;
    this.policies = policies;
    this.context = { user: '', role: 'public' };
  }

  /**
   * Set the current user context for policy evaluation
   */
  setContext(context: UserContext) {
    this.context = context;
  }

  /**
   * Get current user context
   */
  getContext(): UserContext {
    return this.context;
  }

  /**
   * Simulate a SELECT query with RLS policies applied
   */
  select(tableName: string): Record<string, any>[] {
    const tableData = this.data[tableName] || [];
    const applicablePolicies = this.getApplicablePolicies(tableName, 'SELECT');
    
    if (applicablePolicies.length === 0) {
      // No RLS policies, return all data
      return tableData;
    }

    // Apply RLS filtering
    return tableData.filter(row => {
      return applicablePolicies.some(policy => 
        this.evaluateExpression(policy.expression, row, tableName)
      );
    });
  }

  /**
   * Check if a specific row would be accessible for INSERT/UPDATE
   */
  canInsertOrUpdate(tableName: string, row: Record<string, any>): boolean {
    const applicablePolicies = this.getApplicablePolicies(tableName, 'INSERT')
      .concat(this.getApplicablePolicies(tableName, 'UPDATE'))
      .concat(this.getApplicablePolicies(tableName, 'ALL'));
    
    if (applicablePolicies.length === 0) {
      return true; // No RLS policies
    }

    return applicablePolicies.some(policy => 
      this.evaluateExpression(policy.expression, row, tableName)
    );
  }

  /**
   * Get policies that apply to the current user context and command
   */
  private getApplicablePolicies(tableName: string, command: string): PolicyDefinition[] {
    return this.policies.filter(policy => {
      // Check table match
      if (policy.table !== tableName) return false;
      
      // Check command match
      if (policy.command !== 'ALL' && policy.command !== command) return false;
      
      // Check role match
      return policy.roles.includes(this.context.role) || 
             policy.roles.includes('public');
    });
  }

  /**
   * Evaluate a PostgreSQL expression against a row in JavaScript
   */
  private evaluateExpression(expression: string, row: Record<string, any>, tableName: string): boolean {
    try {
      // Create evaluation context
      const evalContext = this.createEvaluationContext(row, tableName);
      
      // Convert PostgreSQL expression to JavaScript
      const jsExpression = this.convertToJavaScript(expression);
      
      // Safely evaluate the expression
      return this.safeEval(jsExpression, evalContext);
    } catch (error) {
      console.warn(`Error evaluating expression "${expression}":`, error);
      return false;
    }
  }

  /**
   * Create evaluation context with available functions and variables
   */
  private createEvaluationContext(row: Record<string, any>, tableName: string): Record<string, any> {
    const now = new Date();
    const currentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    return {
      // Row data
      ...row,
      
      // PostgreSQL functions simulation
      current_setting: (key: string) => {
        const settings: Record<string, string> = {
          'app.current_user_id': this.context.user,
          'app.user_role': this.context.role,
          'app.tenant_id': this.context.settings?.tenant_id || '',
          ...this.context.settings
        };
        return settings[key] || '';
      },
      
      current_date: currentDate,
      now: () => now,
      
      // Helper functions
      interval: (value: string) => {
        const match = value.match(/(\d+)\s+(days?|hours?|minutes?)/i);
        if (!match) return 0;
        
        const amount = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        
        switch (unit) {
          case 'day':
          case 'days':
            return amount * 24 * 60 * 60 * 1000;
          case 'hour':
          case 'hours':
            return amount * 60 * 60 * 1000;
          case 'minute':
          case 'minutes':
            return amount * 60 * 1000;
          default:
            return 0;
        }
      }
    };
  }

  /**
   * Convert PostgreSQL expression to JavaScript
   */
  private convertToJavaScript(expression: string): string {
    let js = expression;
    
    // Handle boolean literals
    js = js.replace(/\btrue\b/gi, 'true');
    js = js.replace(/\bfalse\b/gi, 'false');
    
    // Handle current_setting function calls
    js = js.replace(/current_setting\(['"]([^'"]+)['"]\)/g, 'current_setting("$1")');
    
    // Handle PostgreSQL casting
    js = js.replace(/::uuid/g, ''); // Remove UUID casting
    js = js.replace(/::text/g, ''); // Remove text casting
    js = js.replace(/::interval/g, ''); // Remove interval casting
    
    // Handle date arithmetic
    js = js.replace(/current_date\s*-\s*interval\s*['"]([^'"]+)['"]/g, 
      'new Date(current_date.getTime() - interval("$1"))');
    js = js.replace(/now\(\)\s*-\s*interval\s*['"]([^'"]+)['"]/g, 
      'new Date(now().getTime() - interval("$1"))');
    
    // Handle date comparisons
    js = js.replace(/(\w+)\s*(>=|<=|>|<)\s*(current_date|now\(\))/g, 
      'new Date($1).getTime() $2 $3.getTime()');
    js = js.replace(/(current_date|now\(\))\s*(>=|<=|>|<)\s*(\w+)/g, 
      '$1.getTime() $2 new Date($3).getTime()');
    
    // Handle parentheses around expressions  
    js = js.replace(/^\s*\((.*)\)\s*$/, '$1');
    
    return js;
  }

  /**
   * Safely evaluate JavaScript expression with limited scope
   */
  private safeEval(expression: string, context: Record<string, any>): boolean {
    // Create a function with the context variables as parameters
    const contextKeys = Object.keys(context);
    const contextValues = contextKeys.map(key => context[key]);
    
    try {
      const func = new Function(...contextKeys, `return !!(${expression})`);
      return func(...contextValues);
    } catch (error) {
      console.warn(`Failed to evaluate expression: ${expression}`, error);
      return false;
    }
  }

  /**
   * Add policies to the simulator
   */
  addPolicies(policies: PolicyDefinition[]) {
    this.policies.push(...policies);
  }

  /**
   * Clear all policies
   */
  clearPolicies() {
    this.policies = [];
  }

  /**
   * Get all loaded policies
   */
  getPolicies(): PolicyDefinition[] {
    return [...this.policies];
  }
}