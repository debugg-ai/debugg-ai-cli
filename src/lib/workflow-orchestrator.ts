import { TunnelManager, TunnelConfig, TunnelInfo } from './tunnel-manager';
import { ServerManager, ServerConfig } from './server-manager';
import { TestManager, TestResult } from './test-manager';
import { systemLogger } from '../util/system-logger';

export interface WorkflowConfig {
  server: ServerConfig;
  tunnel: TunnelConfig;
  test: {
    apiKey: string;
    baseUrl?: string;
    repoPath: string;
    testOutputDir?: string;
    maxTestWaitTime?: number;
  };
  cleanup?: {
    onSuccess?: boolean;
    onError?: boolean;
  };
}

export interface WorkflowResult {
  success: boolean;
  testResult?: TestResult;
  tunnelInfo?: TunnelInfo;
  serverUrl?: string;
  error?: string;
}

export interface WorkflowOptions {
  ngrokAuthToken?: string | undefined;
  baseDomain?: string | undefined;
  verbose?: boolean | undefined;
  devMode?: boolean | undefined;
}

export class WorkflowOrchestrator {
  private tunnelManager: TunnelManager;
  private serverManager: ServerManager;
  private testManager?: TestManager;
  // Spinner handling is now managed by UserLogger
  private verbose: boolean;
  private devMode: boolean;

  constructor(options: WorkflowOptions = {}) {
    this.tunnelManager = new TunnelManager({
      authtoken: options.ngrokAuthToken,
      baseDomain: options.baseDomain
    });
    
    this.serverManager = new ServerManager({
      defaultStartupTimeout: 60000,
      defaultHealthPath: '/'
    });

    this.verbose = options.verbose || false;
    this.devMode = options.devMode || false;
  }

  async executeWorkflow(config: WorkflowConfig): Promise<WorkflowResult> {
    let tunnelUuid: string | undefined;
    let serverStarted = false;

    try {
      systemLogger.debug('Starting DebuggAI workflow');
      
      // Start user-facing progress spinner
      systemLogger.info('Initializing workflow', { category: 'workflow' });

      systemLogger.info('Starting application server', { category: 'workflow' });
      systemLogger.debug('Starting application server');
      serverStarted = await this.serverManager.startServer('main', config.server);
      
      if (!serverStarted) {
        throw new Error('Failed to start application server');
      }

      const serverUrl = this.serverManager.getServerUrl('main');
      systemLogger.debug('Server started successfully', { details: { serverUrl } });

      systemLogger.info('Waiting for server to be ready', { category: 'workflow' });
      systemLogger.debug('Waiting for server to be ready');
      const serverReady = await this.serverManager.waitForServer('main', 30000);
      
      if (!serverReady) {
        throw new Error('Server failed to become ready');
      }

      systemLogger.info('Creating ngrok tunnel', { category: 'workflow' });
      systemLogger.debug('Creating ngrok tunnel', { category: 'tunnel' });
      
      // Log tunnel configuration details
      const targetDomain = config.tunnel.customDomain || 
        (config.tunnel.subdomain ? `${config.tunnel.subdomain}.ngrok.debugg.ai` : undefined);
      
      systemLogger.debug('Setting up tunnel', { category: 'tunnel', details: { port: config.tunnel.port, targetDomain } });
      
      const tunnelInfo = await this.tunnelManager.createTunnel(config.tunnel);
      tunnelUuid = tunnelInfo.uuid;
      
      systemLogger.tunnel.connected(tunnelInfo.url);

      systemLogger.info('Verifying tunnel connectivity', { category: 'workflow' });
      systemLogger.debug('Testing connectivity', { details: { url: tunnelInfo.url } });
      
      const tunnelReady = await this.verifyTunnelConnectivity(tunnelInfo.url, 30000);
      
      if (!tunnelReady) {
        systemLogger.error('Tunnel connectivity verification failed', { category: 'tunnel', details: { url: tunnelInfo.url } });
        systemLogger.error('Tunnel connectivity verification failed');
        throw new Error('Tunnel connectivity verification failed');
      }
      
      systemLogger.debug('Tunnel is ready and accessible', { details: { url: tunnelInfo.url } });

      systemLogger.info('Initializing test manager', { category: 'workflow' });
      systemLogger.debug('Initializing test manager');
      this.testManager = new TestManager({
        ...config.test,
        waitForServer: false
      });

      systemLogger.info('Running DebuggAI tests', { category: 'workflow' });
      systemLogger.debug('Running DebuggAI tests');
      const testResult = await this.runTestsWithTunnel(tunnelInfo.url);

      const shouldCleanup = config.cleanup?.onSuccess !== false;
      if (shouldCleanup) {
        await this.cleanup(tunnelUuid, true);
      }

      systemLogger.success('Workflow completed successfully!');
      
      const result: WorkflowResult = {
        success: true,
        testResult,
        tunnelInfo
      };
      
      if (serverUrl) {
        result.serverUrl = serverUrl;
      }
      
      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      systemLogger.error('Workflow failed', { details: { error: errorMsg } });
      systemLogger.error(`Workflow failed: ${errorMsg}`);

      const shouldCleanup = config.cleanup?.onError !== false;
      if (shouldCleanup) {
        await this.cleanup(tunnelUuid, serverStarted);
      }

      return {
        success: false,
        error: errorMsg
      };
    } finally {
      // Spinner cleanup is handled by UserLogger
    }
  }

  async startServer(config: ServerConfig): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      const success = await this.serverManager.startServer('main', config);
      const url = this.serverManager.getServerUrl('main');
      
      const result: { success: boolean; url?: string; error?: string } = { success };
      if (url) {
        result.url = url;
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async createTunnel(config: TunnelConfig): Promise<{ success: boolean; tunnelInfo?: TunnelInfo; error?: string }> {
    try {
      systemLogger.debug('Creating tunnel with provided configuration', { category: 'tunnel' });
      const tunnelInfo = await this.tunnelManager.createTunnel(config);
      return { success: true, tunnelInfo };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async runTests(tunnelUrl: string, testConfig: WorkflowConfig['test']): Promise<{ success: boolean; result?: TestResult; error?: string }> {
    try {
      // Initialize test manager if not already done
      if (!this.testManager) {
        this.testManager = new TestManager({
          ...testConfig,
          waitForServer: false
        });
      }

      // Ensure the test manager is properly initialized before running tests
      if (!this.testManager) {
        throw new Error('Failed to initialize test manager');
      }

      const result = await this.runTestsWithTunnel(tunnelUrl);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async runTestsWithTunnel(tunnelUrl: string): Promise<TestResult> {
    if (!this.testManager) {
      throw new Error('Test manager not initialized');
    }

    if (typeof this.testManager.runCommitTests !== 'function') {
      throw new Error('Test manager missing runCommitTests method');
    }

    // Try to enhance the test manager with tunnel URL if it has a client
    const client = (this.testManager as any).client;
    if (client && client.createCommitTestSuite) {
      const originalCreateCommitTestSuite = client.createCommitTestSuite.bind(client);

      client.createCommitTestSuite = async (request: any) => {
        const enhancedRequest = {
          ...request,
          publicUrl: tunnelUrl,
          testEnvironment: {
            url: tunnelUrl,
            type: 'ngrok_tunnel',
            port: this.extractPortFromUrl(tunnelUrl)
          }
        };
        
        return originalCreateCommitTestSuite(enhancedRequest);
      };
    }

    return await this.testManager.runCommitTests();
  }

  private extractPortFromUrl(url: string): number | undefined {
    try {
      const urlObj = new URL(url);
      return urlObj.port ? parseInt(urlObj.port, 10) : undefined;
    } catch {
      return undefined;
    }
  }

  private async verifyTunnelConnectivity(tunnelUrl: string, timeout: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 2000;
    let attemptCount = 0;

    systemLogger.debug('Starting connectivity checks', { details: { url: tunnelUrl } });

    while (Date.now() - startTime < timeout) {
      attemptCount++;
      const elapsed = Date.now() - startTime;
      
      try {
        systemLogger.debug('Connectivity attempt', { details: { attempt: attemptCount, elapsed } });
        
        const response = await fetch(tunnelUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok || response.status === 404) {
          systemLogger.debug('Tunnel connectivity verified', { details: { status: response.status, attempts: attemptCount, elapsed } });
          return true;
        } else {
          systemLogger.debug('Tunnel responded with status', { details: { status: response.status } });
        }
      } catch (error) {
        systemLogger.debug('Connectivity attempt failed, retrying', { details: { attempt: attemptCount, elapsed, timeout } });
        // If fetch fails, break early to avoid long timeouts in tests
        if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
          systemLogger.debug('Test environment detected - breaking early from connectivity checks');
          return false;
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    systemLogger.debug('Tunnel connectivity verification timed out', { details: { attempts: attemptCount, timeout } });
    return false;
  }

  async cleanup(tunnelUuid?: string, serverStarted: boolean = false): Promise<void> {
    systemLogger.debug('Starting cleanup');

    const cleanupPromises: Promise<void>[] = [];

    // Safely handle tunnel cleanup
    if (tunnelUuid) {
      systemLogger.debug('Cleaning up tunnel', { details: { uuid: tunnelUuid } });
      const tunnelCleanup = this.tunnelManager.disconnectTunnel(tunnelUuid)
        .then(() => {
          systemLogger.tunnel.disconnected(`Tunnel ${tunnelUuid}`);
        })
        .catch(error => {
          systemLogger.debug('Failed to disconnect tunnel', { details: { uuid: tunnelUuid, error } });
          return Promise.resolve();
        });
      cleanupPromises.push(tunnelCleanup);
    } else {
      systemLogger.debug('Cleaning up all active tunnels');
      const allTunnelCleanup = this.tunnelManager.disconnectAll()
        .then(() => {
          systemLogger.debug('All tunnels disconnected successfully');
        })
        .catch(error => {
          systemLogger.debug('Failed to disconnect all tunnels', { details: { error } });
          return Promise.resolve();
        });
      cleanupPromises.push(allTunnelCleanup);
    }

    // Safely handle server cleanup
    if (serverStarted) {
      const serverCleanup = this.serverManager.stopAllServers()
        .catch(error => {
          systemLogger.debug('Failed to stop servers', { details: { error } });
          return Promise.resolve();
        });
      cleanupPromises.push(serverCleanup);
    }

    try {
      await Promise.all(cleanupPromises);
      systemLogger.debug('Cleanup completed');
    } catch (error) {
      systemLogger.debug('Cleanup encountered errors', { details: { error } });
    }
  }

  async getStatus(): Promise<{
    servers: Record<string, any>;
    tunnels: TunnelInfo[];
  }> {
    return {
      servers: this.serverManager.getAllServerStatus(),
      tunnels: this.tunnelManager.getAllTunnels()
    };
  }

  // Logging is now handled by systemLogger

  async healthCheck(): Promise<{
    tunnelManager: boolean;
    serverManager: boolean;
    activeServers: number;
    activeTunnels: number;
  }> {
    return {
      tunnelManager: true,
      serverManager: true,
      activeServers: Object.keys(this.serverManager.getAllServerStatus()).length,
      activeTunnels: this.tunnelManager.getAllTunnels().length
    };
  }

  /**
   * Get all active tunnels for integration testing
   */
  getAllActiveTunnels() {
    return this.tunnelManager.getAllTunnels();
  }
}