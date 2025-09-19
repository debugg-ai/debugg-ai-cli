/**
 * Simple tunnel service layer
 * Provides a clean interface for test-manager.ts to create and manage tunnels
 * Uses ngrok directly to avoid dependency issues with the services layer
 */

export interface TunnelInfo {
  url: string;
  port: number;
  subdomain: string;
}

export interface TunnelServiceOptions {
  verbose?: boolean;
}

// Lazy-loaded ngrok module to handle optional dependency
let ngrok: any = null;

async function loadNgrok() {
  if (!ngrok) {
    try {
      ngrok = require('ngrok');
    } catch (error) {
      throw new Error('ngrok package is not available. Please install ngrok dependency.');
    }
  }
  return ngrok;
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

      const ngrokModule = await loadNgrok();

      // Set the auth token
      await ngrokModule.authtoken({ authtoken: authToken });

      // Create tunnel options
      const tunnelOptions = {
        proto: 'http' as const,
        addr: port,
        hostname: `${subdomain}.ngrok.debugg.ai`,
        authtoken: authToken,
        onLogEvent: (data: any) => {if (this.verbose) console.log('onLogEvent', data)}
      };

      if (this.verbose) {
        console.log('Creating ngrok tunnel with options:', {
          ...tunnelOptions,
          authtoken: '[REDACTED]'
        });
      }

      // Create the tunnel
      const url = await ngrokModule.connect(tunnelOptions);

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
          errorMessage.includes('authtoken') ||
          errorMessage.includes('authentication')) {
        throw new Error(`Invalid ngrok auth token. Please check your authentication credentials.`);
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

      const ngrokModule = await loadNgrok();

      // Disconnect the specific tunnel
      await ngrokModule.disconnect(this.activeTunnelUrl);

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