#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs-extra';
import { config } from 'dotenv';
import { TestManager } from './lib/test-manager';
import { WorkflowOrchestrator } from './lib/workflow-orchestrator';

// Load environment variables
config();

const program = new Command();

program
  .name('@debugg-ai/cli')
  .description('CLI tool for running DebuggAI tests in CI/CD environments')
  .version('1.0.0');

program
  .command('test')
  .description('Run E2E tests based on git changes')
  .option('-k, --api-key <key>', 'DebuggAI API key (can also use DEBUGGAI_API_KEY env var)')
  .option('-u, --base-url <url>', 'API base URL (default: https://api.debugg.ai)')
  .option('-r, --repo-path <path>', 'Repository path (default: current directory)')
  .option('-o, --output-dir <dir>', 'Test output directory (default: tests/debugg-ai)')
  .option('--wait-for-server', 'Wait for local development server to be ready')
  .option('--server-port <port>', 'Local server port to wait for (default: 3000)', '3000')
  .option('--server-timeout <ms>', 'Server wait timeout in milliseconds (default: 60000)', '60000')
  .option('--max-test-time <ms>', 'Maximum test wait time in milliseconds (default: 600000)', '600000')
  .option('--no-color', 'Disable colored output')
  .action(async (options) => {
    try {
      // Disable colors if requested
      if (options.noColor) {
        chalk.level = 0;
      }

      console.log(chalk.blue.bold('DebuggAI Test Runner'));
      console.log(chalk.gray('='.repeat(50)));

      // Get API key
      const apiKey = options.apiKey || process.env.DEBUGGAI_API_KEY;
      if (!apiKey) {
        console.error(chalk.red('Error: API key is required. Provide it via --api-key or DEBUGGAI_API_KEY environment variable.'));
        process.exit(1);
      }

      // Get repository path
      const repoPath = options.repoPath ? path.resolve(options.repoPath) : process.cwd();
      
      // Validate repository path exists
      if (!await fs.pathExists(repoPath)) {
        console.error(chalk.red(`Error: Repository path does not exist: ${repoPath}`));
        process.exit(1);
      }

      // Validate it's a git repository
      const gitDir = path.join(repoPath, '.git');
      if (!await fs.pathExists(gitDir)) {
        console.error(chalk.red(`Error: Not a git repository: ${repoPath}`));
        process.exit(1);
      }

      console.log(chalk.gray(`Repository: ${repoPath}`));
      console.log(chalk.gray(`API Key: ${apiKey.substring(0, 8)}...`));

      // Initialize test manager (after all validations pass)
      const testManager = new TestManager({
        apiKey,
        repoPath,
        baseUrl: options.baseUrl,
        testOutputDir: options.outputDir,
        serverTimeout: parseInt(options.serverTimeout) || 60000,
        maxTestWaitTime: parseInt(options.maxTestTime) || 600000
      });

      // Wait for server if requested
      if (options.waitForServer) {
        const serverPort = parseInt(options.serverPort);
        const serverTimeout = parseInt(options.serverTimeout) || 60000;
        
        console.log(chalk.blue(`\nWaiting for development server on port ${serverPort}...`));
        
        const serverReady = await testManager.waitForServer(serverPort, serverTimeout);
        if (!serverReady) {
          console.error(chalk.red(`Server on port ${serverPort} did not start within ${serverTimeout}ms`));
          process.exit(1);
        }
      }

      // Run the tests
      console.log(chalk.blue('\nStarting test analysis and generation...'));
      const result = await testManager.runCommitTests();

      if (result.success) {
        console.log(chalk.green('\n✅ Tests completed successfully!'));
        
        if (result.testFiles && result.testFiles.length > 0) {
          console.log(chalk.blue('\nGenerated test files:'));
          for (const file of result.testFiles) {
            console.log(chalk.gray(`  • ${path.relative(repoPath, file)}`));
          }
        }

        console.log(chalk.blue(`\nTest suite ID: ${result.suiteUuid}`));
        process.exit(0);
      } else {
        console.error(chalk.red(`\n❌ Tests failed: ${result.error}`));
        process.exit(1);
      }

    } catch (error) {
      // Re-throw test exit errors to prevent them from being handled
      if (error instanceof Error && (error as any).isSuccessExit) {
        throw error;
      }
      
      console.error(chalk.red('\n💥 Unexpected error:'));
      console.error(error instanceof Error ? error.message : String(error));
      
      if (process.env.DEBUG) {
        console.error('\nStack trace:');
        console.error(error);
      }
      
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check the status of a test suite')
  .requiredOption('-s, --suite-id <id>', 'Test suite UUID')
  .option('-k, --api-key <key>', 'DebuggAI API key (can also use DEBUGGAI_API_KEY env var)')
  .option('-u, --base-url <url>', 'API base URL (default: https://api.debugg.ai)')
  .option('--no-color', 'Disable colored output')
  .action(async (options) => {
    try {
      // Disable colors if requested
      if (options.noColor) {
        chalk.level = 0;
      }

      console.log(chalk.blue.bold('DebuggAI Test Status'));
      console.log(chalk.gray('='.repeat(50)));

      // Get API key
      const apiKey = options.apiKey || process.env.DEBUGGAI_API_KEY;
      if (!apiKey) {
        console.error(chalk.red('Error: API key is required.'));
        process.exit(1);
      }

      // Create a basic test manager just for API access
      const testManager = new TestManager({
        apiKey,
        repoPath: process.cwd(), // Not used for status check
        baseUrl: options.baseUrl
      });

      // Get test suite status
      const suite = await (testManager as any).client.getTestSuiteStatus(options.suiteId);
      
      if (!suite) {
        console.error(chalk.red(`Test suite not found: ${options.suiteId}`));
        process.exit(1);
      }

      console.log(chalk.blue(`Suite ID: ${suite.uuid}`));
      console.log(chalk.blue(`Name: ${suite.name || 'Unnamed'}`));
      console.log(chalk.blue(`Status: ${getStatusColor(suite.status || 'unknown')}`));
      console.log(chalk.blue(`Tests: ${suite.tests?.length || 0}`));

      if (suite.tests && suite.tests.length > 0) {
        console.log('\n' + chalk.bold('Test Details:'));
        for (const test of suite.tests) {
          const status = test.curRun?.status || 'unknown';
          console.log(`  • ${test.name || test.uuid}: ${getStatusColor(status)}`);
        }
      }

    } catch (error) {
      // Re-throw test exit errors to prevent them from being handled
      if (error instanceof Error && (error as any).isSuccessExit) {
        throw error;
      }
      
      console.error(chalk.red('Error checking status:'));
      console.error(error instanceof Error ? error.message : String(error));
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
  .option('--no-color', 'Disable colored output')
  .action(async (options) => {
    try {
      // Disable colors if requested
      if (options.noColor) {
        chalk.level = 0;
      }

      console.log(chalk.blue.bold('DebuggAI Test Suites'));
      console.log(chalk.gray('='.repeat(50)));

      // Get API key
      const apiKey = options.apiKey || process.env.DEBUGGAI_API_KEY;
      if (!apiKey) {
        console.error(chalk.red('Error: API key is required.'));
        process.exit(1);
      }

      // Create a basic test manager just for API access
      const testManager = new TestManager({
        apiKey,
        repoPath: process.cwd(), // Not used for listing
        baseUrl: options.baseUrl
      });

      // List test suites
      const result = await (testManager as any).client.listTestSuites({
        repoName: options.repo,
        branchName: options.branch,
        limit: parseInt(options.limit),
        page: parseInt(options.page)
      });

      if (result.suites.length === 0) {
        console.log(chalk.yellow('No test suites found.'));
        return;
      }

      console.log(chalk.blue(`Found ${result.total} test suites (showing ${result.suites.length}):\n`));

      for (const suite of result.suites) {
        console.log(`${chalk.bold(suite.name || suite.uuid)}`);
        console.log(`  Status: ${getStatusColor(suite.status || 'unknown')}`);
        console.log(`  Tests: ${suite.tests?.length || 0}`);
        console.log(`  UUID: ${chalk.gray(suite.uuid)}`);
        console.log('');
      }

    } catch (error) {
      // Re-throw test exit errors to prevent them from being handled
      if (error instanceof Error && (error as any).isSuccessExit) {
        throw error;
      }
      
      console.error(chalk.red('Error listing test suites:'));
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

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
  .option('--verbose', 'Verbose logging')
  .option('--no-color', 'Disable colored output')
  .action(async (options) => {
    try {
      // Disable colors if requested
      if (options.noColor) {
        chalk.level = 0;
      }

      console.log(chalk.blue.bold('DebuggAI Workflow Runner'));
      console.log(chalk.gray('='.repeat(50)));

      // Get API key
      const apiKey = options.apiKey || process.env.DEBUGGAI_API_KEY;
      if (!apiKey) {
        console.error(chalk.red('Error: API key is required. Provide it via --api-key or DEBUGGAI_API_KEY environment variable.'));
        process.exit(1);
      }

      // Get repository path
      const repoPath = options.repoPath ? path.resolve(options.repoPath) : process.cwd();
      
      // Validate repository path exists
      if (!await fs.pathExists(repoPath)) {
        console.error(chalk.red(`Error: Repository path does not exist: ${repoPath}`));
        process.exit(1);
      }

      // Validate it's a git repository
      const gitDir = path.join(repoPath, '.git');
      if (!await fs.pathExists(gitDir)) {
        console.error(chalk.red(`Error: Not a git repository: ${repoPath}`));
        process.exit(1);
      }

      console.log(chalk.gray(`Repository: ${repoPath}`));
      console.log(chalk.gray(`API Key: ${apiKey.substring(0, 8)}...`));

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

      // Initialize workflow orchestrator
      const orchestrator = new WorkflowOrchestrator({
        ngrokAuthToken: options.ngrokToken || process.env.NGROK_AUTH_TOKEN,
        baseDomain: options.baseDomain,
        verbose: options.verbose
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
          maxTestWaitTime: parseInt(options.maxTestTime)
        },
        cleanup: {
          onSuccess: options.cleanupOnSuccess,
          onError: options.cleanupOnError
        }
      };

      console.log(chalk.blue('\nStarting complete testing workflow...'));
      const result = await orchestrator.executeWorkflow(workflowConfig);

      if (result.success) {
        console.log(chalk.green('\n✅ Workflow completed successfully!'));
        
        if (result.tunnelInfo) {
          console.log(chalk.blue(`Tunnel URL: ${result.tunnelInfo.url}`));
        }
        
        if (result.serverUrl) {
          console.log(chalk.blue(`Local Server: ${result.serverUrl}`));
        }

        if (result.testResult?.testFiles && result.testResult.testFiles.length > 0) {
          console.log(chalk.blue('\nGenerated test files:'));
          for (const file of result.testResult.testFiles) {
            console.log(chalk.gray(`  • ${path.relative(repoPath, file)}`));
          }
        }

        if (result.testResult?.suiteUuid) {
          console.log(chalk.blue(`\nTest suite ID: ${result.testResult.suiteUuid}`));
        }
        
        process.exit(0);
      } else {
        console.error(chalk.red(`\n❌ Workflow failed: ${result.error}`));
        process.exit(1);
      }

    } catch (error) {
      // Re-throw test exit errors to prevent them from being handled
      if (error instanceof Error && (error as any).isSuccessExit) {
        throw error;
      }
      
      console.error(chalk.red('\n💥 Unexpected workflow error:'));
      console.error(error instanceof Error ? error.message : String(error));
      
      if (process.env.DEBUG) {
        console.error('\nStack trace:');
        console.error(error);
      }
      
      process.exit(1);
    }
  });

/**
 * Get colored status text
 */
function getStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return chalk.green('✓ COMPLETED');
    case 'failed':
      return chalk.red('✗ FAILED');
    case 'running':
      return chalk.yellow('⏳ RUNNING');
    case 'pending':
      return chalk.blue('⏸ PENDING');
    default:
      return chalk.gray('❓ UNKNOWN');
  }
}

// Handle unhandled promise rejections and uncaught exceptions
// Only add these handlers if we're not in a test environment
if (process.env.NODE_ENV !== 'test') {
  process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    console.error(chalk.red('Uncaught Exception:'), error);
    process.exit(1);
  });
}

// Parse command line arguments
program.parse();