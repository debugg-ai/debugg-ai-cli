/**
 * System-wide logging architecture for DebuggAI CLI
 * 
 * Provides two distinct logging modes:
 * 1. DevLogger: For --dev flag - sequential output with full technical details
 * 2. UserLogger: Default mode - clean spinner interface with minimal user-friendly messages
 * 
 * Usage:
 *   import { systemLogger } from '../util/system-logger';
 *   systemLogger.api.request('POST', '/test-suite');
 *   systemLogger.tunnel.connecting('localhost:3000');
 *   systemLogger.progress.start('Creating test suite...');
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';

export interface LogContext {
  timestamp?: boolean;
  category?: string;
  details?: Record<string, any>;
  truncate?: number;
}

export interface TunnelLogContext extends LogContext {
  port?: number;
  url?: string;
  uuid?: string;
  status?: 'connecting' | 'connected' | 'failed' | 'disconnected';
}

export interface ApiLogContext extends LogContext {
  method?: string;
  url?: string;
  status?: number;
  timing?: number;
  requestId?: string;
}

export interface GitLogContext extends LogContext {
  commitHash?: string;
  branch?: string;
  fileCount?: number;
  changeType?: 'working' | 'commit' | 'range';
}

export interface TestLogContext extends LogContext {
  suiteId?: string;
  testCount?: number;
  completed?: number;
  phase?: 'analyze' | 'create' | 'run' | 'download' | 'complete';
}

/**
 * Development Logger - Sequential output with full technical details
 * Used when --dev or --verbose flag is active
 */
class DevLogger {
  private formatTimestamp(): string {
    const now = new Date();
    return chalk.gray(`[${now.toISOString()}]`);
  }

  private formatMessage(level: string, category: string, message: string, context?: LogContext): string {
    const timestamp = this.formatTimestamp();
    const levelTag = this.getLevelTag(level);
    const categoryTag = chalk.cyan(`[${category.toUpperCase()}]`);
    
    let output = `${timestamp} ${levelTag} ${categoryTag} ${message}`;
    
    if (context?.details) {
      const details = this.truncateDetails(context.details, context.truncate);
      if (Object.keys(details).length > 0) {
        output += chalk.gray(` ${JSON.stringify(details)}`);
      }
    }
    
    return output;
  }

  private getLevelTag(level: string): string {
    switch (level) {
      case 'info': return chalk.blue('INFO');
      case 'success': return chalk.green('SUCCESS');
      case 'warn': return chalk.yellow('WARN');
      case 'error': return chalk.red('ERROR');
      case 'debug': return chalk.magenta('DEBUG');
      default: return chalk.white(level.toUpperCase());
    }
  }

  private truncateDetails(details: Record<string, any>, maxLength: number = 100): Record<string, any> {
    const result: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(details)) {
      if (value === null || value === undefined) continue;
      
      if (typeof value === 'string') {
        result[key] = value.length > maxLength ? `${value.substring(0, maxLength)}...` : value;
      } else if (Array.isArray(value)) {
        result[`${key}Count`] = value.length;
      } else if (typeof value === 'object') {
        result[`${key}Type`] = 'object';
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  private log(level: string, category: string, message: string, context?: LogContext): void {
    const formattedMessage = this.formatMessage(level, category, message, context);
    console.log(formattedMessage);
  }

  // General logging methods
  info(message: string, context?: LogContext): void {
    this.log('info', context?.category || 'general', message, context);
  }

  success(message: string, context?: LogContext): void {
    this.log('success', context?.category || 'general', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', context?.category || 'general', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', context?.category || 'general', message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', context?.category || 'general', message, context);
  }

  // Tunnel-specific logging
  tunnel = {
    connecting: (target: string, context?: TunnelLogContext) => {
      this.log('info', 'tunnel', `Connecting to ${target}`, {
        ...context,
        details: { target, status: 'connecting', ...context?.details }
      });
    },
    
    connected: (url: string, timing?: number, context?: TunnelLogContext) => {
      this.log('success', 'tunnel', `Tunnel established: ${url}`, {
        ...context,
        details: { url, timing: timing ? `${timing}ms` : undefined, status: 'connected', ...context?.details }
      });
    },
    
    failed: (target: string, error: string, timing?: number, context?: TunnelLogContext) => {
      this.log('error', 'tunnel', `Tunnel connection failed: ${target}`, {
        ...context,
        details: { target, error, timing: timing ? `${timing}ms` : undefined, status: 'failed', ...context?.details }
      });
    },
    
    disconnected: (url: string, timing?: number, context?: TunnelLogContext) => {
      this.log('info', 'tunnel', `Tunnel disconnected: ${url}`, {
        ...context,
        details: { url, timing: timing ? `${timing}ms` : undefined, status: 'disconnected', ...context?.details }
      });
    },
    
    status: (uuid: string, active: boolean, context?: TunnelLogContext) => {
      this.log('debug', 'tunnel', `Tunnel status check: ${uuid} - ${active ? 'active' : 'inactive'}`, {
        ...context,
        details: { uuid, active, ...context?.details }
      });
    }
  };

  // API-specific logging
  api = {
    request: (method: string, url: string, context?: ApiLogContext) => {
      this.log('info', 'api', `${method.toUpperCase()} ${url}`, {
        ...context,
        details: { method: method.toUpperCase(), url: this.truncateUrl(url), ...context?.details },
        truncate: 60
      });
    },
    
    response: (status: number, url: string, timing?: number, context?: ApiLogContext) => {
      const level = status >= 400 ? 'error' : status >= 300 ? 'warn' : 'info';
      this.log(level, 'api', `Response ${status} from ${this.truncateUrl(url)}`, {
        ...context,
        details: { status, url: this.truncateUrl(url), timing: timing ? `${timing}ms` : undefined, ...context?.details }
      });
    },
    
    error: (method: string, url: string, error: string, context?: ApiLogContext) => {
      this.log('error', 'api', `${method.toUpperCase()} ${this.truncateUrl(url)} failed`, {
        ...context,
        details: { method: method.toUpperCase(), url: this.truncateUrl(url), error, ...context?.details },
        truncate: 80
      });
    },
    
    auth: (success: boolean, userInfo?: string, context?: ApiLogContext) => {
      const message = success ? `Authentication successful: ${userInfo || 'user'}` : 'Authentication failed';
      this.log(success ? 'success' : 'error', 'api', message, {
        ...context,
        details: { success, userInfo, ...context?.details }
      });
    }
  };

  // Git-specific logging
  git = {
    analyzing: (type: 'working' | 'commit' | 'range', target: string, context?: GitLogContext) => {
      this.log('info', 'git', `Analyzing ${type} changes: ${target}`, {
        ...context,
        details: { changeType: type, target, ...context?.details }
      });
    },
    
    found: (fileCount: number, type: 'working' | 'commit' | 'range', context?: GitLogContext) => {
      this.log('info', 'git', `Found ${fileCount} changed files (${type})`, {
        ...context,
        details: { fileCount, changeType: type, ...context?.details }
      });
    },
    
    commit: (hash: string, message?: string, fileCount?: number, context?: GitLogContext) => {
      const shortHash = hash.substring(0, 8);
      const commitMsg = message ? ` - ${message.substring(0, 40)}${message.length > 40 ? '...' : ''}` : '';
      this.log('info', 'git', `Commit ${shortHash}${commitMsg}`, {
        ...context,
        details: { commitHash: shortHash, message, fileCount, ...context?.details }
      });
    },
    
    branch: (branch: string, context?: GitLogContext) => {
      this.log('debug', 'git', `Current branch: ${branch}`, {
        ...context,
        details: { branch, ...context?.details }
      });
    },
    
    error: (operation: string, error: string, context?: GitLogContext) => {
      this.log('error', 'git', `Git ${operation} failed`, {
        ...context,
        details: { operation, error, ...context?.details }
      });
    }
  };

  // Test-specific logging
  test = {
    phase: (phase: TestLogContext['phase'], message: string, context?: TestLogContext) => {
      this.log('info', 'test', `[${phase?.toUpperCase()}] ${message}`, {
        ...context,
        details: { phase, ...context?.details }
      });
    },
    
    suite: (action: 'creating' | 'created' | 'waiting' | 'completed', suiteId?: string, context?: TestLogContext) => {
      const message = `Test suite ${action}${suiteId ? `: ${suiteId}` : ''}`;
      this.log('info', 'test', message, {
        ...context,
        details: { action, suiteId, ...context?.details }
      });
    },
    
    progress: (completed: number, total: number, context?: TestLogContext) => {
      this.log('debug', 'test', `Test progress: ${completed}/${total} completed`, {
        ...context,
        details: { completed, total, ...context?.details }
      });
    },
    
    artifact: (type: 'script' | 'recording' | 'details', filename: string, success: boolean, context?: TestLogContext) => {
      const level = success ? 'info' : 'warn';
      const action = success ? 'Saved' : 'Failed to save';
      this.log(level, 'test', `${action} ${type}: ${filename}`, {
        ...context,
        details: { artifactType: type, filename, success, ...context?.details }
      });
    }
  };

  // Server/general progress logging
  progress = {
    server: (port: number, status: 'waiting' | 'ready' | 'timeout', timing?: number, context?: LogContext) => {
      const message = status === 'waiting' ? `Waiting for server on port ${port}` :
                     status === 'ready' ? `Server ready on port ${port}` :
                     `Server timeout on port ${port}`;
      const level = status === 'ready' ? 'success' : status === 'timeout' ? 'error' : 'info';
      this.log(level, 'server', message, {
        ...context,
        details: { port, status, timing: timing ? `${timing}ms` : undefined, ...context?.details }
      });
    }
  };

  private truncateUrl(url: string): string {
    return url.length > 60 ? url.substring(0, 60) + '...' : url;
  }
}

/**
 * User Logger - Clean spinner interface with minimal messages
 * Used in default mode for clean user experience
 */
class UserLogger {
  private spinner: Ora | null = null;
  private isQuiet: boolean = false;

  constructor() {
    // Check if we're in a non-TTY environment (CI/CD) or test mode
    this.isQuiet = !process.stdout.isTTY || process.env.NODE_ENV === 'test';
  }

  // Progress management with spinners
  progress = {
    start: (message: string): void => {
      if (this.isQuiet) {
        console.log(`⏳ ${message}`);
        return;
      }

      this.spinner?.stop();
      this.spinner = ora(message).start();
    },

    update: (message: string): void => {
      if (this.isQuiet) {
        console.log(`⏳ ${message}`);
        return;
      }

      if (this.spinner) {
        this.spinner.text = message;
      } else {
        this.spinner = ora(message).start();
      }
    },

    succeed: (message: string): void => {
      if (this.isQuiet) {
        console.log(`✅ ${message}`);
        return;
      }

      if (this.spinner) {
        this.spinner.succeed(message);
        this.spinner = null;
      } else {
        console.log(chalk.green(`✅ ${message}`));
      }
    },

    fail: (message: string): void => {
      if (this.isQuiet) {
        console.log(`❌ ${message}`);
        return;
      }

      if (this.spinner) {
        this.spinner.fail(message);
        this.spinner = null;
      } else {
        console.log(chalk.red(`❌ ${message}`));
      }
    },

    warn: (message: string): void => {
      if (this.isQuiet) {
        console.log(`⚠️  ${message}`);
        return;
      }

      if (this.spinner) {
        this.spinner.warn(message);
        this.spinner = null;
      } else {
        console.log(chalk.yellow(`⚠️  ${message}`));
      }
    },

    stop: (): void => {
      if (this.spinner) {
        this.spinner.stop();
        this.spinner = null;
      }
    }
  };

  // High-level user-friendly messages
  success(message: string): void {
    this.progress.stop();
    console.log(chalk.green(`✅ ${message}`));
  }

  error(message: string): void {
    this.progress.stop();
    console.log(chalk.red(`❌ ${message}`));
  }

  warn(message: string): void {
    this.progress.stop();
    console.log(chalk.yellow(`⚠️  ${message}`));
  }

  info(message: string): void {
    this.progress.stop();
    console.log(chalk.blue(`ℹ️  ${message}`));
  }

  // Specialized user-friendly messages
  tunnel = {
    connecting: (target: string) => {
      this.progress.start(`Creating tunnel to ${target}...`);
    },
    
    connected: (url: string) => {
      this.progress.succeed(`Tunnel connected: ${url}`);
    },
    
    failed: (target: string) => {
      this.progress.fail(`Failed to create tunnel to ${target}`);
    },
    
    disconnected: () => {
      this.info('Tunnel disconnected');
    }
  };

  api = {
    auth: (success: boolean, userInfo?: string) => {
      if (success) {
        this.info(`Authenticated as: ${userInfo || 'user'}`);
      } else {
        this.error('Authentication failed');
      }
    },
    
    request: (message: string) => {
      this.progress.update(message);
    }
  };

  git = {
    analyzing: () => {
      this.progress.start('Analyzing git changes...');
    },
    
    found: (fileCount: number, type: string) => {
      this.progress.update(`Found ${fileCount} changed files${type ? ` (${type})` : ''}`);
    },
    
    noChanges: () => {
      this.progress.succeed('No changes detected - skipping test generation');
    }
  };

  test = {
    creating: () => {
      this.progress.start('Creating test suite...');
    },
    
    created: (suiteId: string) => {
      this.progress.update(`Test suite created: ${suiteId.substring(0, 8)}`);
    },
    
    running: (completed?: number, total?: number) => {
      const progressText = completed !== undefined && total !== undefined 
        ? `Running tests... (${completed}/${total} completed)`
        : 'Running tests...';
      this.progress.update(progressText);
    },
    
    downloading: () => {
      this.progress.update('Downloading test artifacts...');
    },
    
    completed: (testCount: number) => {
      this.progress.succeed(`Tests completed! Generated ${testCount} test files`);
    },
    
    failed: (error: string) => {
      this.progress.fail(`Tests failed: ${error}`);
    }
  };

  // Results display
  displayResults(suite: any): void {
    console.log('\n' + chalk.bold('=== Test Results ==='));
    console.log(`Suite: ${suite.name || suite.uuid}`);
    console.log(`Status: ${this.getStatusColor(suite.status || 'unknown')}`);
    console.log(`Tests: ${suite.tests?.length || 0}`);

    if (suite.tests && suite.tests.length > 0) {
      // Use outcome field instead of status for more accurate results
      const passed = suite.tests.filter((t: any) => t.curRun?.outcome === 'pass').length;
      const failed = suite.tests.filter((t: any) => t.curRun?.outcome === 'fail').length;
      const skipped = suite.tests.filter((t: any) => t.curRun?.outcome === 'skipped').length;
      const pending = suite.tests.filter((t: any) => t.curRun?.outcome === 'pending').length;
      const unknown = suite.tests.filter((t: any) => !t.curRun?.outcome || t.curRun?.outcome === 'unknown').length;
      const total = suite.tests.length;

      console.log('\n' + chalk.bold('Test Outcomes:'));
      console.log(`  ${chalk.green(`✓ Passed: ${passed}`)}`);
      console.log(`  ${chalk.red(`✗ Failed: ${failed}`)}`);
      if (skipped > 0) {
        console.log(`  ${chalk.yellow(`⏩ Skipped: ${skipped}`)}`);
      }
      if (pending > 0) {
        console.log(`  ${chalk.blue(`⏸ Pending: ${pending}`)}`);
      }
      if (unknown > 0) {
        console.log(`  ${chalk.gray(`❓ Unknown: ${unknown}`)}`);
      }
      console.log(`  ${chalk.blue(`📊 Total: ${total}`)}`);

      if (failed > 0) {
        console.log(`\n${chalk.yellow('⚠ Some tests failed. Check the generated test files and recordings for details.')}`);
      } else if (passed === total && total > 0) {
        console.log(`\n${chalk.green('🎉 All tests passed successfully!')}`);
      }
    }
  }

  displayFileList(files: string[], repoPath: string): void {
    if (files.length === 0) return;

    console.log(chalk.blue('\nGenerated test files:'));
    for (const file of files) {
      const relativePath = file.replace(repoPath, '').replace(/^\//, '');
      console.log(chalk.gray(`  • ${relativePath}`));
    }
  }

  private getStatusColor(status: string): string {
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

  private getOutcomeColor(outcome: string): string {
    switch (outcome) {
      case 'pass':
        return chalk.green('✓ PASSED');
      case 'fail':
        return chalk.red('✗ FAILED');
      case 'skipped':
        return chalk.yellow('⏩ SKIPPED');
      case 'pending':
        return chalk.blue('⏸ PENDING');
      case 'unknown':
      default:
        return chalk.gray('❓ UNKNOWN');
    }
  }
}

/**
 * Environment detection and logger selection
 */
class SystemLogger {
  private devLogger: DevLogger;
  private userLogger: UserLogger;
  private isDevMode: boolean = false;

  constructor() {
    this.devLogger = new DevLogger();
    this.userLogger = new UserLogger();
    
    // Detect dev mode from various sources
    this.detectDevMode();
  }

  private detectDevMode(): void {
    // Check for explicit dev mode indicators
    this.isDevMode = 
      // CLI flags
      process.argv.includes('--dev') ||
      process.argv.includes('--verbose') ||
      process.argv.includes('-v') ||
      // Environment variables
      process.env.NODE_ENV === 'development' ||
      process.env.DEBUGGAI_LOG_LEVEL === 'DEBUG' ||
      process.env.DEBUG === 'true' ||
      // npm scripts context
      process.env.npm_lifecycle_event?.includes('dev') ||
      false;
  }

  /**
   * Force dev mode (useful for testing or programmatic usage)
   */
  setDevMode(enabled: boolean): void {
    this.isDevMode = enabled;
  }

  /**
   * Check if currently in dev mode
   */
  getDevMode(): boolean {
    return this.isDevMode;
  }

  // Route calls to appropriate logger
  get tunnel() {
    return this.isDevMode ? this.devLogger.tunnel : this.userLogger.tunnel;
  }

  get api() {
    return this.isDevMode ? this.devLogger.api : this.userLogger.api;
  }

  get git() {
    return this.isDevMode ? this.devLogger.git : this.userLogger.git;
  }

  get test() {
    return this.isDevMode ? this.devLogger.test : this.userLogger.test;
  }

  get progress() {
    return this.isDevMode ? this.devLogger.progress : this.userLogger.progress;
  }

  // General logging methods
  info(message: string, context?: LogContext): void {
    if (this.isDevMode) {
      this.devLogger.info(message, context);
    } else {
      this.userLogger.info(message);
    }
  }

  success(message: string, context?: LogContext): void {
    if (this.isDevMode) {
      this.devLogger.success(message, context);
    } else {
      this.userLogger.success(message);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.isDevMode) {
      this.devLogger.warn(message, context);
    } else {
      this.userLogger.warn(message);
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.isDevMode) {
      this.devLogger.error(message, context);
    } else {
      this.userLogger.error(message);
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.isDevMode) {
      this.devLogger.debug(message, context);
    }
    // UserLogger doesn't show debug messages
  }

  // User logger specific methods (only available in user mode)
  displayResults(suite: any): void {
    if (!this.isDevMode) {
      this.userLogger.displayResults(suite);
    } else {
      // In dev mode, still show the test results summary
      this.devLogger.info('Test suite completed', {
        category: 'test',
        details: {
          suiteId: suite.uuid,
          status: suite.status,
          testCount: suite.tests?.length
        }
      });

      // Always show the test results, even in dev mode
      if (suite.tests && suite.tests.length > 0) {
        const passed = suite.tests.filter((t: any) => t.curRun?.outcome === 'pass').length;
        const failed = suite.tests.filter((t: any) => t.curRun?.outcome === 'fail').length;
        const skipped = suite.tests.filter((t: any) => t.curRun?.outcome === 'skipped').length;
        const pending = suite.tests.filter((t: any) => t.curRun?.outcome === 'pending').length;
        const total = suite.tests.length;

        // Use console.log to bypass dev logger formatting for better visibility
        console.log('\n=== Test Results ===');
        console.log(`  ✓ Passed: ${passed}`);
        console.log(`  ✗ Failed: ${failed}`);
        if (skipped > 0) console.log(`  ⏩ Skipped: ${skipped}`);
        if (pending > 0) console.log(`  ⏸ Pending: ${pending}`);
        console.log(`  📊 Total: ${total}`);

        // Show individual test details if there are failures
        if (failed > 0) {
          console.log('\nFailed Tests:');
          suite.tests.filter((t: any) => t.curRun?.outcome === 'fail').forEach((test: any) => {
            console.log(`  ✗ ${test.name || test.testName || 'Unnamed test'}`);
            if (test.curRun?.error) {
              console.log(`    ${test.curRun.error}`);
            }
          });
        }
      }
    }
  }

  displayFileList(files: string[], repoPath: string): void {
    if (!this.isDevMode) {
      this.userLogger.displayFileList(files, repoPath);
    } else {
      // In dev mode, log file list
      this.devLogger.info(`Generated ${files.length} test files`, {
        category: 'test',
        details: { files: files.map(f => f.replace(repoPath, '').replace(/^\//, '')) }
      });
    }
  }
}

// Export singleton instance
export const systemLogger = new SystemLogger();

// Export individual loggers for direct access if needed (commented out to avoid conflicts)
// export { DevLogger, UserLogger };

// Export types for external use (commented out to avoid conflicts)
// export type {
//   LogContext,
//   TunnelLogContext,
//   ApiLogContext,
//   GitLogContext,
//   TestLogContext
// };