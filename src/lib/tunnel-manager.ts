let ngrok: any;
try {
  ngrok = require('ngrok');
} catch (error) {
  console.warn('Warning: ngrok package not available. Tunnel functionality will be disabled.');
}
import { v4 as uuidv4 } from 'uuid';

export interface TunnelConfig {
  port: number;
  subdomain?: string | undefined;
  customDomain?: string | undefined;
  authtoken?: string | undefined;
}

export interface TunnelInfo {
  url: string;
  port: number;
  subdomain: string;
  uuid: string;
}

export interface TunnelManagerOptions {
  authtoken?: string | undefined;
  baseDomain?: string | undefined;
  ngrokAuthToken?: string | undefined; // Alias for integration tests
  verbose?: boolean | undefined;
}

export class TunnelManager {
  private authtoken: string | undefined;
  private baseDomain: string;
  private activeTunnels = new Map<string, TunnelInfo>();
  private verbose: boolean;

  constructor(options: TunnelManagerOptions = {}) {
    this.authtoken = options.authtoken || options.ngrokAuthToken || process.env.NGROK_AUTH_TOKEN;
    this.baseDomain = options.baseDomain ?? 'ngrok.debugg.ai';
    this.verbose = options.verbose ?? false;
  }

  async createTunnel(config: TunnelConfig): Promise<TunnelInfo> {
    if (!ngrok) {
      throw new Error('Ngrok package is not available. Please install ngrok dependency or use direct URL access instead.');
    }
    
    if (!this.authtoken && !config.authtoken) {
      throw new Error('Ngrok auth token is required. Provide via constructor options, config, or NGROK_AUTH_TOKEN env var');
    }

    const tunnelUuid = uuidv4();
    const subdomain = config.subdomain || tunnelUuid;
    const customDomain = config.customDomain || `${subdomain}.${this.baseDomain}`;

    try {
      const authToken = config.authtoken || this.authtoken;
      if (!authToken) {
        throw new Error('Ngrok auth token is required');
      }

      const url = await ngrok.connect({
        proto: 'http',
        addr: config.port,
        hostname: customDomain,
        authtoken: authToken
      });

      const tunnelInfo: TunnelInfo = {
        url,
        port: config.port,
        subdomain,
        uuid: tunnelUuid
      };

      this.activeTunnels.set(tunnelUuid, tunnelInfo);
      
      console.log(`Tunnel created: ${url} -> localhost:${config.port}`);
      return tunnelInfo;
    } catch (error) {
      throw new Error(`Failed to create ngrok tunnel: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async disconnectTunnel(uuid: string): Promise<void> {
    if (!ngrok) {
      console.warn('Ngrok package not available, skipping tunnel disconnect');
      return;
    }
    
    const tunnel = this.activeTunnels.get(uuid);
    if (!tunnel) {
      console.warn(`Tunnel with UUID ${uuid} not found`);
      return;
    }

    try {
      await ngrok.disconnect(tunnel.url);
      this.activeTunnels.delete(uuid);
      console.log(`Tunnel disconnected: ${tunnel.url}`);
    } catch (error) {
      throw new Error(`Failed to disconnect tunnel ${uuid}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async disconnectAll(): Promise<void> {
    const tunnelUuids = Array.from(this.activeTunnels.keys());
    
    for (const uuid of tunnelUuids) {
      try {
        await this.disconnectTunnel(uuid);
      } catch (error) {
        console.warn(`Failed to disconnect tunnel ${uuid}:`, error);
      }
    }

    if (ngrok) {
      try {
        await ngrok.kill();
        console.log('All ngrok processes terminated');
      } catch (error) {
        console.warn('Failed to kill ngrok processes:', error);
      }
    }
  }

  getTunnelInfo(uuid: string): TunnelInfo | undefined {
    return this.activeTunnels.get(uuid);
  }

  getAllTunnels(): TunnelInfo[] {
    return Array.from(this.activeTunnels.values());
  }

  generateUUID(): string {
    return uuidv4();
  }

  isValidTunnelUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.endsWith(this.baseDomain) && 
             urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async getTunnelStatus(uuid: string): Promise<{ active: boolean; url?: string; port?: number }> {
    const tunnel = this.activeTunnels.get(uuid);
    if (!tunnel) {
      return { active: false };
    }

    try {
      await fetch(`${tunnel.url}/health`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      
      return {
        active: true,
        url: tunnel.url,
        port: tunnel.port
      };
    } catch {
      return {
        active: false,
        url: tunnel.url,
        port: tunnel.port
      };
    }
  }
}