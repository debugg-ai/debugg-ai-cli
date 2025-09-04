import { PostHog } from 'posthog-node';
import * as os from 'os';
import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';

// PostHog configuration
const POSTHOG_API_KEY = 'phc_4h2Yov2P0Vc9UMqfKf3dYKSQ6THOs7N6LZR0VKYopZN';
const POSTHOG_HOST = 'https://us.i.posthog.com';
const PROJECT_ID = '212030';

export interface TelemetryEvent {
  event: string;
  properties?: Record<string, any>;
}

export interface TestExecutionMetrics {
  suiteUuid: string;
  duration: number;
  filesChanged: number;
  testsGenerated: number;
  success: boolean;
  error?: string;
  executionType: 'working' | 'commit' | 'pr' | 'pr-sequence';
}

export interface CommandMetrics {
  command: string;
  options: Record<string, any>;
  duration: number;
  success: boolean;
  error?: string;
}

/**
 * Telemetry service for tracking CLI usage and performance metrics
 */
export class TelemetryService {
  private static instance: TelemetryService;
  private posthog: PostHog | null = null;
  private userId: string;
  private sessionId: string;
  private enabled: boolean = true;
  private initialized: boolean = false;
  private commandStartTime: number = 0;
  private testStartTime: number = 0;

  private constructor() {
    this.userId = this.getOrCreateUserId();
    this.sessionId = this.generateSessionId();
    // Lazy initialization - only initialize when actually used
    // This prevents hanging in CI when just loading the module
  }

  /**
   * Get singleton instance of TelemetryService
   */
  static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  /**
   * Initialize PostHog client (lazy initialization)
   */
  private initializePostHog(): void {
    if (this.initialized) return;
    this.initialized = true;
    
    try {
      // Check if telemetry is disabled via environment variable
      if (process.env.DEBUGGAI_TELEMETRY_DISABLED === 'true' || 
          process.env.DO_NOT_TRACK === '1' ||
          process.env.CI === 'true') { // Disable in CI by default
        this.enabled = false;
        return;
      }

      this.posthog = new PostHog(POSTHOG_API_KEY, {
        host: POSTHOG_HOST,
        flushAt: 1, // Send events immediately in CLI context
        flushInterval: 0, // Don't batch events
      });

      // Identify user with system information
      this.identify({
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        cliVersion: this.getCliVersion(),
        projectId: PROJECT_ID,
      });
    } catch (error) {
      // Silently fail if PostHog initialization fails
      this.enabled = false;
    }
  }

  /**
   * Get or create a persistent user ID
   */
  private getOrCreateUserId(): string {
    const configDir = path.join(os.homedir(), '.debugg-ai');
    const configFile = path.join(configDir, 'telemetry.json');

    try {
      // Try to read existing user ID
      if (fs.existsSync(configFile)) {
        const config = fs.readJsonSync(configFile);
        if (config.userId) {
          return config.userId;
        }
      }

      // Generate new user ID
      const userId = `cli_${crypto.randomBytes(16).toString('hex')}`;
      
      // Save to config
      fs.ensureDirSync(configDir);
      fs.writeJsonSync(configFile, { userId, createdAt: new Date().toISOString() });
      
      return userId;
    } catch (error) {
      // Fallback to temporary ID if file operations fail
      return `cli_temp_${crypto.randomBytes(16).toString('hex')}`;
    }
  }

  /**
   * Generate a session ID for this CLI invocation
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Get CLI version from package.json
   */
  private getCliVersion(): string {
    try {
      const packageJson = fs.readJsonSync(path.join(__dirname, '../../package.json'));
      return packageJson.version || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Ensure PostHog is initialized before use
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initializePostHog();
    }
  }

  /**
   * Identify the user with properties
   */
  identify(properties: Record<string, any>): void {
    this.ensureInitialized();
    if (!this.enabled || !this.posthog) return;

    try {
      this.posthog.identify({
        distinctId: this.userId,
        properties: {
          ...properties,
          sessionId: this.sessionId,
        },
      });
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Track a custom event
   */
  track(event: string, properties?: Record<string, any>): void {
    this.ensureInitialized();
    if (!this.enabled || !this.posthog) return;

    try {
      this.posthog.capture({
        distinctId: this.userId,
        event,
        properties: {
          ...properties,
          sessionId: this.sessionId,
          timestamp: new Date().toISOString(),
          projectId: PROJECT_ID,
        },
      });
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Track command start
   */
  trackCommandStart(command: string, options: Record<string, any>): void {
    this.commandStartTime = Date.now();
    
    this.track('cli_command_started', {
      command,
      options: this.sanitizeOptions(options),
      environment: this.detectEnvironment(),
    });
  }

  /**
   * Track command completion
   */
  trackCommandComplete(command: string, success: boolean, error?: string): void {
    const duration = this.commandStartTime ? Date.now() - this.commandStartTime : 0;
    
    this.track('cli_command_completed', {
      command,
      success,
      error: error ? this.sanitizeError(error) : undefined,
      duration,
      environment: this.detectEnvironment(),
    });
  }

  /**
   * Track test execution start
   */
  trackTestStart(executionType: string, metadata?: Record<string, any>): void {
    this.testStartTime = Date.now();
    
    this.track('test_execution_started', {
      executionType,
      ...metadata,
      environment: this.detectEnvironment(),
    });
  }

  /**
   * Track test execution completion
   */
  trackTestComplete(metrics: TestExecutionMetrics): void {
    const duration = this.testStartTime ? Date.now() - this.testStartTime : metrics.duration;
    
    this.track('test_execution_completed', {
      ...metrics,
      duration,
      environment: this.detectEnvironment(),
    });
  }

  /**
   * Track API errors
   */
  trackApiError(endpoint: string, statusCode: number, error: string): void {
    this.track('api_error', {
      endpoint,
      statusCode,
      error: this.sanitizeError(error),
      environment: this.detectEnvironment(),
    });
  }

  /**
   * Track feature usage
   */
  trackFeatureUsage(feature: string, metadata?: Record<string, any>): void {
    this.track('feature_used', {
      feature,
      ...metadata,
      environment: this.detectEnvironment(),
    });
  }

  /**
   * Track tunnel creation
   */
  trackTunnelCreation(success: boolean, port?: number, error?: string): void {
    this.track('tunnel_created', {
      success,
      port,
      error: error ? this.sanitizeError(error) : undefined,
      environment: this.detectEnvironment(),
    });
  }

  /**
   * Track artifact download
   */
  trackArtifactDownload(type: string, success: boolean, count?: number): void {
    this.track('artifacts_downloaded', {
      type,
      success,
      count,
      environment: this.detectEnvironment(),
    });
  }

  /**
   * Detect execution environment
   */
  private detectEnvironment(): string {
    if (process.env.GITHUB_ACTIONS) return 'github_actions';
    if (process.env.CI) return 'ci';
    if (process.env.CODESPACES) return 'codespaces';
    if (process.env.GITPOD_WORKSPACE_ID) return 'gitpod';
    return 'local';
  }

  /**
   * Sanitize command options to remove sensitive data
   */
  private sanitizeOptions(options: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(options)) {
      // Don't send API keys or tokens
      if (key.toLowerCase().includes('key') || 
          key.toLowerCase().includes('token') || 
          key.toLowerCase().includes('secret') ||
          key.toLowerCase().includes('password')) {
        sanitized[key] = '<redacted>';
      } else if (typeof value === 'string' && value.length > 100) {
        // Truncate long strings
        sanitized[key] = value.substring(0, 100) + '...';
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  /**
   * Sanitize error messages to remove sensitive data
   */
  private sanitizeError(error: string): string {
    // Remove potential API keys or tokens from error messages
    return error
      .replace(/[a-f0-9]{32,}/gi, '<token>')
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer <token>')
      .substring(0, 500); // Limit error message length
  }

  /**
   * Flush pending events and shutdown
   */
  async shutdown(): Promise<void> {
    if (!this.enabled || !this.posthog) return;

    try {
      await this.posthog.shutdown();
    } catch (error) {
      // Silently fail
    }
  }
}

// Export singleton getter to delay instantiation
export const telemetry = {
  trackCommandStart: (command: string, options: Record<string, any>) => 
    TelemetryService.getInstance().trackCommandStart(command, options),
  trackCommandComplete: (command: string, success: boolean, error?: string) =>
    TelemetryService.getInstance().trackCommandComplete(command, success, error),
  trackTestStart: (executionType: string, metadata?: Record<string, any>) =>
    TelemetryService.getInstance().trackTestStart(executionType, metadata),
  trackTestComplete: (metrics: TestExecutionMetrics) =>
    TelemetryService.getInstance().trackTestComplete(metrics),
  trackApiError: (endpoint: string, statusCode: number, error: string) =>
    TelemetryService.getInstance().trackApiError(endpoint, statusCode, error),
  trackFeatureUsage: (feature: string, metadata?: Record<string, any>) =>
    TelemetryService.getInstance().trackFeatureUsage(feature, metadata),
  trackTunnelCreation: (success: boolean, port?: number, error?: string) =>
    TelemetryService.getInstance().trackTunnelCreation(success, port, error),
  trackArtifactDownload: (type: string, success: boolean, count?: number) =>
    TelemetryService.getInstance().trackArtifactDownload(type, success, count),
  shutdown: () => TelemetryService.getInstance().shutdown()
};