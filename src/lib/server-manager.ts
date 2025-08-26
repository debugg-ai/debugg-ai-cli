import { spawn, ChildProcess } from 'child_process';
import axios, { AxiosError } from 'axios';

export interface ServerConfig {
  command: string;
  args?: string[];
  port: number;
  host?: string;
  cwd?: string;
  env?: Record<string, string>;
  healthPath?: string;
  startupTimeout?: number;
  readyRegex?: RegExp;
}

export interface ServerStatus {
  running: boolean;
  pid?: number | undefined;
  port?: number | undefined;
  url?: string | undefined;
  ready?: boolean | undefined;
}

export interface ServerManagerOptions {
  defaultStartupTimeout?: number;
  defaultHealthPath?: string;
}

export class ServerManager {
  private servers = new Map<string, ChildProcess>();
  private serverConfigs = new Map<string, ServerConfig>();
  private defaultStartupTimeout: number;
  private defaultHealthPath: string;

  constructor(options: ServerManagerOptions = {}) {
    this.defaultStartupTimeout = options.defaultStartupTimeout || 60000;
    this.defaultHealthPath = options.defaultHealthPath || '/';
  }

  async startServer(id: string, config: ServerConfig): Promise<boolean> {
    if (this.servers.has(id)) {
      console.log(`Server ${id} is already running`);
      return true;
    }

    const host = config.host || 'localhost';
    const healthPath = config.healthPath || this.defaultHealthPath;
    const startupTimeout = config.startupTimeout || this.defaultStartupTimeout;
    const url = `http://${host}:${config.port}`;

    console.log(`Starting server ${id}: ${config.command} ${config.args?.join(' ') || ''}`);
    console.log(`Expected URL: ${url}`);

    return new Promise((resolve, reject) => {
      const serverProcess = spawn(config.command, config.args || [], {
        cwd: config.cwd || process.cwd(),
        env: { ...process.env, ...config.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.stopServer(id);
          reject(new Error(`Server ${id} failed to start within ${startupTimeout}ms`));
        }
      }, startupTimeout);

      serverProcess.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Failed to start server ${id}: ${error.message}`));
        }
      });

      serverProcess.on('exit', (code, signal) => {
        console.log(`Server ${id} exited with code ${code}, signal ${signal}`);
        this.servers.delete(id);
        this.serverConfigs.delete(id);
        
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Server ${id} exited unexpectedly with code ${code}`));
        }
      });

      if (serverProcess.stdout) {
        serverProcess.stdout.on('data', (data) => {
          const output = data.toString();
          console.log(`[${id}] ${output.trim()}`);
          
          if (config.readyRegex && config.readyRegex.test(output)) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              this.servers.set(id, serverProcess);
              this.serverConfigs.set(id, config);
              console.log(`Server ${id} is ready (detected from output)`);
              resolve(true);
            }
          }
        });
      }

      if (serverProcess.stderr) {
        serverProcess.stderr.on('data', (data) => {
          console.error(`[${id}] ERROR: ${data.toString().trim()}`);
        });
      }

      this.servers.set(id, serverProcess);
      this.serverConfigs.set(id, config);

      if (!config.readyRegex) {
        this.waitForServerHealth(url + healthPath, startupTimeout)
          .then((ready) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              if (ready) {
                console.log(`Server ${id} is ready (health check passed)`);
                resolve(true);
              } else {
                this.stopServer(id);
                reject(new Error(`Server ${id} health check failed`));
              }
            }
          })
          .catch((error) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              this.stopServer(id);
              reject(new Error(`Server ${id} health check error: ${error.message}`));
            }
          });
      }
    });
  }

  async stopServer(id: string): Promise<void> {
    const serverProcess = this.servers.get(id);
    if (!serverProcess) {
      console.log(`Server ${id} is not running`);
      return;
    }

    console.log(`Stopping server ${id}...`);
    
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log(`Force killing server ${id}...`);
        serverProcess.kill('SIGKILL');
        resolve();
      }, 5000);

      serverProcess.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      serverProcess.kill('SIGTERM');
    });
  }

  async stopAllServers(): Promise<void> {
    const serverIds = Array.from(this.servers.keys());
    console.log(`Stopping ${serverIds.length} servers...`);
    
    const stopPromises = serverIds.map(id => this.stopServer(id));
    await Promise.all(stopPromises);
    
    this.servers.clear();
    this.serverConfigs.clear();
    console.log('All servers stopped');
  }

  getServerStatus(id: string): ServerStatus {
    const serverProcess = this.servers.get(id);
    const config = this.serverConfigs.get(id);
    
    if (!serverProcess || !config) {
      return { running: false };
    }

    const host = config.host || 'localhost';
    const url = `http://${host}:${config.port}`;

    return {
      running: !serverProcess.killed,
      pid: serverProcess.pid || undefined,
      port: config.port,
      url
    };
  }

  async checkServerHealth(id: string): Promise<boolean> {
    const config = this.serverConfigs.get(id);
    if (!config) {
      return false;
    }

    const host = config.host || 'localhost';
    const healthPath = config.healthPath || this.defaultHealthPath;
    const url = `http://${host}:${config.port}${healthPath}`;

    return this.waitForServerHealth(url, 5000);
  }

  private async waitForServerHealth(url: string, timeout: number): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < timeout) {
      try {
        const response = await axios.get(url, {
          timeout: 3000,
          validateStatus: (status) => status < 500
        });
        
        if (response.status >= 200 && response.status < 400) {
          return true;
        }
      } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response && axiosError.response.status < 500) {
          return true;
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    return false;
  }

  getAllServerStatus(): Record<string, ServerStatus> {
    const status: Record<string, ServerStatus> = {};
    
    for (const id of this.servers.keys()) {
      status[id] = this.getServerStatus(id);
    }
    
    return status;
  }

  isServerRunning(id: string): boolean {
    const serverProcess = this.servers.get(id);
    return serverProcess ? !serverProcess.killed : false;
  }

  getServerUrl(id: string): string | null {
    const config = this.serverConfigs.get(id);
    if (!config) return null;
    
    const host = config.host || 'localhost';
    return `http://${host}:${config.port}`;
  }

  async waitForServer(id: string, timeout: number = 60000): Promise<boolean> {
    const config = this.serverConfigs.get(id);
    if (!config) {
      throw new Error(`Server configuration for ${id} not found`);
    }

    const host = config.host || 'localhost';
    const healthPath = config.healthPath || this.defaultHealthPath;
    const url = `http://${host}:${config.port}${healthPath}`;

    console.log(`Waiting for server ${id} to be ready at ${url}...`);
    return this.waitForServerHealth(url, timeout);
  }
}