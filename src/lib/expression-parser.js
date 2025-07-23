// Expression Parser - Convert SQL expressions back to helper functions
// This module analyzes PostgreSQL RLS expressions and tries to map them back to our helper functions

/**
 * Parse a PostgreSQL RLS expression and attempt to convert it to helper function calls
 * @param {string} expression - SQL expression from RLS policy
 * @returns {Object} Parsed expression with helper function mapping
 */
export function parseExpression(expression) {
  if (!expression || expression.trim() === '') {
    return { helper: 'publicAccess', raw: expression, confidence: 1.0 };
  }

  const normalized = expression.trim().toLowerCase();

  // Handle simple boolean values
  if (normalized === 'true') {
    return { helper: 'publicAccess', raw: expression, confidence: 1.0 };
  }
  
  if (normalized === 'false') {
    return { helper: 'noAccess', raw: expression, confidence: 1.0 };
  }

  // Try to match against known helper patterns
  const patterns = [
    {
      name: 'currentUserId',
      regex: /\(?(\w+)\s*=\s*\(?current_setting\('app\.current_user_id'(?:::text)?\)(?:::uuid)?\)?/i,
      confidence: 0.9,
      extract: (match) => ({ column: match[1] })
    },
    {
      name: 'tenantId', 
      regex: /(\w+)\s*=\s*current_setting\('app\.tenant_id'\)::uuid/i,
      confidence: 0.9,
      extract: (match) => ({ column: match[1] })
    },
    {
      name: 'roleCheck',
      regex: /current_setting\('app\.user_role'\)\s*=\s*'([^']+)'/i,
      confidence: 0.9,
      extract: (match) => ({ role: match[1] })
    },
    {
      name: 'recentData',
      regex: /\(?(\w+)\s*>=\s*\(?(?:current_date|CURRENT_DATE)\s*-\s*(?:'(\d+)\s*days?'::interval|interval\s*'(\d+)\s*days?')\)?/i,
      confidence: 0.8,
      extract: (match) => ({ column: match[1], days: parseInt(match[2] || match[3]) })
    },
    {
      name: 'timeWindow',
      regex: /(\w+)\s*>=\s*now\(\)\s*-\s*interval\s*'(\d+)\s*hours?'/i,
      confidence: 0.8,
      extract: (match) => ({ column: match[1], hours: parseInt(match[2]) })
    },
    {
      name: 'ownerOnly',
      regex: /(\w+)\s*=\s*(\w+)/i,
      confidence: 0.6,
      extract: (match) => ({ userColumn: match[1], ownerColumn: match[2] })
    }
  ];

  // Try to match against patterns
  for (const pattern of patterns) {
    const match = expression.match(pattern.regex);
    if (match) {
      return {
        helper: pattern.name,
        params: pattern.extract(match),
        raw: expression,
        confidence: pattern.confidence
      };
    }
  }

  // Check for complex expressions that might combine multiple conditions
  if (expression.includes(' AND ') || expression.includes(' OR ')) {
    return parseComplexExpression(expression);
  }

  // If no pattern matches, return as raw expression
  return {
    helper: 'custom',
    raw: expression,
    confidence: 0.0,
    reason: 'No matching helper pattern found'
  };
}

/**
 * Parse complex expressions with AND/OR operators
 * @param {string} expression - Complex SQL expression
 * @returns {Object} Parsed complex expression
 */
function parseComplexExpression(expression) {
  // For now, treat complex expressions as custom
  // Future enhancement: recursively parse sub-expressions
  const conditions = [];
  
  // Split by AND/OR and try to parse each part
  const parts = expression.split(/\s+(AND|OR)\s+/i);
  
  for (let i = 0; i < parts.length; i += 2) {
    const part = parts[i];
    const parsed = parseExpression(part);
    if (parsed.helper !== 'custom') {
      conditions.push(parsed);
    }
  }

  if (conditions.length > 0) {
    return {
      helper: 'complex',
      conditions: conditions,
      raw: expression,
      confidence: Math.min(...conditions.map(c => c.confidence)) * 0.8
    };
  }

  return {
    helper: 'custom',
    raw: expression,
    confidence: 0.0,
    reason: 'Complex expression could not be parsed'
  };
}

/**
 * Generate helper function call from parsed expression
 * @param {Object} parsed - Parsed expression object
 * @returns {string} Helper function call as string
 */
export function generateHelperCall(parsed) {
  if (!parsed || parsed.helper === 'custom') {
    return `"${parsed.raw}"`;
  }

  switch (parsed.helper) {
    case 'publicAccess':
      return 'publicAccess()';
      
    case 'noAccess':
      return 'noAccess()';
      
    case 'currentUserId':
      return parsed.params.column === 'user_id' 
        ? 'currentUserId()' 
        : `currentUserId("${parsed.params.column}")`;
        
    case 'tenantId':
      return parsed.params.column === 'tenant_id'
        ? 'tenantId()'
        : `tenantId("${parsed.params.column}")`;
        
    case 'roleCheck':
      return `roleCheck("${parsed.params.role}")`;
      
    case 'recentData':
      return parsed.params.column === 'created_at' && parsed.params.days === 90
        ? 'recentData()'
        : `recentData("${parsed.params.column}", ${parsed.params.days})`;
        
    case 'timeWindow':
      return `timeWindow("${parsed.params.column}", ${parsed.params.hours})`;
      
    case 'ownerOnly':
      return parsed.params.userColumn === 'user_id' && parsed.params.ownerColumn === 'owner_id'
        ? 'ownerOnly()'
        : `ownerOnly("${parsed.params.userColumn}", "${parsed.params.ownerColumn}")`;
        
    case 'complex':
      const conditions = parsed.conditions.map(c => generateHelperCall(c)).join(', ');
      return `/* Complex: ${parsed.raw} */ "${parsed.raw}"`;
      
    default:
      return `"${parsed.raw}"`;
  }
}

/**
 * Analyze expression and provide suggestions for improvement
 * @param {Object} parsed - Parsed expression object  
 * @returns {Object} Analysis with suggestions
 */
export function analyzeExpression(parsed) {
  const analysis = {
    confidence: parsed.confidence,
    suggestions: [],
    warnings: []
  };

  if (parsed.confidence < 0.5) {
    analysis.warnings.push('Low confidence in helper function mapping');
    analysis.suggestions.push('Consider using a custom expression or updating helper patterns');
  }

  if (parsed.helper === 'custom') {
    analysis.suggestions.push('Expression could not be mapped to helper function');
    analysis.suggestions.push('Review if this pattern should be added to available helpers');
  }

  if (parsed.helper === 'ownerOnly' && parsed.confidence < 0.8) {
    analysis.warnings.push('Simple column comparison detected - verify this is actually owner-based access');
    analysis.suggestions.push('Consider if this should use currentUserId() instead');
  }

  return analysis;
}