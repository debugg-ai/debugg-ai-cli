import { log } from '../util/logging';

let ngrok: {
  connect: (options: { proto: string; addr: number; hostname?: string; authtoken: string }) => Promise<string>;
  disconnect: (url: string) => Promise<void>;
  kill: () => Promise<void>;
} | undefined;
try {
  ngrok = require('ngrok');
} catch (error) {
  log.warn('ngrok package not available - tunnel functionality disabled');
}
import { v4 as uuidv4 } from 'uuid';

export interface TunnelConfig {
  port: number;
  subdomain?: string | undefined;
  customDomain?: string | undefined;
  authtoken?: string | undefined;
  tunnelKey?: string | undefined; // NgrokAuthToken from backend response for ngrok setup
  endpointUuid?: string | undefined; // UUID for custom endpoint (e.g., <uuid>.debugg.ai)
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
    
    // Use tunnelKey from backend if provided, otherwise fallback to configured auth token
    const authToken = config.tunnelKey || config.authtoken || this.authtoken;
    if (!authToken) {
      throw new Error('Ngrok auth token or tunnelKey is required. Provide via constructor options, config, tunnelKey from backend, or NGROK_AUTH_TOKEN env var');
    }

    // Use endpointUuid if provided, otherwise generate one
    const tunnelUuid = config.endpointUuid || uuidv4();
    const subdomain = config.subdomain || tunnelUuid;
    const customDomain = config.customDomain || `${subdomain}.${this.baseDomain}`;

    const startTime = Date.now();
    
    log.info(`🌐 Creating ngrok tunnel for localhost:${config.port}`);
    log.debug('Ngrok tunnel configuration', {
      uuid: tunnelUuid,
      subdomain,
      targetDomain: customDomain,
      port: config.port,
      hasAuthToken: !!authToken,
      authTokenSource: config.tunnelKey ? 'backend' : (config.authtoken ? 'config' : 'env')
    });

    try {
      log.info(`🔗 Attempting to connect to public domain: ${customDomain}`);
      const url = await ngrok.connect({
        proto: 'http',
        addr: config.port,
        hostname: customDomain,
        authtoken: authToken
      });

      const connectionTime = Date.now() - startTime;
      const tunnelInfo: TunnelInfo = {
        url,
        port: config.port,
        subdomain,
        uuid: tunnelUuid
      };

      this.activeTunnels.set(tunnelUuid, tunnelInfo);
      
      log.success(`✅ Ngrok tunnel established in ${connectionTime}ms`);
      log.info(`🌍 Public URL: ${url} -> localhost:${config.port}`);
      log.debug('Tunnel details', {
        url,
        uuid: tunnelUuid,
        subdomain,
        port: config.port,
        connectionTimeMs: connectionTime,
        activeTunnels: this.activeTunnels.size
      });
      
      return tunnelInfo;
    } catch (error) {
      const failureTime = Date.now() - startTime;
      log.error(`❌ Ngrok connection failed after ${failureTime}ms`, {
        targetDomain: customDomain,
        port: config.port,
        error: String(error),
        uuid: tunnelUuid
      });
      throw new Error(`Failed to create ngrok tunnel to ${customDomain}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async disconnectTunnel(uuid: string): Promise<void> {
    if (!ngrok) {
      log.warn('Ngrok package not available, skipping tunnel disconnect');
      return;
    }
    
    const tunnel = this.activeTunnels.get(uuid);
    if (!tunnel) {
      log.warn(`⚠️  Tunnel with UUID ${uuid} not found - may already be disconnected`);
      return;
    }

    const startTime = Date.now();
    log.info(`🔌 Disconnecting tunnel: ${tunnel.url}`);
    
    try {
      await ngrok.disconnect(tunnel.url);
      this.activeTunnels.delete(uuid);
      
      const disconnectionTime = Date.now() - startTime;
      log.success(`✅ Tunnel disconnected in ${disconnectionTime}ms: ${tunnel.url}`);
      log.debug('Disconnection details', {
        uuid,
        url: tunnel.url,
        port: tunnel.port,
        disconnectionTimeMs: disconnectionTime,
        remainingTunnels: this.activeTunnels.size
      });
    } catch (error) {
      const failureTime = Date.now() - startTime;
      log.error(`❌ Failed to disconnect tunnel ${uuid} after ${failureTime}ms`, {
        url: tunnel.url,
        error: String(error)
      });
      throw new Error(`Failed to disconnect tunnel ${uuid} (${tunnel.url}): ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async disconnectAll(): Promise<void> {
    const tunnelUuids = Array.from(this.activeTunnels.keys());
    
    if (tunnelUuids.length === 0) {
      log.debug('No active tunnels to disconnect');
      return;
    }

    log.info(`🔌 Disconnecting ${tunnelUuids.length} active tunnel(s)`);
    const startTime = Date.now();
    let successCount = 0;
    let failureCount = 0;
    
    for (const uuid of tunnelUuids) {
      try {
        await this.disconnectTunnel(uuid);
        successCount++;
      } catch (error) {
        failureCount++;
        log.warn(`⚠️  Failed to disconnect tunnel ${uuid}`, { error: String(error) });
      }
    }

    if (ngrok) {
      try {
        log.debug('Terminating all ngrok processes...');
        await ngrok.kill();
        const totalTime = Date.now() - startTime;
        log.success(`🏁 All ngrok processes terminated in ${totalTime}ms`);
        log.info(`📊 Tunnel cleanup summary: ${successCount} successful, ${failureCount} failed`);
      } catch (error) {
        log.error('❌ Failed to kill ngrok processes', { error: String(error) });
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
      log.debug(`Tunnel status check: UUID ${uuid} not found`);
      return { active: false };
    }

    const startTime = Date.now();
    log.debug(`🔍 Checking tunnel connectivity: ${tunnel.url}`);

    try {
      await fetch(`${tunnel.url}/health`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      
      const responseTime = Date.now() - startTime;
      log.debug(`✅ Tunnel is active and responding (${responseTime}ms): ${tunnel.url}`);
      
      return {
        active: true,
        url: tunnel.url,
        port: tunnel.port
      };
    } catch (error) {
      const failureTime = Date.now() - startTime;
      log.debug(`❌ Tunnel connectivity check failed (${failureTime}ms)`, {
        url: tunnel.url,
        error: String(error)
      });
      
      return {
        active: false,
        url: tunnel.url,
        port: tunnel.port
      };
    }
  }

  /**
   * Create tunnel using backend-provided tunnelKey (ngrok auth token) and endpoint UUID
   * This should be called AFTER creating the commit suite, using the tunnelKey from backend response
   */
  async createTunnelWithBackendKey(
    port: number,
    endpointUuid: string,
    tunnelKey: string
  ): Promise<TunnelInfo> {
    const targetDomain = `${endpointUuid}.${this.baseDomain}`;
    
    log.info(`🔑 Creating tunnel with backend-provided credentials`);
    log.debug('Backend tunnel configuration', {
      endpointUuid,
      targetDomain,
      port,
      hasKey: !!tunnelKey
    });

    return this.createTunnel({
      port,
      endpointUuid,
      tunnelKey,
      customDomain: targetDomain
    });
  }
}