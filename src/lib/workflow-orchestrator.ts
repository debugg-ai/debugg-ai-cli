import { TunnelManager, TunnelConfig, TunnelInfo } from './tunnel-manager';
import { ServerManager, ServerConfig } from './server-manager';
import { TestManager, TestResult } from './test-manager';
import chalk from 'chalk';
import ora, { Ora } from 'ora';

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
}

export class WorkflowOrchestrator {
  private tunnelManager: TunnelManager;
  private serverManager: ServerManager;
  private testManager?: TestManager;
  private spinner?: Ora | undefined;
  private verbose: boolean;

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
  }

  async executeWorkflow(config: WorkflowConfig): Promise<WorkflowResult> {
    let tunnelUuid: string | undefined;
    let serverStarted = false;

    try {
      this.log('Starting DebuggAI workflow...', 'info');
      this.spinner = ora('Initializing workflow...').start();

      this.spinner.text = 'Starting application server...';
      serverStarted = await this.serverManager.startServer('main', config.server);
      
      if (!serverStarted) {
        throw new Error('Failed to start application server');
      }

      const serverUrl = this.serverManager.getServerUrl('main');
      this.log(`Server started successfully at ${serverUrl}`, 'success');

      this.spinner.text = 'Waiting for server to be ready...';
      const serverReady = await this.serverManager.waitForServer('main', 30000);
      
      if (!serverReady) {
        throw new Error('Server failed to become ready');
      }

      this.spinner.text = 'Creating ngrok tunnel...';
      const tunnelInfo = await this.tunnelManager.createTunnel(config.tunnel);
      tunnelUuid = tunnelInfo.uuid;
      
      this.log(`Tunnel created: ${tunnelInfo.url} -> localhost:${config.tunnel.port}`, 'success');

      this.spinner.text = 'Verifying tunnel connectivity...';
      const tunnelReady = await this.verifyTunnelConnectivity(tunnelInfo.url, 30000);
      
      if (!tunnelReady) {
        throw new Error('Tunnel connectivity verification failed');
      }

      this.spinner.text = 'Initializing test manager...';
      this.testManager = new TestManager({
        ...config.test,
        waitForServer: false
      });

      this.spinner.text = 'Running DebuggAI tests...';
      const testResult = await this.runTestsWithTunnel(tunnelInfo.url);

      const shouldCleanup = config.cleanup?.onSuccess !== false;
      if (shouldCleanup) {
        await this.cleanup(tunnelUuid, true);
      }

      this.spinner.succeed('Workflow completed successfully!');
      
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
      this.log(`Workflow failed: ${errorMsg}`, 'error');
      
      if (this.spinner) {
        this.spinner.fail(`Workflow failed: ${errorMsg}`);
      }

      const shouldCleanup = config.cleanup?.onError !== false;
      if (shouldCleanup) {
        await this.cleanup(tunnelUuid, serverStarted);
      }

      return {
        success: false,
        error: errorMsg
      };
    } finally {
      this.spinner = undefined;
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

    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(tunnelUrl, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok || response.status === 404) {
          return true;
        }
      } catch (error) {
        this.log(`Tunnel connectivity check failed: ${error}`, 'warn');
        // If fetch fails, break early to avoid long timeouts in tests
        if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
          return false;
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return false;
  }

  async cleanup(tunnelUuid?: string, serverStarted: boolean = false): Promise<void> {
    this.log('Starting cleanup...', 'info');

    const cleanupPromises: Promise<void>[] = [];

    // Safely handle tunnel cleanup
    if (tunnelUuid) {
      const tunnelCleanup = this.tunnelManager.disconnectTunnel(tunnelUuid)
        .catch(error => {
          this.log(`Failed to disconnect tunnel: ${error}`, 'warn');
          return Promise.resolve();
        });
      cleanupPromises.push(tunnelCleanup);
    } else {
      const allTunnelCleanup = this.tunnelManager.disconnectAll()
        .catch(error => {
          this.log(`Failed to disconnect all tunnels: ${error}`, 'warn');
          return Promise.resolve();
        });
      cleanupPromises.push(allTunnelCleanup);
    }

    // Safely handle server cleanup
    if (serverStarted) {
      const serverCleanup = this.serverManager.stopAllServers()
        .catch(error => {
          this.log(`Failed to stop servers: ${error}`, 'warn');
          return Promise.resolve();
        });
      cleanupPromises.push(serverCleanup);
    }

    try {
      await Promise.all(cleanupPromises);
      this.log('Cleanup completed', 'success');
    } catch (error) {
      this.log(`Cleanup encountered errors: ${error}`, 'warn');
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

  private log(message: string, level: 'info' | 'success' | 'warn' | 'error' = 'info'): void {
    if (!this.verbose) return;

    switch (level) {
      case 'success':
        console.log(chalk.green(`✓ ${message}`));
        break;
      case 'warn':
        console.log(chalk.yellow(`⚠ ${message}`));
        break;
      case 'error':
        console.log(chalk.red(`✗ ${message}`));
        break;
      default:
        console.log(chalk.blue(`ℹ ${message}`));
    }
  }

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