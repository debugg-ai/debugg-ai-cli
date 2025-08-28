/**
 * Integration Test Configuration
 * 
 * This file defines the configuration for integration tests that run against
 * real DebuggAI backend services using personal credentials.
 * 
 * Automatically loads environment variables from .env file in project root.
 * 
 * Required Environment Variables (set in .env file or environment):
 * - DEBUGGAI_API_KEY: Your personal API key
 * - DEBUGGAI_BASE_URL: Custom base URL for API endpoint (optional, defaults to production)
 * - NGROK_AUTH_TOKEN: Your personal ngrok auth token
 * 
 * Optional Environment Variables:
 * - INTEGRATION_TIMEOUT: Test timeout in milliseconds (default: 120000)
 * - INTEGRATION_SKIP_TUNNEL: Skip tunnel tests (default: false)
 * - INTEGRATION_SKIP_WORKFLOW: Skip workflow tests (default: false)
 * - INTEGRATION_TEST_REPO: Path to test repository (default: current directory)
 * 
 * CI Environment Behavior:
 * - RUN_INTEGRATION_TESTS: Set to 'true' to enable integration tests in CI (default: false)
 * - RUN_BACKEND_TESTS: Set to 'true' to enable backend-dependent tests in CI (default: false)
 * - Tests are automatically skipped in CI environments unless explicitly enabled
 * 
 * @jest-environment node
 * @fileoverview Configuration utilities for integration tests - not a test file
 */

// Import setup to ensure .env is loaded
import './setup';

export interface IntegrationTestConfig {
  apiKey: string;
  baseUrl: string;
  ngrokAuthToken: string;
  timeout: number;
  skipTunnelTests: boolean;
  skipWorkflowTests: boolean;
  testRepoPath: string;
  testPort: number;
  verbose: boolean;
}

export function getIntegrationConfig(): IntegrationTestConfig {
  const apiKey = process.env.DEBUGGAI_API_KEY;
  const ngrokAuthToken = process.env.NGROK_AUTH_TOKEN;
  
  if (!apiKey) {
    throw new Error(`DEBUGGAI_API_KEY environment variable is required for integration tests. 
Add it to your .env file in the project root or set it as an environment variable.`);
  }
  
  if (!ngrokAuthToken) {
    throw new Error(`NGROK_AUTH_TOKEN environment variable is required for integration tests. 
Add it to your .env file in the project root or set it as an environment variable.`);
  }

  const config = {
    apiKey,
    baseUrl: process.env.DEBUGGAI_BASE_URL || 'https://api.debugg.ai',
    ngrokAuthToken,
    timeout: parseInt(process.env.INTEGRATION_TIMEOUT || '120000', 10),
    skipTunnelTests: process.env.INTEGRATION_SKIP_TUNNEL === 'true',
    skipWorkflowTests: process.env.INTEGRATION_SKIP_WORKFLOW === 'true',
    testRepoPath: process.env.INTEGRATION_TEST_REPO || process.cwd(),
    testPort: parseInt(process.env.INTEGRATION_TEST_PORT || '3000', 10),
    verbose: process.env.INTEGRATION_VERBOSE === 'true'
  };

  // Log configuration source if verbose
  if (config.verbose) {
    console.log('Integration test configuration loaded:', {
      baseUrl: config.baseUrl,
      testRepoPath: config.testRepoPath,
      testPort: config.testPort,
      skipTunnelTests: config.skipTunnelTests,
      skipWorkflowTests: config.skipWorkflowTests
    });
  }

  return config;
}

export function shouldRunIntegrationTests(): boolean {
  // Skip integration tests in CI environments unless explicitly enabled
  if (isCI() && !process.env.RUN_INTEGRATION_TESTS) {
    return false;
  }

  const apiKey = process.env.DEBUGGAI_API_KEY;
  const ngrokToken = process.env.NGROK_AUTH_TOKEN;
  
  // Check if credentials are set AND not placeholder values
  const hasValidApiKey = apiKey && 
    apiKey !== 'your-actual-api-key-here' && 
    apiKey !== 'your-api-key-here' &&
    !apiKey.includes('placeholder') &&
    !apiKey.includes('your-');
    
  const hasValidNgrokToken = ngrokToken && 
    ngrokToken !== 'your-actual-ngrok-token-here' && 
    ngrokToken !== 'your-ngrok-token-here' &&
    !ngrokToken.includes('placeholder') &&
    !ngrokToken.includes('your-');
  
  return !!(hasValidApiKey && hasValidNgrokToken);
}

/**
 * Detect if running in CI environment
 */
export function isCI(): boolean {
  return !!(
    process.env.CI || // Generic CI flag
    process.env.GITHUB_ACTIONS || // GitHub Actions
    process.env.TRAVIS || // Travis CI
    process.env.CIRCLECI || // Circle CI
    process.env.JENKINS_URL || // Jenkins
    process.env.BUILDKITE || // Buildkite
    process.env.GITLAB_CI // GitLab CI
  );
}

/**
 * Check if backend-dependent tests should run
 */
export function shouldRunBackendTests(): boolean {
  // In CI, skip backend tests unless explicitly enabled
  if (isCI() && !process.env.RUN_BACKEND_TESTS) {
    return false;
  }
  
  // Otherwise use the same logic as integration tests
  return shouldRunIntegrationTests();
}

/**
 * Describe block for backend-dependent tests
 * Skips tests in CI unless explicitly enabled
 */
export function describeBackend(name: string, fn: () => void): void {
  const shouldRun = shouldRunBackendTests();
  
  if (!shouldRun) {
    describe.skip(`${name} (skipped - ${isCI() ? 'CI environment' : 'no credentials'})`, fn);
  } else {
    describe(name, fn);
  }
}

/**
 * Test block for backend-dependent tests
 * Skips tests in CI unless explicitly enabled
 */
export function itBackend(
  name: string, 
  fn?: jest.ProvidesCallback, 
  timeout?: number
): void {
  const shouldRun = shouldRunBackendTests();
  
  if (!shouldRun) {
    it.skip(`${name} (skipped - ${isCI() ? 'CI environment' : 'no credentials'})`, fn, timeout);
  } else {
    it(name, fn, timeout);
  }
}

export function describeIntegration(name: string, fn: () => void): void {
  const shouldRun = shouldRunIntegrationTests();
  
  if (shouldRun) {
    describe(`Integration: ${name}`, fn);
  } else {
    describe.skip(`Integration: ${name} (skipped - missing credentials)`, fn);
  }
}

export function itIntegration(name: string, fn: () => Promise<void>, timeout?: number): void {
  const config = shouldRunIntegrationTests() ? getIntegrationConfig() : null;
  const testTimeout = timeout || config?.timeout || 120000;
  
  if (config) {
    it(name, fn, testTimeout);
  } else {
    it.skip(`${name} (skipped - missing credentials)`, fn);
  }
}