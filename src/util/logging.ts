/**
 * System-wide logging architecture with separate user and developer channels
 * 
 * Set DEBUGGAI_LOG_LEVEL environment variable to control verbosity:
 * - ERROR: Only errors (default for production)
 * - WARN: Warnings and errors  
 * - INFO: Info, warnings and errors (default)
 * - DEBUG: All logging including technical debug details (use for development only)
 * 
 * Two main loggers:
 * - UserLogger: User-facing messages, progress, spinners, success/error notifications
 * - DevLogger: Technical details, debug info, API calls, git operations with context-aware categories
 * 
 * Features:
 * - Git-aware truncation: NEVER logs actual diff content, only summaries
 * - API-specific truncation: Prevents response body logging, shows metadata only
 * - Context-aware limits: Different truncation limits for git/api/default contexts
 * - Array truncation: Shows counts instead of full arrays to prevent spam
 * - Special object handling: Extracts essential fields only, ignores large bodies
 * - Spinner management: Built-in ora spinner handling for user progress
 * 
 * Usage:
 * - UserLogger.spinner.start('Processing...') - User-facing progress
 * - UserLogger.success('Tests completed') - User success messages
 * - UserLogger.error('Failed to connect') - User error messages
 * - DevLogger.git('Analyzing changes', data) - Git operations with safe truncation
 * - DevLogger.api('Making API call', requestInfo) - API operations
 * - DevLogger.tunnel('Starting tunnel', config) - Tunnel operations
 */

import ora, { type Ora } from 'ora';

export enum LogLevel {
  ERROR = 0,
  WARN = 1, 
  INFO = 2,
  DEBUG = 3
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private devMode: boolean = false;
  
  constructor() {
    // Set log level from environment
    const envLevel = process.env.DEBUGGAI_LOG_LEVEL?.toUpperCase();
    switch (envLevel) {
      case 'ERROR': this.level = LogLevel.ERROR; break;
      case 'WARN': this.level = LogLevel.WARN; break;
      case 'INFO': this.level = LogLevel.INFO; break;
      case 'DEBUG': this.level = LogLevel.DEBUG; break;
    }
    
    // Check for development mode
    this.devMode = process.env.DEBUGGAI_DEV_MODE === 'true';
  }
  
  isDevMode(): boolean {
    return this.devMode;
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.level;
  }

  error(message: string, data?: any, context?: 'default' | 'git' | 'api'): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(`❌ ${message}`, data ? this.truncate(data, context) : '');
    }
  }

  warn(message: string, data?: any, context?: 'default' | 'git' | 'api'): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(`⚠️  ${message}`, data ? this.truncate(data, context) : '');
    }
  }

  info(message: string, data?: any, context?: 'default' | 'git' | 'api'): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(`ℹ️  ${message}`, data ? this.truncate(data, context) : '');
    }
  }

  debug(message: string, data?: any, context?: 'default' | 'git' | 'api'): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(`🔍 ${message}`, data ? this.truncate(data, context) : '');
    }
  }

  // Always log success messages
  success(message: string): void {
    console.log(`✅ ${message}`);
  }

  // Always log progress messages  
  progress(message: string): void {
    console.log(`⏳ ${message}`);
  }

  private truncate(data: any, context: 'default' | 'git' | 'api' = 'default'): any {
    if (data === null || data === undefined) return data;
    
    // In dev mode, show much more detail for debugging
    const limits = this.devMode 
      ? { default: { max: 500, field: 100, desc: 200 }, git: { max: 300, field: 80, desc: 100 }, api: { max: 800, field: 150, desc: 300 } }
      : { default: { max: 80, field: 25, desc: 15 }, git: { max: 60, field: 20, desc: 10 }, api: { max: 100, field: 30, desc: 20 } };
    const { max, field, desc } = limits[context];
    
    // For arrays, just show count - no content
    if (Array.isArray(data)) {
      // Special handling for git changes arrays - NEVER log actual diff content
      if (data.length > 0 && data[0] && typeof data[0] === 'object' && ('file' in data[0] || 'diff' in data[0])) {
        return `[${data.length} git changes]`;
      }
      // API response arrays
      if (data.length > 0 && data[0] && typeof data[0] === 'object' && ('id' in data[0] || 'uuid' in data[0])) {
        return `[${data.length} API objects]`;
      }
      return `[${data.length} items]`;
    }
    
    // For objects, show essential fields only with context-aware truncation
    if (typeof data === 'object') {
      const essential: any = {};
      const keyFields = ['id', 'uuid', 'name', 'status', 'runStatus', 'error', 'file', 'branch', 'commitHash', 'method', 'url'];
      
      keyFields.forEach(key => {
        if (data[key] !== undefined) {
          const value = String(data[key]);
          essential[key] = value.length > field ? value.substring(0, field) + '...' : value;
        }
      });

      // Special handling for description - very short
      if (data.description) {
        const description = String(data.description);
        essential.description = description.length > desc ? description.substring(0, desc) + '...' : description;
      }

      // NEVER log git diff content - this is critical
      if (data.diff !== undefined) {
        const diffSize = String(data.diff || '').length;
        essential.diffSize = `${diffSize} chars`;
        // Explicitly exclude diff content
      }

      // NEVER log large response bodies
      if (data.body !== undefined || data.data !== undefined) {
        const body = data.body || data.data;
        if (typeof body === 'string') {
          essential.bodySize = `${body.length} chars`;
        } else if (typeof body === 'object') {
          essential.bodyType = Array.isArray(body) ? `array[${body.length}]` : 'object';
        }
      }

      // Special handling for git changes objects
      if (data.changes && Array.isArray(data.changes)) {
        essential.changesCount = data.changes.length;
        // Don't include actual changes array to prevent diff logging
      }

      // Special handling for branchInfo
      if (data.branchInfo && typeof data.branchInfo === 'object') {
        essential.branchInfo = {
          branch: data.branchInfo.branch || '?',
          commitHash: (data.branchInfo.commitHash || '').substring(0, 8) + '...'
        };
      }

      // API response specific handling
      if (data.headers && typeof data.headers === 'object') {
        essential.headersCount = Object.keys(data.headers).length;
      }

      // Add counts for arrays in the object
      Object.keys(data).forEach(key => {
        if (Array.isArray(data[key]) && !essential[`${key}Count`]) {
          essential[`${key}Count`] = data[key].length;
        }
      });

      // Ensure the final object string doesn't exceed limit
      const objStr = JSON.stringify(essential);
      if (objStr.length > max) {
        return `{${Object.keys(essential).length} fields}`;
      }
      
      return Object.keys(essential).length > 0 ? essential : '{...}';
    }
    
    // For strings, context-aware truncation
    const str = String(data);
    return str.length <= field ? data : str.substring(0, field) + '...';
  }
}

export const logger = new Logger();

// Git-aware logging helpers - NEVER logs actual diff content
export const gitLog = {
  info: (msg: string, data?: any) => {
    // For git operations, always use git-safe truncation
    logger.info(msg, data, 'git');
  },
  debug: (msg: string, data?: any) => {
    // For git debug, be extra careful about large diff content
    logger.debug(msg, data, 'git');
  },
  error: (msg: string, data?: any) => {
    // Git errors with safe truncation
    logger.error(msg, data, 'git');
  },
  commitSummary: (commitHash: string, fileCount: number, message?: string) => {
    const shortHash = commitHash.substring(0, 8);
    const truncatedMessage = message && message.length > 40 ? message.substring(0, 40) + '...' : message;
    logger.info(`Git commit ${shortHash}: ${fileCount} files${truncatedMessage ? ` - ${truncatedMessage}` : ''}`);
  },
  changeSummary: (changes: any[]) => {
    if (!changes || changes.length === 0) {
      logger.info('No git changes detected');
      return;
    }
    
    const summary = changes.reduce((acc: Record<string, number>, change: any) => {
      const status = change.status || change.working_dir || '?';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    
    const summaryStr = Object.entries(summary)
      .map(([status, count]) => `${count} ${status}`)
      .join(', ');
    
    logger.info(`Git changes: ${summaryStr} (${changes.length} total files)`);
  },
  diffSize: (diffContent: string | undefined) => {
    if (!diffContent) {
      logger.debug('Git diff: empty');
      return;
    }
    const size = diffContent.length;
    const lines = diffContent.split('\n').length;
    logger.debug(`Git diff: ${size} chars, ${lines} lines`);
    // NEVER log actual diff content
  }
};

// API-specific logging helpers - prevents response body logging
export const apiLog = {
  request: (method: string, url: string, data?: any) => {
    const cleanUrl = url.length > 60 ? url.substring(0, 60) + '...' : url;
    const logData = data ? { hasData: true, dataType: typeof data } : undefined;
    logger.info(`API ${method.toUpperCase()} ${cleanUrl}`, logData, 'api');
  },
  response: (response: any, timing?: number) => {
    const responseData = {
      status: response?.status || response?.statusCode,
      statusText: response?.statusText,
      id: response?.data?.id || response?.data?.uuid,
      timing: timing ? `${timing}ms` : undefined
    };
    // Remove any large response bodies
    const cleanData = Object.fromEntries(
      Object.entries(responseData).filter(([, value]) => value !== undefined)
    );
    logger.info('API response', cleanData, 'api');
  },
  error: (error: any, context?: string) => {
    const errorData = {
      status: error?.response?.status || error?.status,
      statusText: error?.response?.statusText || error?.statusText,
      message: error?.message?.substring(0, 50),
      code: error?.code,
      context
    };
    // Remove any error response bodies to prevent logging sensitive data
    logger.error('API error', errorData, 'api');
  },
  debug: (msg: string, data?: any) => {
    logger.debug(msg, data, 'api');
  },
  info: (msg: string, data?: any) => {
    logger.info(msg, data, 'api');
  }
};

/**
 * UserLogger - For user-facing messages, progress indicators, and notifications
 * Always visible to users regardless of log level (except for debug messages)
 */
class UserLoggerClass {
  private currentSpinner: Ora | null = null;

  /**
   * Spinner management for user progress indication
   */
  spinner = {
    start: (message: string): Ora => {
      if (this.currentSpinner) {
        this.currentSpinner.stop();
      }
      this.currentSpinner = ora(message).start();
      return this.currentSpinner;
    },
    
    succeed: (message?: string): void => {
      if (this.currentSpinner) {
        this.currentSpinner.succeed(message);
        this.currentSpinner = null;
      } else if (message) {
        console.log(`✅ ${message}`);
      }
    },
    
    fail: (message?: string): void => {
      if (this.currentSpinner) {
        this.currentSpinner.fail(message);
        this.currentSpinner = null;
      } else if (message) {
        console.error(`❌ ${message}`);
      }
    },
    
    stop: (): void => {
      if (this.currentSpinner) {
        this.currentSpinner.stop();
        this.currentSpinner = null;
      }
    },
    
    update: (message: string): void => {
      if (this.currentSpinner) {
        this.currentSpinner.text = message;
      }
    }
  };

  /**
   * Success messages - always shown to users
   */
  success(message: string): void {
    if (this.currentSpinner) {
      this.currentSpinner.succeed(message);
      this.currentSpinner = null;
    } else {
      console.log(`✅ ${message}`);
    }
  }

  /**
   * Error messages - always shown to users
   */
  error(message: string): void {
    if (this.currentSpinner) {
      this.currentSpinner.fail(message);
      this.currentSpinner = null;
    } else {
      console.error(`❌ ${message}`);
    }
  }

  /**
   * Warning messages - always shown to users
   */
  warn(message: string): void {
    if (this.currentSpinner) {
      this.currentSpinner.stop();
      this.currentSpinner = null;
    }
    console.warn(`⚠️  ${message}`);
  }

  /**
   * Info messages - shown to users (not for technical details)
   */
  info(message: string): void {
    if (this.currentSpinner) {
      this.currentSpinner.stop();
      this.currentSpinner = null;
    }
    console.log(`ℹ️  ${message}`);
  }

  /**
   * Progress messages - shown during operations
   */
  progress(message: string): void {
    if (this.currentSpinner) {
      this.currentSpinner.text = message;
    } else {
      console.log(`⏳ ${message}`);
    }
  }
}

/**
 * DevLogger - For technical debug information, API calls, git operations
 * Respects log level settings and provides context-aware truncation
 */
class DevLoggerClass {
  private level: LogLevel = LogLevel.INFO;
  
  constructor() {
    // Set log level from environment
    const envLevel = process.env.DEBUGGAI_LOG_LEVEL?.toUpperCase();
    switch (envLevel) {
      case 'ERROR': this.level = LogLevel.ERROR; break;
      case 'WARN': this.level = LogLevel.WARN; break;
      case 'INFO': this.level = LogLevel.INFO; break;
      case 'DEBUG': this.level = LogLevel.DEBUG; break;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.level;
  }

  private truncate(data: any, context: 'default' | 'git' | 'api' | 'tunnel' = 'default'): any {
    if (data === null || data === undefined) return data;
    
    // Different limits for different contexts
    const limits = {
      default: { max: 80, field: 25, desc: 15 },
      git: { max: 60, field: 20, desc: 10 },
      api: { max: 100, field: 30, desc: 20 },
      tunnel: { max: 120, field: 35, desc: 25 }
    };
    const { max, field, desc } = limits[context];
    
    // For arrays, just show count - no content
    if (Array.isArray(data)) {
      // Special handling for git changes arrays - NEVER log actual diff content
      if (data.length > 0 && data[0] && typeof data[0] === 'object' && ('file' in data[0] || 'diff' in data[0])) {
        return `[${data.length} git changes]`;
      }
      // API response arrays
      if (data.length > 0 && data[0] && typeof data[0] === 'object' && ('id' in data[0] || 'uuid' in data[0])) {
        return `[${data.length} API objects]`;
      }
      return `[${data.length} items]`;
    }
    
    // For objects, show essential fields only with context-aware truncation
    if (typeof data === 'object') {
      const essential: any = {};
      const keyFields = ['id', 'uuid', 'name', 'status', 'runStatus', 'error', 'file', 'branch', 'commitHash', 'method', 'url', 'port', 'host'];
      
      keyFields.forEach(key => {
        if (data[key] !== undefined) {
          const value = String(data[key]);
          essential[key] = value.length > field ? value.substring(0, field) + '...' : value;
        }
      });

      // Special handling for description - very short
      if (data.description) {
        const description = String(data.description);
        essential.description = description.length > desc ? description.substring(0, desc) + '...' : description;
      }

      // NEVER log git diff content - this is critical
      if (data.diff !== undefined) {
        const diffSize = String(data.diff || '').length;
        essential.diffSize = `${diffSize} chars`;
        // Explicitly exclude diff content
      }

      // NEVER log large response bodies
      if (data.body !== undefined || data.data !== undefined) {
        const body = data.body || data.data;
        if (typeof body === 'string') {
          essential.bodySize = `${body.length} chars`;
        } else if (typeof body === 'object') {
          essential.bodyType = Array.isArray(body) ? `array[${body.length}]` : 'object';
        }
      }

      // Special handling for git changes objects
      if (data.changes && Array.isArray(data.changes)) {
        essential.changesCount = data.changes.length;
        // Don't include actual changes array to prevent diff logging
      }

      // Special handling for branchInfo
      if (data.branchInfo && typeof data.branchInfo === 'object') {
        essential.branchInfo = {
          branch: data.branchInfo.branch || '?',
          commitHash: (data.branchInfo.commitHash || '').substring(0, 8) + '...'
        };
      }

      // API response specific handling
      if (data.headers && typeof data.headers === 'object') {
        essential.headersCount = Object.keys(data.headers).length;
      }

      // Add counts for arrays in the object
      Object.keys(data).forEach(key => {
        if (Array.isArray(data[key]) && !essential[`${key}Count`]) {
          essential[`${key}Count`] = data[key].length;
        }
      });

      // Ensure the final object string doesn't exceed limit
      const objStr = JSON.stringify(essential);
      if (objStr.length > max) {
        return `{${Object.keys(essential).length} fields}`;
      }
      
      return Object.keys(essential).length > 0 ? essential : '{...}';
    }
    
    // For strings, context-aware truncation
    const str = String(data);
    return str.length <= field ? data : str.substring(0, field) + '...';
  }

  /**
   * Git operations logging - NEVER logs actual diff content
   */
  git(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(`🔍 [GIT] ${message}`, data ? this.truncate(data, 'git') : '');
    }
  }

  /**
   * API operations logging - prevents response body logging
   */
  api(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(`🔍 [API] ${message}`, data ? this.truncate(data, 'api') : '');
    }
  }

  /**
   * Tunnel operations logging
   */
  tunnel(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(`🔍 [TUNNEL] ${message}`, data ? this.truncate(data, 'tunnel') : '');
    }
  }

  /**
   * General debug logging
   */
  debug(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(`🔍 [DEBUG] ${message}`, data ? this.truncate(data) : '');
    }
  }

  /**
   * Info level logging for technical details
   */
  info(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(`ℹ️  [DEV] ${message}`, data ? this.truncate(data) : '');
    }
  }

  /**
   * Warning level logging for technical issues
   */
  warn(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(`⚠️  [DEV] ${message}`, data ? this.truncate(data) : '');
    }
  }

  /**
   * Error level logging for technical errors
   */
  error(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(`❌ [DEV] ${message}`, data ? this.truncate(data) : '');
    }
  }
}

// Export the new logging system
export const UserLogger = new UserLoggerClass();
export const DevLogger = new DevLoggerClass();

// Convenience functions
export const log = {
  error: (msg: string, data?: any) => logger.error(msg, data),
  warn: (msg: string, data?: any) => logger.warn(msg, data), 
  info: (msg: string, data?: any) => logger.info(msg, data),
  debug: (msg: string, data?: any) => logger.debug(msg, data),
  success: (msg: string) => logger.success(msg),
  progress: (msg: string) => logger.progress(msg),
  
  // Context-specific logging helpers
  git: gitLog,
  api: apiLog
};