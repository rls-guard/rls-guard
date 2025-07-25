// RLS Guard Testing Framework
// Provides testPolicies function and assertion system for local policy testing

import { RLSSimulator, UserContext, PolicyDefinition } from './rls-simulator.js';

export interface TestData {
  [tableName: string]: Record<string, any>[];
}

export interface TestContext extends UserContext {
  // Allow additional test-specific properties
  [key: string]: any;
}

export interface TestAssertion {
  context: string;
  table: string;
  command: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  expectedRows?: Record<string, any>[];
  expectedCount?: number;
  shouldPass?: boolean;
}

export interface TestPoliciesConfig {
  data: TestData;
  contexts: TestContext[];
  policies?: PolicyDefinition[];
  assertions: TestAssertion[];
}

export interface TestResult {
  passed: boolean;
  total: number;
  failures: TestFailure[];
}

export interface TestFailure {
  assertion: TestAssertion;
  actual: any;
  expected: any;
  message: string;
}

/**
 * Expectation builder for fluent assertion syntax
 */
class Expectation {
  private contextId: string;
  private contexts: TestContext[];
  private simulator: RLSSimulator;

  constructor(contextId: string, contexts: TestContext[], simulator: RLSSimulator) {
    this.contextId = contextId;
    this.contexts = contexts;
    this.simulator = simulator;
  }

  /**
   * Assert that the user can select from a table
   */
  canSelect(tableName: string): RowAssertion {
    const context = this.contexts.find(c => c.user === this.contextId);
    if (!context) {
      throw new Error(`Context not found for user: ${this.contextId}`);
    }

    this.simulator.setContext(context);
    const actualRows = this.simulator.select(tableName);
    
    return new RowAssertion(actualRows, {
      context: this.contextId,
      table: tableName,
      command: 'SELECT'
    });
  }

  /**
   * Assert that the user can insert a row
   */
  canInsert(tableName: string, row: Record<string, any>): BooleanAssertion {
    const context = this.contexts.find(c => c.user === this.contextId);
    if (!context) {
      throw new Error(`Context not found for user: ${this.contextId}`);
    }

    this.simulator.setContext(context);
    const canInsert = this.simulator.canInsertOrUpdate(tableName, row);
    
    return new BooleanAssertion(canInsert, {
      context: this.contextId,
      table: tableName,
      command: 'INSERT',
      shouldPass: true
    });
  }

  /**
   * Assert that the user can update a row
   */
  canUpdate(tableName: string, row: Record<string, any>): BooleanAssertion {
    const context = this.contexts.find(c => c.user === this.contextId);
    if (!context) {
      throw new Error(`Context not found for user: ${this.contextId}`);
    }

    this.simulator.setContext(context);
    const canUpdate = this.simulator.canInsertOrUpdate(tableName, row);
    
    return new BooleanAssertion(canUpdate, {
      context: this.contextId,
      table: tableName,
      command: 'UPDATE',
      shouldPass: true
    });
  }
}

/**
 * Row assertion for SELECT operations
 */
class RowAssertion {
  private actualRows: Record<string, any>[];
  private assertionInfo: Partial<TestAssertion>;

  constructor(actualRows: Record<string, any>[], assertionInfo: Partial<TestAssertion>) {
    this.actualRows = actualRows;
    this.assertionInfo = assertionInfo;
  }

  /**
   * Assert exact rows match
   */
  rows(expectedRows: Record<string, any>[]): TestAssertion {
    return {
      ...this.assertionInfo,
      expectedRows,
      expectedCount: expectedRows.length
    } as TestAssertion;
  }

  /**
   * Assert row count
   */
  count(expectedCount: number): TestAssertion {
    return {
      ...this.assertionInfo,
      expectedCount
    } as TestAssertion;
  }

  /**
   * Assert no rows returned
   */
  noRows(): TestAssertion {
    return this.count(0);
  }
}

/**
 * Boolean assertion for INSERT/UPDATE/DELETE operations
 */
class BooleanAssertion {
  private actual: boolean;
  private assertionInfo: Partial<TestAssertion>;

  constructor(actual: boolean, assertionInfo: Partial<TestAssertion>) {
    this.actual = actual;
    this.assertionInfo = assertionInfo;
  }

  /**
   * Assert operation should succeed
   */
  toPass(): TestAssertion {
    return {
      ...this.assertionInfo,
      shouldPass: true
    } as TestAssertion;
  }

  /**
   * Assert operation should fail
   */
  toFail(): TestAssertion {
    return {
      ...this.assertionInfo,
      shouldPass: false
    } as TestAssertion;
  }
}

/**
 * Create an expectation for a specific user context
 */
export function expect(contextId: string) {
  // This will be bound to the simulator when testPolicies is called
  return (contexts: TestContext[], simulator: RLSSimulator) => 
    new Expectation(contextId, contexts, simulator);
}

/**
 * Main testing function - matches the API from ROADMAP.md
 */
export function testPolicies(config: TestPoliciesConfig): TestResult {
  // Create simulator with test data
  const simulator = new RLSSimulator(config.data, config.policies || []);
  
  const failures: TestFailure[] = [];
  let total = 0;

  // Execute assertions
  for (const assertion of config.assertions) {
    total++;
    
    try {
      // Find the context for this assertion
      const context = config.contexts.find(c => c.user === assertion.context);
      if (!context) {
        failures.push({
          assertion,
          actual: null,
          expected: `context for user ${assertion.context}`,
          message: `Context not found for user: ${assertion.context}`
        });
        continue;
      }

      // Set simulator context
      simulator.setContext(context);

      // Execute the assertion based on command type
      let actualResult: any;
      let passed = false;

      switch (assertion.command) {
        case 'SELECT':
          actualResult = simulator.select(assertion.table);
          
          if (assertion.expectedRows) {
            passed = deepEqual(actualResult, assertion.expectedRows);
            if (!passed) {
              failures.push({
                assertion,
                actual: actualResult,
                expected: assertion.expectedRows,
                message: `Row mismatch for ${assertion.context} selecting from ${assertion.table}`
              });
            }
          } else if (assertion.expectedCount !== undefined) {
            passed = actualResult.length === assertion.expectedCount;
            if (!passed) {
              failures.push({
                assertion,
                actual: actualResult.length,
                expected: assertion.expectedCount,
                message: `Count mismatch for ${assertion.context} selecting from ${assertion.table}`
              });
            }
          }
          break;

        case 'INSERT':
        case 'UPDATE':
          // For INSERT/UPDATE, we need row data in the assertion
          const row = (assertion as any).row || {};
          actualResult = simulator.canInsertOrUpdate(assertion.table, row);
          passed = actualResult === (assertion.shouldPass ?? true);
          
          if (!passed) {
            failures.push({
              assertion,
              actual: actualResult,
              expected: assertion.shouldPass,
              message: `Permission mismatch for ${assertion.context} ${assertion.command.toLowerCase()}ing in ${assertion.table}`
            });
          }
          break;
      }

    } catch (error) {
      failures.push({
        assertion,
        actual: error,
        expected: 'successful execution',
        message: `Error executing assertion: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  return {
    passed: failures.length === 0,
    total,
    failures
  };
}

/**
 * Helper function to convert function-based assertions to TestAssertion objects
 */
export function processAssertion(
  assertionFn: (contexts: TestContext[], simulator: RLSSimulator) => any,
  contexts: TestContext[],
  simulator: RLSSimulator
): TestAssertion[] {
  try {
    const result = assertionFn(contexts, simulator);
    
    // If it's already a TestAssertion, wrap it in an array
    if (result && typeof result === 'object' && 'context' in result) {
      return [result as TestAssertion];
    }
    
    // If it's an array of assertions, return as-is
    if (Array.isArray(result)) {
      return result;
    }
    
    return [];
  } catch (error) {
    console.warn('Error processing assertion:', error);
    return [];
  }
}

/**
 * Enhanced testPolicies that supports function-based assertions
 */
export function testPoliciesAdvanced(config: {
  data: TestData;
  contexts: TestContext[];
  policies?: PolicyDefinition[];
  assertions: (((contexts: TestContext[], simulator: RLSSimulator) => any) | TestAssertion)[];
}): TestResult {
  const simulator = new RLSSimulator(config.data, config.policies || []);
  const processedAssertions: TestAssertion[] = [];
  
  // Process all assertions
  for (const assertion of config.assertions) {
    if (typeof assertion === 'function') {
      const processed = processAssertion(assertion, config.contexts, simulator);
      processedAssertions.push(...processed);
    } else {
      processedAssertions.push(assertion);
    }
  }
  
  // Run the tests with processed assertions
  return testPolicies({
    ...config,
    assertions: processedAssertions
  });
}

/**
 * Deep equality check for objects/arrays
 */
function deepEqual(a: any, b: any): boolean {
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
  
  return keys.every(k => deepEqual(a[k], b[k]));
}

/**
 * Export helper for creating policies from config
 */
export function policiesFromConfig(config: any): PolicyDefinition[] {
  if (!config.policies) return [];
  
  return config.policies.map((p: any) => ({
    name: p.name,
    table: p.table,
    command: p.command,
    roles: p.roles,
    expression: p.expression,
    permissive: p.permissive ?? true
  }));
}

/**
 * User-friendly test definition with type safety
 */
export interface TestDefinition {
  name?: string;
  data: TestData;
  contexts: TestContext[];
  policies?: PolicyDefinition[];
  tests: ((expect: ExpectFactory) => TestAssertion | TestAssertion[])[];
}

export interface ExpectFactory {
  (contextId: string): ExpectationBuilder;
}

export interface ExpectationBuilder extends Expectation {
  // Inherit all methods from Expectation class
}

/**
 * Define tests with a user-friendly API and type safety
 */
export function defineTests(definition: TestDefinition): TestPoliciesConfig {
  const simulator = new RLSSimulator(definition.data, definition.policies || []);
  const assertions: TestAssertion[] = [];
  
  // Create the expect factory function
  const expectFactory: ExpectFactory = (contextId: string) => {
    return new Expectation(contextId, definition.contexts, simulator) as ExpectationBuilder;
  };
  
  // Execute each test function to collect assertions
  for (const testFn of definition.tests) {
    try {
      const result = testFn(expectFactory);
      
      if (Array.isArray(result)) {
        assertions.push(...result);
      } else {
        assertions.push(result);
      }
    } catch (error) {
      console.warn('Error executing test function:', error);
    }
  }
  
  return {
    data: definition.data,
    contexts: definition.contexts,
    policies: definition.policies,
    assertions
  };
}

/**
 * Execute tests defined with defineTests
 */
export function runTests(definition: TestDefinition): TestResult {
  const config = defineTests(definition);
  return testPolicies(config);
}