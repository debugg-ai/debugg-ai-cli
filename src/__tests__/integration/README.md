# DebuggAI CLI Integration Tests

This directory contains integration tests that validate the interoperability between the DebuggAI CLI and the backend server using real API calls and infrastructure.

## Overview

The integration tests are designed to:
- Test real API connectivity with your personal credentials
- Validate ngrok tunnel creation and management
- Execute complete end-to-end workflows
- Verify backend service compatibility
- Test enhanced git analysis and context extraction

## Prerequisites

### Setup with .env File (Recommended)

The integration tests automatically load environment variables from a `.env` file in your project root.

1. **Copy the example .env file**:
```bash
cp .env.integration-example .env
```

2. **Edit the .env file** with your actual credentials:
```bash
# Required: Your personal DebuggAI API key
DEBUGGAI_API_KEY=your-actual-api-key

# Required: Your personal ngrok auth token
NGROK_AUTH_TOKEN=your-actual-ngrok-token

# Optional: Custom API base URL
DEBUGGAI_BASE_URL=https://your-custom-api-endpoint.com
```

### Alternative: Environment Variables

You can also set environment variables directly:

```bash
# Required: Your personal DebuggAI API key
export DEBUGGAI_API_KEY="your-api-key-here"

# Required: Your personal ngrok auth token
export NGROK_AUTH_TOKEN="your-ngrok-auth-token-here"

# Optional: Custom API base URL (defaults to https://api.debugg.ai)
export DEBUGGAI_BASE_URL="https://your-custom-api-endpoint.com"
```

### Optional Configuration Variables

```bash
# Test timeout in milliseconds (default: 120000)
export INTEGRATION_TIMEOUT="180000"

# Skip tunnel tests (useful if ngrok is not available)
export INTEGRATION_SKIP_TUNNEL="false"

# Skip workflow tests (useful for faster API-only testing)
export INTEGRATION_SKIP_WORKFLOW="false"

# Path to test repository (defaults to current directory)
export INTEGRATION_TEST_REPO="/path/to/your/test/repo"

# Port for test server (default: 3000)
export INTEGRATION_TEST_PORT="3000"

# Enable verbose logging
export INTEGRATION_VERBOSE="true"
```

## Getting Your Credentials

### DebuggAI API Key
1. Log into your DebuggAI account
2. Navigate to Settings → API Keys
3. Generate a new API key or copy an existing one
4. Set `DEBUGGAI_API_KEY=your-key-here`

### ngrok Auth Token
1. Sign up for a free ngrok account at https://ngrok.com/
2. Go to your ngrok dashboard
3. Copy your auth token from the "Your Authtoken" section
4. Set `NGROK_AUTH_TOKEN=your-token-here`

## Running Integration Tests

### Run All Integration Tests
```bash
# Set up your .env file first
cp .env.integration-example .env
# Edit .env with your actual credentials

# Run all integration tests
npm run test:integration
```

### Run Specific Integration Test Suites
```bash
# API connectivity tests only
npm test -- --testPathPattern="api-integration"

# Tunnel tests only
npm test -- --testPathPattern="tunnel-integration"

# Workflow tests only
npm test -- --testPathPattern="workflow-integration"
```

### Run with Verbose Output
```bash
INTEGRATION_VERBOSE=true npm run test:integration
```

### Skip Certain Test Types
```bash
# Skip tunnel tests (useful if ngrok quota is limited)
INTEGRATION_SKIP_TUNNEL=true npm run test:integration

# Skip workflow tests (for faster API validation)
INTEGRATION_SKIP_WORKFLOW=true npm run test:integration
```

## Test Suites

### 1. API Integration Tests (`api-integration.test.ts`)
Tests real API connectivity and backend interoperability:
- ✅ Backend health endpoint connectivity
- ✅ User authentication validation
- ✅ Commit test suite creation with real git data
- ✅ Test suite status retrieval
- ✅ Test suite listing with filters
- ✅ URL accessibility validation
- ✅ Error handling for invalid requests
- ✅ Enhanced git context analysis

### 2. Tunnel Integration Tests (`tunnel-integration.test.ts`)
Tests real ngrok tunnel creation and management:
- ✅ ngrok tunnel creation with personal auth token
- ✅ Tunnel connectivity validation
- ✅ Custom subdomain creation (Pro accounts)
- ✅ Multiple tunnel management
- ✅ Tunnel disconnection
- ✅ Test environment recommendations for ngrok
- ✅ Test suite creation with real tunnel URLs

### 3. Workflow Integration Tests (`workflow-integration.test.ts`)
Tests complete end-to-end workflows:
- ✅ Full workflow execution (server + tunnel + tests)
- ✅ Tunnel connectivity verification
- ✅ Direct test manager execution
- ✅ Error handling and cleanup
- ✅ Server readiness detection
- ✅ Git analysis with real repository data

## Adding to Package.json

Add this script to your `package.json`:

```json
{
  "scripts": {
    "test:integration": "jest --testPathPattern=integration --detectOpenHandles --forceExit"
  }
}
```

## Troubleshooting

### Common Issues

1. **"Missing credentials" errors**
   - Ensure `DEBUGGAI_API_KEY` and `NGROK_AUTH_TOKEN` are set
   - Check that the credentials are valid

2. **ngrok tunnel creation failures**
   - Verify your ngrok auth token is correct
   - Check if you've exceeded ngrok's free tier limits
   - Set `INTEGRATION_SKIP_TUNNEL=true` to skip tunnel tests

3. **API connection timeouts**
   - Check your network connection
   - Verify the `DEBUGGAI_BASE_URL` if using custom endpoint
   - Increase `INTEGRATION_TIMEOUT` for slower networks

4. **Test timeouts on workflow tests**
   - Workflow tests can take 2-3 minutes to complete
   - Ensure you have a stable internet connection
   - Set `INTEGRATION_SKIP_WORKFLOW=true` to skip if needed

### Debug Mode

For detailed debugging information:

```bash
INTEGRATION_VERBOSE=true DEBUG=* npm run test:integration
```

### CI/CD Integration

For CI/CD environments, add these secrets:
- `DEBUGGAI_API_KEY`: Your API key
- `NGROK_AUTH_TOKEN`: Your ngrok token

Example GitHub Actions workflow:
```yaml
- name: Run Integration Tests
  env:
    DEBUGGAI_API_KEY: ${{ secrets.DEBUGGAI_API_KEY }}
    NGROK_AUTH_TOKEN: ${{ secrets.NGROK_AUTH_TOKEN }}
  run: npm run test:integration
```

## Test Coverage

The integration tests cover:
- ✅ Real backend API interoperability
- ✅ Authentication and authorization
- ✅ Git analysis with enhanced context
- ✅ ngrok tunnel management
- ✅ End-to-end workflow execution
- ✅ Error handling and recovery
- ✅ Resource cleanup
- ✅ Backend service patterns integration

## Performance Considerations

- Integration tests typically take 2-5 minutes to complete
- ngrok tunnel creation adds ~10-30 seconds per tunnel
- API calls to real backend may vary based on network latency
- Tests create minimal test suites to avoid excessive resource usage

## Security Notes

- Integration tests use real credentials but create minimal, temporary resources
- All tunnels and test suites are cleaned up after tests complete
- Tests include timeout limits to prevent runaway processes
- No sensitive data is logged in test output (unless `INTEGRATION_VERBOSE=true`)