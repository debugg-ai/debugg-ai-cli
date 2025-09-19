#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs-extra';
import { config } from 'dotenv';
import { E2EManager } from './lib/e2e-manager';
import { systemLogger } from './util/system-logger';
import { telemetry } from './services/telemetry';

// Load environment variables
config();

// Read version from package.json
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = fs.readJsonSync(packageJsonPath);
const version = packageJson.version;

const program = new Command();

program
  .name('@debugg-ai/cli')
  .description('CLI tool for running DebuggAI tests in CI/CD environments')
  .version(version);

program
  .command('test')
  .description('Run E2E tests based on git changes')
  .option('-k, --api-key <key>', 'DebuggAI API key (can also use DEBUGGAI_API_KEY env var)')
  .option('-u, --base-url <url>', 'API base URL (default: https://api.debugg.ai)')
  .option('-r, --repo-path <path>', 'Repository path (default: current directory)')
  .option('-o, --output-dir <dir>', 'Test output directory (default: tests/debugg-ai)')
  .option('-c, --commit <hash>', 'Specific commit hash to analyze (instead of working changes)')
  .option('--commit-range <range>', 'Commit range to analyze (e.g., HEAD~3..HEAD, main..feature-branch)')
  .option('--since <date>', 'Analyze commits since date/time (e.g., "2024-01-01", "2 days ago")')
  .option('--last <number>', 'Analyze last N commits (e.g., --last 3)')
  .option('--pr <number>', 'PR number for GitHub App-based testing (requires GitHub App integration)')
  .option('--pr-sequence', 'Enable PR commit sequence testing (sends individual test requests for each commit in PR)')
  .option('--base-branch <branch>', 'Base branch for PR testing (auto-detected from GitHub env if not provided)')
  .option('--head-branch <branch>', 'Head branch for PR testing (auto-detected from GitHub env if not provided)')
  .option('--wait-for-server', 'Wait for local development server to be ready')
  .option('--server-port <port>', 'Local server port to test', '3000')
  .option('--server-timeout <ms>', 'Server wait timeout in milliseconds (default: 60000)', '60000')
  .option('--max-test-time <ms>', 'Maximum test wait time in milliseconds (default: 600000)', '600000')
  .option('--download-artifacts', 'Download test artifacts (scripts, recordings, JSON results) to local filesystem')
  .option('-v, --verbose', 'Enable verbose logging for debugging')
  .option('--dev', 'Enable development logging (shows all technical details, tunnel info, API calls, git details, timing)')
  .option('--no-color', 'Disable colored output')
  .action(async (options) => {
    try {
      // Track command start
      telemetry.trackCommandStart('test', options);
      
      // Set up logging mode based on flags
      if (options.dev) {
        systemLogger.setDevMode(true);
        systemLogger.debug('Development mode enabled - showing all technical details');
      } else if (options.verbose) {
        systemLogger.setDevMode(true);
        systemLogger.debug('Verbose logging enabled');
      }
      
      // Disable colors if requested (now handled by loggers)
      if (options.noColor) {
        // Color handling is now managed by the logger system
      }

      systemLogger.info('DebuggAI Test Runner');
      if (!systemLogger.getDevMode()) {
        console.log('='.repeat(50));
      }

      // Get API key
      const apiKey = options.apiKey || process.env.DEBUGGAI_API_KEY;
      if (!apiKey) {
        systemLogger.error('API key is required. Provide it via --api-key or DEBUGGAI_API_KEY environment variable.');
        process.exit(1);
      }

      // Get repository path
      const repoPath = options.repoPath ? path.resolve(options.repoPath) : process.cwd();
      
      // Validate repository path exists
      if (!await fs.pathExists(repoPath)) {
        systemLogger.error(`Repository path does not exist: ${repoPath}`);
        process.exit(1);
      }

      // Validate it's a git repository
      const gitDir = path.join(repoPath, '.git');
      if (!await fs.pathExists(gitDir)) {
        systemLogger.error(`Not a git repository: ${repoPath}`);
        process.exit(1);
      }

      // Log configuration details for debugging
      const serverPort = parseInt(options.serverPort || '3000');

      systemLogger.debug('CLI configuration', {
        category: 'cli',
        details: {
          repoPath,
          apiKey: `${apiKey.substring(0, 8)}...`,
          serverPort: serverPort,
          waitForServer: options.waitForServer || false,
          baseUrl: options.baseUrl || 'https://api.debugg.ai'
        }
      } as any);

      // Log port usage
      systemLogger.info(`Server port: ${serverPort}`);
      if (options.waitForServer) {
        systemLogger.info(`Will wait for server on port ${serverPort} before creating tunnel`);
      }
      systemLogger.info(`Tunnel will forward port ${serverPort} to ngrok`);

      // Initialize E2E manager (after all validations pass)
      const e2eManager = new E2EManager({
        apiKey,
        repoPath,
        baseUrl: options.baseUrl,
        ...(options.outputDir && { testOutputDir: options.outputDir }),
        serverTimeout: parseInt(options.serverTimeout) || 60000,
        maxTestWaitTime: parseInt(options.maxTestTime) || 600000,
        downloadArtifacts: options.downloadArtifacts || false,
        // Server port is used for tunnel
        serverPort: serverPort,
        // Commit analysis options
        commit: options.commit,
        commitRange: options.commitRange,
        since: options.since,
        ...(options.last && { last: parseInt(options.last) }),
        // PR sequence options
        prSequence: options.prSequence || false,
        baseBranch: options.baseBranch,
        headBranch: options.headBranch,
        // GitHub App PR testing
        ...(options.pr && { pr: parseInt(options.pr) })
      });

      // Wait for server if requested
      if (options.waitForServer) {
        const serverTimeout = parseInt(options.serverTimeout) || 60000;
        
        systemLogger.debug('Waiting for development server', { 
          category: 'server',
          details: { port: serverPort, timeout: serverTimeout } 
        } as any);
        
        if (systemLogger.getDevMode()) {
          systemLogger.debug(`Waiting for development server on port ${serverPort}`, { category: 'server' } as any);
        } else {
          (systemLogger.progress as any).start(`Waiting for development server on port ${serverPort}`);
        }
        
        const serverReady = await e2eManager.waitForServer(serverPort, serverTimeout);
        if (!serverReady) {
          systemLogger.error(`Server on port ${serverPort} did not start within ${serverTimeout}ms`);
          process.exit(1);
        }
      }

      // Run the tests
      if (systemLogger.getDevMode()) {
        systemLogger.debug('Starting test analysis and generation', { category: 'test' } as any);
      } else {
        (systemLogger.progress as any).start('Starting test analysis and generation');
      }
      const result = await e2eManager.runCommitTests();

      if (result.success) {
        systemLogger.success('Tests completed successfully!');
        
        if (result.testFiles && result.testFiles.length > 0) {
          systemLogger.displayFileList(result.testFiles, repoPath);
        }

        systemLogger.info(`Test suite ID: ${result.suiteUuid}`);

        // Check if any tests failed (process.exitCode may have been set by reportResults)
        if (process.exitCode === 1) {
          systemLogger.error('Some tests failed - see results above.');
          process.exit(1);
        } else {
          systemLogger.success('All tests completed successfully!');
          process.exit(0);
        }
      } else {
        systemLogger.error(`Tests failed: ${result.error}`);
        process.exit(1);
      }

    } catch (error) {
      // Re-throw test exit errors to prevent them from being handled
      if (error instanceof Error && (error as any).isSuccessExit) {
        throw error;
      }
      
      const errorMsg = error instanceof Error ? error.message : String(error);
      systemLogger.error('Unexpected error: ' + errorMsg);
      
      if (process.env.DEBUG) {
        systemLogger.error('Stack trace: ' + (error as any)?.stack);
      }
      
      telemetry.trackCommandComplete('test', false, errorMsg);
      await telemetry.shutdown();
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check the status of a test suite')
  .requiredOption('-s, --suite-id <id>', 'Test suite UUID')
  .option('-k, --api-key <key>', 'DebuggAI API key (can also use DEBUGGAI_API_KEY env var)')
  .option('-u, --base-url <url>', 'API base URL (default: https://api.debugg.ai)')
  .option('--dev', 'Enable development logging (shows all technical details)')
  .option('--no-color', 'Disable colored output')
  .action(async (options) => {
    try {
      // Track command start
      telemetry.trackCommandStart('status', options);
      
      // Set up development mode
      if (options.dev) {
        process.env.DEBUGGAI_LOG_LEVEL = 'DEBUG';
        process.env.DEBUGGAI_DEV_MODE = 'true';
        systemLogger.debug('Development mode enabled');
      }
      
      // Disable colors if requested (now handled by loggers)
      if (options.noColor) {
        // Color handling is now managed by the logger system
      }

      systemLogger.info('DebuggAI Test Status');
      console.log('='.repeat(50));

      // Get API key
      const apiKey = options.apiKey || process.env.DEBUGGAI_API_KEY;
      if (!apiKey) {
        systemLogger.error('API key is required.');
        process.exit(1);
      }

      // Create a basic test manager just for API access
      const e2eManager = new E2EManager({
        apiKey,
        repoPath: process.cwd(), // Not used for status check
        baseUrl: options.baseUrl
      });

      // Get test suite status
      const suite = await (e2eManager as any).client.getCommitTestSuiteStatus(options.suiteId);
      
      if (!suite) {
        systemLogger.error(`Test suite not found: ${options.suiteId}`);
        process.exit(1);
      }

      systemLogger.info(`Suite ID: ${suite.uuid}`);
      systemLogger.info(`Name: ${suite.name || 'Unnamed'}`);
      systemLogger.info(`Status: ${getStatusColor(suite.status || 'unknown')}`);
      systemLogger.info(`Tests: ${suite.tests?.length || 0}`);

      if (suite.tests && suite.tests.length > 0) {
        systemLogger.info('\nTest Details:');
        for (const test of suite.tests) {
          const status = test.curRun?.status || 'unknown';
          console.log(`  • ${test.name || test.uuid}: ${getStatusColor(status)}`);
        }
      }
      
      // Track successful completion
      telemetry.trackCommandComplete('status', true);
      await telemetry.shutdown();

    } catch (error) {
      // Re-throw test exit errors to prevent them from being handled
      if (error instanceof Error && (error as any).isSuccessExit) {
        throw error;
      }
      
      const errorMsg = error instanceof Error ? error.message : String(error);
      systemLogger.error('Error checking status: ' + errorMsg);
      telemetry.trackCommandComplete('status', false, errorMsg);
      await telemetry.shutdown();
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List test suites for a repository')
  .option('-k, --api-key <key>', 'DebuggAI API key (can also use DEBUGGAI_API_KEY env var)')
  .option('-u, --base-url <url>', 'API base URL (default: https://api.debugg.ai)')
  .option('-r, --repo <name>', 'Repository name filter')
  .option('-b, --branch <name>', 'Branch name filter')
  .option('-l, --limit <number>', 'Limit number of results (default: 20)', '20')
  .option('-p, --page <number>', 'Page number (default: 1)', '1')
  .option('--dev', 'Enable development logging (shows all technical details)')
  .option('--no-color', 'Disable colored output')
  .action(async (options) => {
    try {
      // Track command start
      telemetry.trackCommandStart('list', options);
      
      // Set up development mode
      if (options.dev) {
        process.env.DEBUGGAI_LOG_LEVEL = 'DEBUG';
        process.env.DEBUGGAI_DEV_MODE = 'true';
        systemLogger.debug('Development mode enabled');
      }
      
      // Disable colors if requested (now handled by loggers)
      if (options.noColor) {
        // Color handling is now managed by the logger system
      }

      systemLogger.info('DebuggAI Test Suites');
      console.log('='.repeat(50));

      // Get API key
      const apiKey = options.apiKey || process.env.DEBUGGAI_API_KEY;
      if (!apiKey) {
        systemLogger.error('API key is required.');
        process.exit(1);
      }

      // Create a basic test manager just for API access
      const e2eManager = new E2EManager({
        apiKey,
        repoPath: process.cwd(), // Not used for listing
        baseUrl: options.baseUrl
      });

      // List test suites
      const result = await (e2eManager as any).client.listTestSuites({
        repoName: options.repo,
        branchName: options.branch,
        limit: parseInt(options.limit),
        page: parseInt(options.page)
      });

      if (result.suites.length === 0) {
        systemLogger.warn('No test suites found.');
        return;
      }

      systemLogger.info(`Found ${result.total} test suites (showing ${result.suites.length}):`); console.log('');

      for (const suite of result.suites) {
        console.log(`${suite.name || suite.uuid}`);
        console.log(`  Status: ${getStatusColor(suite.status || 'unknown')}`);
        console.log(`  Tests: ${suite.tests?.length || 0}`);
        console.log(`  UUID: ${suite.uuid}`);
        console.log('');
      }
      
      // Track successful completion
      telemetry.trackCommandComplete('list', true);
      await telemetry.shutdown();

    } catch (error) {
      // Re-throw test exit errors to prevent them from being handled
      if (error instanceof Error && (error as any).isSuccessExit) {
        throw error;
      }
      
      const errorMsg = error instanceof Error ? error.message : String(error);
      systemLogger.error('Error listing test suites: ' + errorMsg);
      telemetry.trackCommandComplete('list', false, errorMsg);
      await telemetry.shutdown();
      process.exit(1);
    }
  });

// Workflow command - temporarily disabled during refactoring
// TODO: Re-implement workflow command with new architecture
/*
program
  .command('workflow')
  .description('Run complete E2E testing workflow with server management and tunnel setup')
  .option('-k, --api-key <key>', 'DebuggAI API key (can also use DEBUGGAI_API_KEY env var)')
  .option('-u, --base-url <url>', 'API base URL (default: https://api.debugg.ai)')
  .option('-r, --repo-path <path>', 'Repository path (default: current directory)')
  .option('-o, --output-dir <dir>', 'Test output directory (default: tests/debugg-ai)')
  .option('-p, --port <port>', 'Server port (default: 3000)', '3000')
  .option('-c, --command <cmd>', 'Server start command (default: npm start)', 'npm start')
  .option('--server-args <args>', 'Server command arguments (comma-separated)')
  .option('--server-cwd <path>', 'Server working directory')
  .option('--server-env <env>', 'Server environment variables (KEY=value,KEY2=value2)')
  .option('--ngrok-token <token>', 'Ngrok auth token (can also use NGROK_AUTH_TOKEN env var)')
  .option('--ngrok-subdomain <subdomain>', 'Custom ngrok subdomain')
  .option('--ngrok-domain <domain>', 'Custom ngrok domain')
  .option('--base-domain <domain>', 'Base domain for tunnels (default: ngrok.debugg.ai)')
  .option('--max-test-time <ms>', 'Maximum test wait time in milliseconds (default: 600000)', '600000')
  .option('--server-timeout <ms>', 'Server startup timeout in milliseconds (default: 60000)', '60000')
  .option('--cleanup-on-success', 'Cleanup resources after successful completion (default: true)', true)
  .option('--cleanup-on-error', 'Cleanup resources after errors (default: true)', true)
  .option('--download-artifacts', 'Download test artifacts (scripts, recordings, JSON results) to local filesystem')
  .option('--pr-sequence', 'Enable PR commit sequence testing (sends individual test requests for each commit in PR)')
  .option('--base-branch <branch>', 'Base branch for PR testing (auto-detected from GitHub env if not provided)')
  .option('--head-branch <branch>', 'Head branch for PR testing (auto-detected from GitHub env if not provided)')
  .option('--verbose', 'Verbose logging')
  .option('--dev', 'Enable development logging (shows all technical details, server logs, tunnel info)')
  .option('--no-color', 'Disable colored output')
  .action(async (options) => {
    try {
      // Set up development mode
      if (options.dev) {
        process.env.DEBUGGAI_LOG_LEVEL = 'DEBUG';
        process.env.DEBUGGAI_DEV_MODE = 'true';
        systemLogger.debug('Development mode enabled');
      }
      
      // Disable colors if requested (now handled by loggers)
      if (options.noColor) {
        // Color handling is now managed by the logger system
      }

      systemLogger.info('DebuggAI Workflow Runner');
      console.log('='.repeat(50));

      // Get API key
      const apiKey = options.apiKey || process.env.DEBUGGAI_API_KEY;
      if (!apiKey) {
        systemLogger.error('API key is required. Provide it via --api-key or DEBUGGAI_API_KEY environment variable.');
        process.exit(1);
      }

      // Get repository path
      const repoPath = options.repoPath ? path.resolve(options.repoPath) : process.cwd();
      
      // Validate repository path exists
      if (!await fs.pathExists(repoPath)) {
        systemLogger.error(`Repository path does not exist: ${repoPath}`);
        process.exit(1);
      }

      // Validate it's a git repository
      const gitDir = path.join(repoPath, '.git');
      if (!await fs.pathExists(gitDir)) {
        systemLogger.error(`Not a git repository: ${repoPath}`);
        process.exit(1);
      }

      systemLogger.debug('Workflow configuration', { 
        category: 'workflow',
        details: { repoPath, apiKey: `${apiKey.substring(0, 8)}...` } 
      } as any);

      // Parse server command and args
      const [command, ...defaultArgs] = options.command.split(' ');
      const serverArgs = options.serverArgs 
        ? options.serverArgs.split(',').map((arg: string) => arg.trim())
        : defaultArgs;

      // Parse environment variables
      const serverEnv: Record<string, string> = {};
      if (options.serverEnv) {
        options.serverEnv.split(',').forEach((pair: string) => {
          const [key, value] = pair.trim().split('=');
          if (key && value) {
            serverEnv[key] = value;
          }
        });
      }

      // Generate a tunnel key for backend to create tunnel endpoints
      const tunnelKey = randomUUID();
      systemLogger.debug('Generated tunnel key for workflow', { 
        category: 'tunnel',
        details: { key: tunnelKey.substring(0, 8) + '...' } 
      } as any);

      // Initialize workflow orchestrator
      const orchestrator = new WorkflowOrchestrator({
        ngrokAuthToken: options.ngrokToken || process.env.NGROK_AUTH_TOKEN,
        baseDomain: options.baseDomain,
        verbose: options.verbose || options.dev,  // Dev mode implies verbose
        devMode: options.dev
      });

      // Configure workflow
      const workflowConfig = {
        server: {
          command,
          args: serverArgs,
          port: parseInt(options.port),
          cwd: options.serverCwd || repoPath,
          env: serverEnv,
          startupTimeout: parseInt(options.serverTimeout)
        },
        tunnel: {
          port: parseInt(options.port),
          subdomain: options.ngrokSubdomain,
          customDomain: options.ngrokDomain,
          authtoken: options.ngrokToken || process.env.NGROK_AUTH_TOKEN
        },
        test: {
          apiKey,
          baseUrl: options.baseUrl,
          repoPath,
          testOutputDir: options.outputDir,
          maxTestWaitTime: parseInt(options.maxTestTime),
          downloadArtifacts: options.downloadArtifacts || false,
          tunnelKey, // Add the generated tunnel key
          createTunnel: true, // Enable tunnel creation
          tunnelPort: parseInt(options.port) || 3000, // Use server port for tunnel
          // PR sequence options
          prSequence: options.prSequence || false,
          baseBranch: options.baseBranch,
          headBranch: options.headBranch,
          // GitHub App PR testing
          ...(options.pr && { pr: parseInt(options.pr) })
        },
        cleanup: {
          onSuccess: options.cleanupOnSuccess,
          onError: options.cleanupOnError
        }
      };

      systemLogger.debug('Starting workflow orchestrator');
      (systemLogger.progress as any).start('Starting complete testing workflow');
      const result = await orchestrator.executeWorkflow(workflowConfig);

      if (result.success) {
        systemLogger.success('Workflow completed successfully!');
        
        if (result.tunnelInfo) {
          systemLogger.info(`Tunnel URL: ${result.tunnelInfo.url}`);
        }
        
        if (result.serverUrl) {
          systemLogger.info(`Local Server: ${result.serverUrl}`);
        }

        if (result.testResult?.testFiles && result.testResult.testFiles.length > 0) {
          systemLogger.displayFileList(result.testResult.testFiles, repoPath);
        }

        if (result.testResult?.suiteUuid) {
          systemLogger.info(`Test suite ID: ${result.testResult.suiteUuid}`);
        }
        
        // Check if any tests failed (process.exitCode may have been set by reportResults)
        if (process.exitCode === 1) {
          systemLogger.error('Some tests failed - see results above');
          process.exit(1);
        } else {
          process.exit(0);
        }
      } else {
        systemLogger.error(`Workflow failed: ${result.error}`);
        process.exit(1);
      }

    } catch (error) {
      // Re-throw test exit errors to prevent them from being handled
      if (error instanceof Error && (error as any).isSuccessExit) {
        throw error;
      }
      
      systemLogger.error('Unexpected workflow error: ' + (error instanceof Error ? error.message : String(error)));
      
      if (process.env.DEBUG) {
        systemLogger.error('Stack trace: ' + (error as any)?.stack);
      }

      process.exit(1);
    }
  });
*/

/**
 * Get colored status text
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return '✓ COMPLETED';
    case 'failed':
      return '✗ FAILED';
    case 'running':
      return '⏳ RUNNING';
    case 'pending':
      return '⏸ PENDING';
    default:
      return '❓ UNKNOWN';
  }
}

// Handle unhandled promise rejections and uncaught exceptions
// Only add these handlers if we're not in a test environment
if (process.env.NODE_ENV !== 'test') {
  process.on('unhandledRejection', (reason, promise) => {
    systemLogger.error('Unhandled Rejection at: promise=' + promise + ', reason=' + reason);
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    systemLogger.error('Uncaught Exception: ' + error);
    process.exit(1);
  });
}

// Parse command line arguments
program.parse();