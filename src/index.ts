/**
 * @debugg-ai/cli - CLI tool for running DebuggAI tests in CI/CD environments
 * 
 * This module provides programmatic access to the DebuggAI testing functionality.
 * For CLI usage, use the `debugg-ai` command after installing the package.
 */

export { CLIBackendClient } from './backend/cli/client';
export { GitAnalyzer } from './lib/git-analyzer';
export { E2EManager } from './lib/e2e-manager';
export { ServerManager } from './lib/server-manager';

export type {
  CLIClientConfig
} from './backend/cli/client';

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
  GitAnalyzerOptions,
  PRCommitInfo,
  PRCommitSequence
} from './lib/git-analyzer';

export type {
  E2EManagerOptions,
  E2EResult,
  PRSequenceResult
} from './lib/e2e-manager';

// Note: TunnelInfo is now available from './services/ngrok/tunnelManager'
// export type { TunnelInfo } from './services/ngrok/tunnelManager';

export type {
  ServerConfig,
  ServerStatus,
  ServerManagerOptions
} from './lib/server-manager';


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
  downloadArtifacts?: boolean;
  prSequence?: boolean;
  baseBranch?: string;
  headBranch?: string;
}): Promise<{
  success: boolean;
  suiteUuid?: string;
  testFiles?: string[];
  error?: string;
}> {
  const { E2EManager } = await import('./lib/e2e-manager');

  const e2eManager = new E2EManager({
    apiKey: options.apiKey,
    repoPath: options.repoPath || process.cwd(),
    baseUrl: options.baseUrl || 'https://api.debugg.ai',
    testOutputDir: options.testOutputDir || 'tests/debugg-ai',
    maxTestWaitTime: options.maxTestWaitTime || 600000,
    downloadArtifacts: options.downloadArtifacts || false,
    prSequence: options.prSequence || false,
    baseBranch: options.baseBranch,
    headBranch: options.headBranch
  });

  // Wait for server if requested
  if (options.waitForServer) {
    const serverReady = await e2eManager.waitForServer(
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
  const result = await e2eManager.runCommitTests();
  
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

