/**
 * Tunnel Management Service
 * Provides high-level tunnel management abstraction for localhost URLs
 */

import { v4 as uuidv4 } from 'uuid';

let ngrokModule: any = null;

async function getNgrok() {
  if (!ngrokModule) {
    try {
      ngrokModule = await import('ngrok');
    } catch (error) {
      throw new Error(`Failed to load ngrok module: ${error}`);
    }
  }
  return ngrokModule;
}

// Simple logger for CLI environment
const logger = {
  debug: (msg: string, ...args: any[]) => console.debug(`[tunnelManager] ${msg}`, ...args),
  info: (msg: string, ...args: any[]) => console.log(`[tunnelManager] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[tunnelManager] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[tunnelManager] ${msg}`, ...args),
  success: (msg: string, ...args: any[]) => console.log(`[tunnelManager] ✓ ${msg}`, ...args)
};

// URL utility functions for CLI
function isLocalhostUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return lowerUrl.includes('localhost') || lowerUrl.includes('127.0.0.1');
}

function extractLocalhostPort(url: string): number | null {
  const match = url.match(/localhost:(\d+)|127\.0\.0\.1:(\d+)/);
  if (match) {
    const portStr = match[1] || match[2];
    if (portStr) {
      const port = parseInt(portStr, 10);
      return isNaN(port) ? null : port;
    }
  }
  return null;
}

function generateTunnelUrl(originalUrl: string, tunnelId: string): string {
  try {
    const url = new URL(originalUrl);
    return `https://${tunnelId}.ngrok.debugg.ai${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Fallback for malformed URLs
    return `https://${tunnelId}.ngrok.debugg.ai`;
  }
}

export interface TunnelInfo {
  tunnelId: string;
  originalUrl: string;
  tunnelUrl: string;
  publicUrl: string;
  port: number;
  createdAt: number;
  lastAccessedAt: number;
  autoShutoffTimer?: NodeJS.Timeout;
}

export interface TunnelResult {
  url: string;
  tunnelId?: string;
  isLocalhost: boolean;
}

class TunnelManager {
  private activeTunnels = new Map<string, TunnelInfo>();
  private initialized = false;
  private readonly TUNNEL_TIMEOUT_MS = 60 * 55 * 1000; // 55 minutes (we get billed by the hour, so dont want to run 1 min past the hour)

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      try {
        const ngrok = await getNgrok();
        // Try to get the API to check if ngrok is running
        const api = ngrok.getApi();
        if (!api) {
          logger.debug('ngrok API not available, may need to start first tunnel');
        }
        this.initialized = true;
      } catch (error) {
        logger.debug(`ngrok initialization check: ${error}`);
        this.initialized = true; // Continue anyway, let connection attempt handle the error
      }
    }
  }

  /**
   * Reset the auto-shutoff timer for a tunnel
   */
  private resetTunnelTimer(tunnelInfo: TunnelInfo): void {
    // Clear existing timer
    if (tunnelInfo.autoShutoffTimer) {
      clearTimeout(tunnelInfo.autoShutoffTimer);
    }

    // Update last access time
    tunnelInfo.lastAccessedAt = Date.now();

    // Set new timer
    tunnelInfo.autoShutoffTimer = setTimeout(async () => {
      logger.info(`Auto-shutting down tunnel ${tunnelInfo.tunnelId} after 60 minutes of inactivity`);
      try {
        await this.stopTunnel(tunnelInfo.tunnelId);
      } catch (error) {
        logger.error(`Failed to auto-shutdown tunnel ${tunnelInfo.tunnelId}:`, error);
      }
    }, this.TUNNEL_TIMEOUT_MS);

    logger.debug(`Reset timer for tunnel ${tunnelInfo.tunnelId}, will auto-shutdown at ${new Date(tunnelInfo.lastAccessedAt + this.TUNNEL_TIMEOUT_MS).toISOString()}`);
  }

  /**
   * Touch a tunnel to reset its timer (called when the tunnel is used)
   */
  touchTunnel(tunnelId: string): void {
    const tunnelInfo = this.activeTunnels.get(tunnelId);
    if (tunnelInfo) {
      this.resetTunnelTimer(tunnelInfo);
    }
  }

  /**
   * Touch a tunnel by URL (convenience method)
   */
  touchTunnelByUrl(url: string): void {
    const tunnelId = this.extractTunnelId(url);
    if (tunnelId) {
      this.touchTunnel(tunnelId);
    }
  }

  /**
   * Process a URL and create a tunnel if needed
   * Returns the URL to use (either original or tunneled) and tunnel metadata
   */
  async processUrl(url: string, authToken?: string, specificTunnelId?: string): Promise<TunnelResult> {
    if (!isLocalhostUrl(url)) {
      return {
        url,
        isLocalhost: false
      };
    }

    const port = extractLocalhostPort(url);
    if (!port) {
      throw new Error(`Could not extract port from localhost URL: ${url}`);
    }

    // Check if we already have a tunnel for this port
    const existingTunnel = this.findTunnelByPort(port);
    if (existingTunnel) {
      const publicUrl = generateTunnelUrl(url, existingTunnel.tunnelId);
      logger.info(`Reusing existing tunnel for port ${port}: ${publicUrl}`);
      return {
        url: publicUrl,
        tunnelId: existingTunnel.tunnelId,
        isLocalhost: true
      };
    }

    // Create new tunnel
    if (!authToken) {
      throw new Error('Auth token required to create tunnel for localhost URL');
    }

    const tunnelId = specificTunnelId || uuidv4();
    const tunnelInfo = await this.createTunnel(url, port, tunnelId, authToken);
    
    return {
      url: tunnelInfo.publicUrl,
      tunnelId: tunnelInfo.tunnelId,
      isLocalhost: true
    };
  }

  /**
   * Check if a URL is a tunnel URL
   */
  isTunnelUrl(url: string): boolean {
    return url.includes('.ngrok.debugg.ai');
  }

  /**
   * Extract tunnel ID from a tunnel URL
   */
  extractTunnelId(url: string): string | null {
    const match = url.match(/https?:\/\/([^.]+)\.ngrok\.debugg\.ai/);
    return match && match[1] ? match[1] : null;
  }

  /**
   * Get tunnel info by ID
   */
  getTunnelInfo(tunnelId: string): TunnelInfo | undefined {
    return this.activeTunnels.get(tunnelId);
  }

  /**
   * Find tunnel by port
   */
  private findTunnelByPort(port: number): TunnelInfo | undefined {
    for (const tunnel of this.activeTunnels.values()) {
      if (tunnel.port === port) {
        return tunnel;
      }
    }
    return undefined;
  }

  /**
   * Create a new tunnel
   */
  private async createTunnel(originalUrl: string, port: number, tunnelId: string, authToken: string): Promise<TunnelInfo> {
    await this.ensureInitialized();

    const tunnelDomain = `${tunnelId}.ngrok.debugg.ai`;
    
    logger.info(`Creating tunnel for localhost:${port} with domain ${tunnelDomain}`);
    
    try {
      // Get ngrok module dynamically
      const ngrok = await getNgrok();

      // Kill any existing ngrok process BEFORE setting auth token to ensure clean state
      try {
        logger.debug(`Checking for existing ngrok processes`);
        // Try to disconnect all existing tunnels first
        try {
          await ngrok.disconnect(); // Disconnect all tunnels
          logger.debug(`Disconnected all existing tunnels`);
        } catch (disconnectErr) {
          logger.debug(`No tunnels to disconnect: ${disconnectErr}`);
        }

        // Then kill the ngrok process
        await ngrok.kill();
        logger.info(`Killed existing ngrok process`);

        // Wait a bit for the process to fully terminate
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (killError) {
        // Ignore error - ngrok might not be running
        logger.debug(`No existing ngrok process to kill: ${killError}`);
      }

      // Set auth token after killing any existing processes
      logger.info(`Setting ngrok auth token`);
      await ngrok.authtoken({ authtoken: authToken });

      // Create tunnel options
      const tunnelOptions = {
        proto: 'http' as const,
        addr: process.env.DOCKER_CONTAINER === "true" ? `host.docker.internal:${port}` : port,
        hostname: tunnelDomain,
        authtoken: authToken,
        name: tunnelId, // IMPORTANT: Provide explicit name to prevent ngrok from auto-generating one
        onLogEvent: (data: any) => {console.debug('onLogEvent', data)}, // returns stdout messages from ngrok process
        // Don't override configPath - let ngrok use its default configuration
      };

      logger.info(`Connecting tunnel with options: ${JSON.stringify({ ...tunnelOptions, authtoken: '[REDACTED]', name: tunnelId })}`);

      // Add retry logic for tunnel connection
      let tunnelUrl: string | undefined;
      let lastError: any;
      const MAX_RETRIES = 3;
      const RETRY_DELAY = 2000;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          logger.debug(`Tunnel connection attempt ${attempt}/${MAX_RETRIES}`);
          tunnelUrl = await ngrok.connect(tunnelOptions);
          break; // Success - exit the retry loop
        } catch (connectError) {
          lastError = connectError;
          logger.warn(`Tunnel connection attempt ${attempt} failed:`);
          logger.debug(`Error:`, connectError);

          if (attempt < MAX_RETRIES) {
            logger.info(`Retrying in ${RETRY_DELAY}ms...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));

            // Try to clean up the specific tunnel name before retry
            try {
              // First try to disconnect by tunnel URL (if ngrok returned it)
              const api = ngrok.getApi();
              if (api) {
                logger.debug(`Attempting to cleanup existing tunnel with name: ${tunnelId}`);
                // Get all tunnels and disconnect the one with our name
                const tunnels = await ngrok.default.tunnels();
                const existingTunnel = tunnels.find((t: any) => t.name === tunnelId);
                if (existingTunnel) {
                  logger.debug(`Found existing tunnel with matching name, disconnecting: ${existingTunnel.public_url}`);
                  await ngrok.disconnect(existingTunnel.public_url);
                }
              }
            } catch (disconnectErr) {
              logger.debug(`Cleanup before retry failed: ${disconnectErr}`);
            }
          }
        }
      }

      if (!tunnelUrl) {
        logger.error(`Failed to create tunnel after ${MAX_RETRIES} attempts:`, lastError);
        throw lastError || new Error('Failed to create tunnel');
      }
      
      // Generate the public URL maintaining path, search, and hash from original
      const publicUrl = generateTunnelUrl(originalUrl, tunnelId);
      
      // Store tunnel info
      const now = Date.now();
      const tunnelInfo: TunnelInfo = {
        tunnelId,
        originalUrl,
        tunnelUrl,
        publicUrl,
        port,
        createdAt: now,
        lastAccessedAt: now
      };
      
      this.activeTunnels.set(tunnelId, tunnelInfo);
      
      // Start the auto-shutoff timer
      this.resetTunnelTimer(tunnelInfo);
      
      logger.info(`Tunnel created: ${publicUrl} -> localhost:${port}`);
      return tunnelInfo;
      
    } catch (error) {
      logger.error(`Failed to create tunnel for ${originalUrl}:`, error);
      
      // Try to provide more helpful error messages
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new Error(`Failed to create tunnel: ngrok daemon not running or connection refused. Original error: ${error.message}`);
      } else if (error instanceof Error && error.message.includes('authtoken')) {
        throw new Error(`Failed to create tunnel: Invalid or missing auth token. Original error: ${error.message}`);
      } else {
        throw new Error(`Failed to create tunnel: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Stop a tunnel by ID
   */
  async stopTunnel(tunnelId: string): Promise<void> {
    const tunnelInfo = this.activeTunnels.get(tunnelId);
    if (!tunnelInfo) {
      logger.warn(`Tunnel ${tunnelId} not found for cleanup`);
      return;
    }
    
    try {
      // Clear the auto-shutoff timer
      if (tunnelInfo.autoShutoffTimer) {
        clearTimeout(tunnelInfo.autoShutoffTimer);
      }

      const ngrok = await getNgrok();
      await ngrok.disconnect(tunnelInfo.tunnelUrl);
      this.activeTunnels.delete(tunnelId);
      logger.info(`Cleaned up tunnel: ${tunnelInfo.publicUrl}`);
    } catch (error) {
      logger.error(`Failed to cleanup tunnel ${tunnelId}:`, error);
      throw error;
    }
  }

  /**
   * Stop all active tunnels
   */
  async stopAllTunnels(): Promise<void> {
    const tunnelIds = Array.from(this.activeTunnels.keys());
    const cleanupPromises = tunnelIds.map(tunnelId => 
      this.stopTunnel(tunnelId).catch(error => 
        logger.error(`Failed to stop tunnel ${tunnelId}:`, error)
      )
    );
    
    await Promise.all(cleanupPromises);
    logger.info(`Stopped ${tunnelIds.length} tunnels`);
  }

  /**
   * Get all active tunnels
   */
  getActiveTunnels(): TunnelInfo[] {
    return Array.from(this.activeTunnels.values());
  }

  /**
   * Get tunnel status with timing information
   */
  getTunnelStatus(tunnelId: string): {
    tunnel: TunnelInfo;
    age: number;
    timeSinceLastAccess: number;
    timeUntilAutoShutoff: number;
  } | null {
    const tunnel = this.activeTunnels.get(tunnelId);
    if (!tunnel) {
      return null;
    }

    const now = Date.now();
    const age = now - tunnel.createdAt;
    const timeSinceLastAccess = now - tunnel.lastAccessedAt;
    const timeUntilAutoShutoff = Math.max(0, (tunnel.lastAccessedAt + this.TUNNEL_TIMEOUT_MS) - now);

    return {
      tunnel,
      age,
      timeSinceLastAccess,
      timeUntilAutoShutoff
    };
  }

  /**
   * Get all tunnel statuses
   */
  getAllTunnelStatuses() {
    const statuses: any[] = [];
    for (const tunnelId of this.activeTunnels.keys()) {
      const status = this.getTunnelStatus(tunnelId);
      if (status) {
        statuses.push(status as any);
      }
    }
    return statuses;
  }
}

// Singleton instance
const tunnelManager = new TunnelManager();

export { tunnelManager };
export default TunnelManager;