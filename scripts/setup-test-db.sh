#!/bin/bash

# Setup script for test database
# This script starts a PostgreSQL container for testing

set -e

DB_NAME="rls_guard_test"
DB_USER="postgres"
DB_PASSWORD="password"
DB_PORT="5433"
CONTAINER_NAME="rls-guard-test-db"

echo "🐘 Setting up PostgreSQL test database..."

# Stop and remove existing container if it exists
if docker ps -a --format 'table {{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Stopping existing container..."
    docker stop ${CONTAINER_NAME} || true
    docker rm ${CONTAINER_NAME} || true
fi

# Start PostgreSQL container
echo "Starting PostgreSQL container..."
docker run -d \
    --name ${CONTAINER_NAME} \
    -e POSTGRES_DB=${DB_NAME} \
    -e POSTGRES_USER=${DB_USER} \
    -e POSTGRES_PASSWORD=${DB_PASSWORD} \
    -p ${DB_PORT}:5432 \
    postgres:15-alpine

# Wait for database to be ready
echo "Waiting for database to be ready..."
for i in {1..30}; do
    if docker exec ${CONTAINER_NAME} pg_isready -U ${DB_USER} -d ${DB_NAME} >/dev/null 2>&1; then
        echo "✅ Database is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Database failed to start within 30 seconds"
        exit 1
    fi
    sleep 1
done

# Export connection string
export TEST_DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}"

echo ""
echo "🎉 Test database is ready!"
echo "Connection string: ${TEST_DATABASE_URL}"
echo ""
echo "To run integration tests:"
echo "  export TEST_DATABASE_URL=\"${TEST_DATABASE_URL}\""
echo "  npm run test:db"
echo ""
echo "To stop the test database:"
echo "  docker stop ${CONTAINER_NAME}"
echo "  docker rm ${CONTAINER_NAME}"