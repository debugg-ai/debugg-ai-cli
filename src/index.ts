/**
 * @debugg-ai/cli - CLI tool for running DebuggAI tests in CI/CD environments
 * 
 * This module provides programmatic access to the DebuggAI testing functionality.
 * For CLI usage, use the `debugg-ai` command after installing the package.
 */

export { DebuggAIClient } from './lib/api-client';
export { GitAnalyzer } from './lib/git-analyzer';
export { TestManager } from './lib/test-manager';

export type {
  E2eTest,
  E2eTestSuite,
  CommitTestRequest,
  CommitTestResponse,
  ApiClientConfig
} from './lib/api-client';

export type {
  WorkingChange,
  CommitInfo,
  BranchInfo,
  WorkingChanges,
  GitAnalyzerOptions
} from './lib/git-analyzer';

export type {
  TestManagerOptions,
  TestResult
} from './lib/test-manager';

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  BASE_URL: 'https://api.debugg.ai',
  TEST_OUTPUT_DIR: 'tests/debugg-ai',
  SERVER_TIMEOUT: 30000,
  MAX_TEST_WAIT_TIME: 600000,
  POLL_INTERVAL: 5000,
  DEFAULT_SERVER_PORT: 3000,
  DEFAULT_SERVER_WAIT_TIME: 60000
} as const;

/**
 * Environment variable names used by the CLI
 */
export const ENV_VARS = {
  API_KEY: 'DEBUGGAI_API_KEY',
  BASE_URL: 'DEBUGGAI_BASE_URL',
  GITHUB_SHA: 'GITHUB_SHA',
  GITHUB_REF_NAME: 'GITHUB_REF_NAME',
  GITHUB_HEAD_REF: 'GITHUB_HEAD_REF'
} as const;

/**
 * Quick start function for programmatic usage
 */
export async function runDebuggAITests(options: {
  apiKey: string;
  repoPath?: string;
  baseUrl?: string;
  testOutputDir?: string;
  waitForServer?: boolean;
  serverPort?: number;
  maxTestWaitTime?: number;
}): Promise<{
  success: boolean;
  suiteUuid?: string;
  testFiles?: string[];
  error?: string;
}> {
  const { TestManager } = await import('./lib/test-manager');
  
  const testManager = new TestManager({
    apiKey: options.apiKey,
    repoPath: options.repoPath || process.cwd(),
    baseUrl: options.baseUrl || 'https://api.debugg.ai',
    testOutputDir: options.testOutputDir || 'tests/debugg-ai',
    maxTestWaitTime: options.maxTestWaitTime || 600000
  });

  // Wait for server if requested
  if (options.waitForServer) {
    const serverReady = await testManager.waitForServer(
      options.serverPort || DEFAULT_CONFIG.DEFAULT_SERVER_PORT,
      DEFAULT_CONFIG.DEFAULT_SERVER_WAIT_TIME
    );
    
    if (!serverReady) {
      return {
        success: false,
        error: `Server on port ${options.serverPort || DEFAULT_CONFIG.DEFAULT_SERVER_PORT} did not start in time`
      };
    }
  }

  // Run tests
  const result = await testManager.runCommitTests();
  
  const response: {
    success: boolean;
    suiteUuid?: string;
    testFiles?: string[];
    error?: string;
  } = {
    success: result.success
  };
  
  if (result.suiteUuid) {
    response.suiteUuid = result.suiteUuid;
  }
  if (result.testFiles) {
    response.testFiles = result.testFiles;
  }
  if (result.error) {
    response.error = result.error;
  }
  
  return response;
}