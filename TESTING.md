# Testing Guide

This document explains how to run the various test suites for RLS Guard.

## Test Categories

### 1. Unit Tests
Tests individual components and functions without external dependencies.

```bash
npm test
```

This runs:
- Library component tests (PolicyIntrospector, ExpressionParser, ConfigGenerator)
- Basic CLI integration tests

### 2. All CLI Tests
Tests all CLI commands with mocked scenarios.

```bash
npm run test:all
```

**Note:** Some tests may fail if no test database is available.

### 3. Database Integration Tests
Full end-to-end tests with a real PostgreSQL database.

```bash
# Option 1: Use existing database
export TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/testdb"
npm run test:db

# Option 2: Use Docker setup
npm run test:db-setup    # Starts PostgreSQL container
npm run test:db         # Runs database tests
npm run test:db-teardown # Stops container

# Option 3: Full automated test
npm run test:full       # Setup + Test + Teardown
```

## Database Integration Test Features

The database integration tests create a real PostgreSQL environment and test:

✅ **Pull Command**
- Extract existing RLS policies from database
- Generate TypeScript and JSON configurations
- Filter policies by table
- Handle complex expressions and map to helper functions
- Mask sensitive connection information

✅ **Deploy Command**
- Deploy policies from configuration files
- Dry-run mode validation
- Handle multiple policies and restrictive policies

✅ **Init Command**
- Generate starter configuration files
- Validate generated configurations

✅ **End-to-End Workflows**
- Pull → Modify → Deploy cycles
- Complex expression parsing and generation
- Empty database handling

## Test Database Setup

### Using Docker (Recommended)

```bash
# Start test database
npm run test:db-setup

# This creates a PostgreSQL container with:
# - Database: rls_guard_test
# - User: postgres
# - Password: password
# - Port: 5432
```

### Using Existing PostgreSQL

Set the `TEST_DATABASE_URL` environment variable:

```bash
export TEST_DATABASE_URL="postgresql://user:pass@host:port/database"
npm run test:db
```

### Manual Setup

If you prefer to set up PostgreSQL manually:

```sql
CREATE DATABASE rls_guard_test;
CREATE USER test_user WITH PASSWORD 'test_password';
GRANT ALL PRIVILEGES ON DATABASE rls_guard_test TO test_user;
```

## Test Scenarios Covered

### Real RLS Policies
The tests create and verify real PostgreSQL RLS policies:

```sql
-- User isolation
CREATE POLICY user_isolation ON users
  FOR SELECT TO authenticated_user
  USING (user_id = current_setting('app.current_user_id')::uuid);

-- Admin access
CREATE POLICY admin_full_access ON users
  FOR ALL TO admin
  USING (true);

-- Time-based access
CREATE POLICY recent_posts ON posts
  FOR SELECT TO public
  USING (created_at >= current_date - interval '30 days');

-- Restrictive policies
CREATE POLICY sensitive_data_restriction ON sensitive_data
  FOR SELECT TO public
  USING (false) WITH CHECK (false);
```

### Expression Mapping
Tests verify that SQL expressions are correctly mapped to helper functions:

- `user_id = current_setting('app.current_user_id')::uuid` → `currentUserId()`
- `true` → `publicAccess()`
- `false` → `noAccess()`
- `created_at >= current_date - interval '30 days'` → `recentData("created_at", 30)`

### Configuration Generation
Tests ensure generated configurations:

- Have proper TypeScript imports
- Group policies by table
- Handle multiple roles correctly
- Include comments when requested
- Mask connection strings for security
- Support both TypeScript and JSON formats

## Continuous Integration

GitHub Actions automatically runs:

1. **Unit Tests** on Node.js 18, 20, and 22
2. **Integration Tests** with PostgreSQL service
3. **Docker Tests** with full container setup

## Debugging Tests

### Enable Verbose Output

```bash
# Run with detailed output
node --test --reporter=spec test/database-integration.test.js

# Run specific test
node --test --grep "should pull existing policies" test/database-integration.test.js
```

### Check Database State

```bash
# Connect to test database
docker exec -it rls-guard-test-db psql -U postgres -d rls_guard_test

# View policies
\dp
SELECT schemaname, tablename, policyname FROM pg_policies;
```

### Clean Up

```bash
# Remove test database
npm run test:db-teardown

# Clean test files
rm -rf test-temp/
```

## Writing New Tests

### Unit Tests
Add to `test/lib-only.test.js` for testing individual components.

### Integration Tests
Add to `test/database-integration.test.js` for database-dependent functionality.

### CLI Tests
Add to `test/integration.test.js` for command-line interface testing.

## Test Dependencies

```json
{
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "postgres-memory-server": "^1.0.1",
    "tmp": "^0.2.1"
  }
}
```

The test suite uses Node.js built-in test runner (available in Node 18+) and doesn't require additional testing frameworks.