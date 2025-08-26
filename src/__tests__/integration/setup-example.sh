#!/bin/bash

# DebuggAI CLI Integration Tests Setup
# 
# This script helps you set up environment variables for running integration tests.
# 
# RECOMMENDED: Use .env file instead by running:
#   cp .env.integration-example .env
#   # Then edit .env with your actual credentials
# 
# Alternative: Copy this file to setup.sh and fill in your actual credentials

echo "Setting up DebuggAI CLI integration test environment..."
echo "NOTE: Consider using .env file instead (see .env.integration-example)"

# Required: Your personal DebuggAI API key
# Get this from your DebuggAI dashboard → Settings → API Keys
export DEBUGGAI_API_KEY="your-api-key-here"

# Required: Your personal ngrok auth token  
# Get this from https://dashboard.ngrok.com/get-started/your-authtoken
export NGROK_AUTH_TOKEN="your-ngrok-token-here"

# Optional: Custom API base URL (defaults to https://api.debugg.ai)
# export DEBUGGAI_BASE_URL="https://your-custom-api-endpoint.com"

# Optional: Test configuration
# export INTEGRATION_TIMEOUT="180000"        # Test timeout in milliseconds
# export INTEGRATION_SKIP_TUNNEL="false"     # Skip tunnel tests
# export INTEGRATION_SKIP_WORKFLOW="false"   # Skip workflow tests  
# export INTEGRATION_TEST_REPO="$(pwd)"      # Test repository path
# export INTEGRATION_TEST_PORT="3000"        # Test server port
# export INTEGRATION_VERBOSE="true"          # Enable verbose logging

echo "Environment variables set. You can now run:"
echo "  npm run test:integration"
echo ""
echo "Or run specific test suites:"
echo "  npm test -- --testPathPattern=\"api-integration\""
echo "  npm test -- --testPathPattern=\"tunnel-integration\""
echo "  npm test -- --testPathPattern=\"workflow-integration\""
echo ""
echo "Note: Make sure to replace the placeholder values above with your actual credentials!"

# Validate that required environment variables are set
if [[ -z "$DEBUGGAI_API_KEY" || "$DEBUGGAI_API_KEY" == "your-api-key-here" ]]; then
    echo "⚠️  WARNING: DEBUGGAI_API_KEY is not set or still has placeholder value"
fi

if [[ -z "$NGROK_AUTH_TOKEN" || "$NGROK_AUTH_TOKEN" == "your-ngrok-token-here" ]]; then
    echo "⚠️  WARNING: NGROK_AUTH_TOKEN is not set or still has placeholder value"
fi

if [[ -n "$DEBUGGAI_API_KEY" && "$DEBUGGAI_API_KEY" != "your-api-key-here" ]] && 
   [[ -n "$NGROK_AUTH_TOKEN" && "$NGROK_AUTH_TOKEN" != "your-ngrok-token-here" ]]; then
    echo "✅ Credentials appear to be set correctly!"
else
    echo ""
    echo "To get started:"
    echo "1. Copy this file: cp setup-example.sh setup.sh"
    echo "2. Edit setup.sh and replace the placeholder values"
    echo "3. Run: source setup.sh"
    echo "4. Run: npm run test:integration"
fi