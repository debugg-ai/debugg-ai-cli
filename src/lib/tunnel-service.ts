
import * as path from 'path';
import {
  authtoken,
  connect,
  disconnect
} from 'ngrok';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
export interface TunnelInfo {
  url: string;
  port: number;
  subdomain: string;
}

export interface TunnelServiceOptions {
  verbose?: boolean;
}

export class TunnelService {
  private verbose: boolean;
  private activeTunnelUrl: string | null = null;
  private activeTunnelInfo: TunnelInfo | null = null;

  constructor(options: TunnelServiceOptions = {}) {
    this.verbose = options.verbose ?? false;
  }

  /**
   * Create a tunnel for the specified port and subdomain
   */
  async createTunnel(port: number, subdomain: string, authToken: string): Promise<TunnelInfo> {
    if (!authToken) {
      throw new Error('Auth token is required to create tunnel');
    }

    if (!port || port <= 0 || port > 65535) {
      throw new Error(`Invalid port number: ${port}. Port must be between 1 and 65535`);
    }

    if (!subdomain || subdomain.trim() === '') {
      throw new Error('Subdomain is required and cannot be empty');
    }

    // Clean up any existing tunnel first
    if (this.activeTunnelUrl) {
      await this.cleanup();
    }

    try {
      if (this.verbose) {
        console.log(`Creating tunnel for localhost:${port} with subdomain: ${subdomain}`);
      }


      // Set the auth token
      if (this.verbose) {
        console.log(`Setting ngrok auth token (length: ${authToken.length})`);
      }
      await authtoken({ authtoken: authToken });

      // Create tunnel options with config file path
      // Config file is copied to dist/services/ngrok during build
      const configPath = path.join(__dirname, '..', 'services', 'ngrok', 'ngrok-config.yml');

      const tunnelOptions = {
        addr: port,
        hostname: `${subdomain}.ngrok.debugg.ai`,
        authtoken: authToken,
        binPath: (path: string) => path.replace('app.asar', 'app.asar.unpacked'), // custom binary path for electron
        onLogEvent: (data: any) => { if (this.verbose) console.log('onLogEvent', data) },
        configPath: configPath
      };

      if (this.verbose) {
        console.log(`Using ngrok config from: ${configPath}`);
      }

      if (this.verbose) {
        console.log('Creating ngrok tunnel with options:', {
          ...tunnelOptions,
          authtoken: '[REDACTED]',
          binPath: '[Function]'
        });
      }

      // Create the tunnel - no fallback as it won't work with our account
      const url = await connect(tunnelOptions);

      if (!url) {
        throw new Error('Failed to create tunnel - no URL returned');
      }

      // Store tunnel information
      this.activeTunnelUrl = url;
      this.activeTunnelInfo = {
        url,
        port,
        subdomain
      };

      if (this.verbose) {
        console.log(`Tunnel created successfully: ${url}`);
      }

      return this.activeTunnelInfo;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      if (this.verbose) {
        console.error(`Failed to create tunnel: ${errorMessage}`);
      }

      // Provide more user-friendly error messages
      if (errorMessage.includes('invalid tunnel configuration') ||
        errorMessage.includes('401') ||
        errorMessage.includes('unauthorized') ||
        errorMessage.includes('forbidden')) {
        throw new Error(`Invalid ngrok auth token or insufficient permissions for custom domain. Token may not support ${subdomain}.ngrok.debugg.ai`);
      } else if (errorMessage.includes('ECONNREFUSED')) {
        throw new Error(`Cannot connect to localhost:${port}. Please ensure your server is running on port ${port}.`);
      } else if (errorMessage.includes('hostname') ||
        errorMessage.includes('subdomain') ||
        errorMessage.includes('domain')) {
        throw new Error(`Failed to create tunnel with subdomain '${subdomain}'. The subdomain may already be in use or invalid.`);
      } else if (errorMessage.includes('ENOENT') || errorMessage.includes('spawn')) {
        throw new Error(`ngrok binary not found or not executable. Please ensure ngrok is properly installed.`);
      } else if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) {
        throw new Error(`Authentication failed. The auth token is invalid or expired.`);
      } else if (errorMessage.includes('not available')) {
        throw new Error('ngrok package is not installed. Please install ngrok dependency.');
      } else {
        throw new Error(`Failed to create tunnel: ${errorMessage}`);
      }
    }
  }

  /**
   * Get the current tunnel URL if one exists
   */
  getTunnelUrl(): string | null {
    return this.activeTunnelInfo ? this.activeTunnelInfo.url : null;
  }

  async getConfig(): Promise<any> {
    const configPath = path.join(__dirname, '..', 'services', 'ngrok', 'ngrok-config.yml');
    const config = parse(await readFile(configPath, 'utf8'));
    if (config && typeof config.authtoken !== 'undefined') {
      await authtoken({ authtoken: config.authtoken });
    }
    return config;
  }

  /**
   * Clean up active tunnels
   */
  async cleanup(): Promise<void> {
    if (!this.activeTunnelUrl) {
      if (this.verbose) {
        console.log('No active tunnels to clean up');
      }
      return;
    }

    try {
      if (this.verbose) {
        console.log(`Cleaning up tunnel: ${this.activeTunnelUrl}`);
      }

      // Disconnect the specific tunnel
      await disconnect(this.activeTunnelUrl);

      // Clear our state
      this.activeTunnelUrl = null;
      this.activeTunnelInfo = null;

      if (this.verbose) {
        console.log('Tunnel cleanup completed successfully');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      if (this.verbose) {
        console.error(`Failed to clean up tunnel: ${errorMessage}`);
      }

      // Still clear our state even if cleanup failed
      this.activeTunnelUrl = null;
      this.activeTunnelInfo = null;

      // Don't throw error for cleanup failures, just log them
      console.warn(`Warning: Failed to properly clean up tunnel: ${errorMessage}`);
    }
  }

  /**
   * Check if there's an active tunnel
   */
  hasActiveTunnel(): boolean {
    return this.activeTunnelUrl !== null;
  }

  /**
   * Get information about the active tunnel
   */
  getActiveTunnelInfo(): TunnelInfo | null {
    return this.activeTunnelInfo;
  }
}