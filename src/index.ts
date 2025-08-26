/**
 * @debugg-ai/cli - CLI tool for running DebuggAI tests in CI/CD environments
 * 
 * This module provides programmatic access to the DebuggAI testing functionality.
 * For CLI usage, use the `debugg-ai` command after installing the package.
 */

export { DebuggAIClient } from './lib/api-client';
export { GitAnalyzer } from './lib/git-analyzer';
export { TestManager } from './lib/test-manager';
export { TunnelManager } from './lib/tunnel-manager';
export { ServerManager } from './lib/server-manager';
export { WorkflowOrchestrator } from './lib/workflow-orchestrator';

export type {
  E2eTest,
  E2eTestSuite,
  CommitTestRequest,
  CommitTestResponse,
  ApiClientConfig
} from './lib/api-client';

// Add missing Chunk interface for backend compatibility
export interface Chunk {
  startLine: number;
  endLine: number;
  contents: string;
  filePath?: string;
}

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

export type {
  TunnelConfig,
  TunnelInfo,
  TunnelManagerOptions
} from './lib/tunnel-manager';

export type {
  ServerConfig,
  ServerStatus,
  ServerManagerOptions
} from './lib/server-manager';

export type {
  WorkflowConfig,
  WorkflowResult,
  WorkflowOptions
} from './lib/workflow-orchestrator';

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
  GITHUB_HEAD_REF: 'GITHUB_HEAD_REF',
  NGROK_AUTH_TOKEN: 'NGROK_AUTH_TOKEN'
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

/**
 * Execute complete workflow with server management and tunnel setup
 */
export async function runWorkflow(options: {
  apiKey: string;
  repoPath?: string;
  baseUrl?: string;
  testOutputDir?: string;
  serverCommand?: string;
  serverArgs?: string[];
  serverPort?: number;
  ngrokAuthToken?: string;
  ngrokSubdomain?: string;
  ngrokDomain?: string;
  baseDomain?: string;
  maxTestWaitTime?: number;
  serverTimeout?: number;
  cleanup?: boolean;
  verbose?: boolean;
}): Promise<{
  success: boolean;
  tunnelUrl?: string;
  serverUrl?: string;
  suiteUuid?: string;
  testFiles?: string[];
  error?: string;
}> {
  const { WorkflowOrchestrator } = await import('./lib/workflow-orchestrator');
  
  const orchestrator = new WorkflowOrchestrator({
    ngrokAuthToken: options.ngrokAuthToken || undefined,
    baseDomain: options.baseDomain || undefined,
    verbose: options.verbose || undefined
  });

  const workflowConfig = {
    server: {
      command: options.serverCommand || 'npm',
      args: options.serverArgs || ['start'],
      port: options.serverPort || DEFAULT_CONFIG.DEFAULT_SERVER_PORT,
      cwd: options.repoPath || process.cwd(),
      startupTimeout: options.serverTimeout || DEFAULT_CONFIG.DEFAULT_SERVER_WAIT_TIME
    },
    tunnel: {
      port: options.serverPort || DEFAULT_CONFIG.DEFAULT_SERVER_PORT,
      subdomain: options.ngrokSubdomain || undefined,
      customDomain: options.ngrokDomain || undefined,
      authtoken: options.ngrokAuthToken || undefined
    },
    test: {
      apiKey: options.apiKey,
      baseUrl: options.baseUrl || DEFAULT_CONFIG.BASE_URL,
      repoPath: options.repoPath || process.cwd(),
      testOutputDir: options.testOutputDir || DEFAULT_CONFIG.TEST_OUTPUT_DIR,
      maxTestWaitTime: options.maxTestWaitTime || DEFAULT_CONFIG.MAX_TEST_WAIT_TIME
    },
    cleanup: {
      onSuccess: options.cleanup !== false,
      onError: options.cleanup !== false
    }
  };

  const result = await orchestrator.executeWorkflow(workflowConfig);
  
  const response: {
    success: boolean;
    tunnelUrl?: string;
    serverUrl?: string;
    suiteUuid?: string;
    testFiles?: string[];
    error?: string;
  } = {
    success: result.success
  };

  if (result.tunnelInfo?.url) {
    response.tunnelUrl = result.tunnelInfo.url;
  }
  if (result.serverUrl) {
    response.serverUrl = result.serverUrl;
  }
  if (result.testResult?.suiteUuid) {
    response.suiteUuid = result.testResult.suiteUuid;
  }
  if (result.testResult?.testFiles) {
    response.testFiles = result.testResult.testFiles;
  }
  if (result.error) {
    response.error = result.error;
  }

  return response;
}