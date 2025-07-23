#!/bin/bash

# Teardown script for test database
# This script stops and removes the PostgreSQL test container

set -e

CONTAINER_NAME="rls-guard-test-db"

echo "🗑️  Tearing down PostgreSQL test database..."

# Stop and remove container
if docker ps -a --format 'table {{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Stopping and removing container..."
    docker stop ${CONTAINER_NAME} || true
    docker rm ${CONTAINER_NAME} || true
    echo "✅ Test database cleaned up!"
else
    echo "ℹ️  No test database container found"
fi