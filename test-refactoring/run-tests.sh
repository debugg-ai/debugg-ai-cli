#!/bin/bash

# Test runner script for refactoring validation
set -e

echo "🔨 Building project..."
cd ..
npm run build

echo ""
echo "🧪 Starting test suite..."
echo "================================"

# Test 1: Tunnel Service
echo ""
echo "1️⃣ Testing TunnelService..."
echo "--------------------------------"
npx ts-node test-refactoring/test-tunnel-service.ts

# Test 2: API Client
echo ""
echo "2️⃣ Testing ApiClient..."
echo "--------------------------------"
npx ts-node test-refactoring/test-api-client.ts

# Test 3: End-to-End Integration
echo ""
echo "3️⃣ Testing End-to-End Integration..."
echo "--------------------------------"
npx ts-node test-refactoring/test-integration.ts

echo ""
echo "================================"
echo "✅ All tests completed successfully!"