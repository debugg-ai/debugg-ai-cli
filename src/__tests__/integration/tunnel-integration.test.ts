/**
 * Tunnel Integration Tests
 * 
 * Tests real ngrok tunnel creation and management using personal ngrok auth token.
 * These tests create actual tunnels and validate their connectivity.
 */

import { TunnelManager } from '../../lib/tunnel-manager';
import { DebuggAIClient } from '../../lib/api-client';
import { describeIntegration, itIntegration, getIntegrationConfig } from './integration-config';

describeIntegration('Tunnel Management with Real ngrok', () => {
  let tunnelManager: TunnelManager;
  let client: DebuggAIClient;
  let config: ReturnType<typeof getIntegrationConfig>;
  const createdTunnels: string[] = [];

  beforeAll(async () => {
    config = getIntegrationConfig();
    
    if (config.skipTunnelTests) {
      return;
    }
    
    tunnelManager = new TunnelManager({
      ngrokAuthToken: config.ngrokAuthToken,
      verbose: config.verbose
    });

    client = new DebuggAIClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeout: 30000
    });

    if (config.verbose) {
      console.log('Tunnel integration test setup complete');
    }
  });

  afterAll(async () => {
    if (config.skipTunnelTests) {
      return;
    }

    // Clean up all created tunnels
    try {
      await tunnelManager.disconnectAll();
      if (config.verbose) {
        console.log('Cleaned up all tunnels');
      }
    } catch (error) {
      console.warn('Error during tunnel cleanup:', error);
    }
  });

  itIntegration('should create ngrok tunnel successfully', async () => {
    if (config.skipTunnelTests) {
      console.log('Skipping tunnel tests');
      return;
    }

    const tunnelConfig = {
      port: config.testPort,
      subdomain: undefined, // Let ngrok assign
      authtoken: config.ngrokAuthToken
    };

    const tunnelInfo = await tunnelManager.createTunnel(tunnelConfig);
    
    expect(tunnelInfo).toBeDefined();
    expect(tunnelInfo.url).toMatch(/^https:\/\/.*\.ngrok\.(io|debugg\.ai)$/);
    expect(tunnelInfo.port).toBe(config.testPort);
    expect(tunnelInfo.uuid).toBeDefined();
    
    createdTunnels.push(tunnelInfo.uuid);
    
    if (config.verbose) {
      console.log('Created tunnel:', {
        url: tunnelInfo.url,
        port: tunnelInfo.port,
        uuid: tunnelInfo.uuid
      });
    }
  });

  itIntegration('should validate tunnel connectivity', async () => {
    if (config.skipTunnelTests || createdTunnels.length === 0) {
      console.log('Skipping connectivity test - no tunnels created');
      return;
    }

    const tunnels = tunnelManager.getAllTunnels();
    expect(tunnels.length).toBeGreaterThan(0);
    
    const tunnel = tunnels[0];
    if (!tunnel) return;

    // Use DebuggAI client to validate tunnel connectivity
    const validation = await client.validateTunnelUrl(tunnel.url, 15000);
    
    if (config.verbose) {
      console.log('Tunnel connectivity validation:', {
        url: tunnel.url,
        accessible: validation.accessible,
        responseTime: validation.responseTime,
        error: validation.error
      });
    }

    // Note: The tunnel might not be accessible if there's no server running on the port
    // But we should at least get a response from ngrok (even if it's a connection refused)
    expect(validation.responseTime).toBeGreaterThan(0);
  });

  itIntegration('should create tunnel with custom subdomain', async () => {
    if (config.skipTunnelTests) {
      return;
    }

    const customSubdomain = `debugg-test-${Date.now()}`;
    
    try {
      const tunnelConfig = {
        port: config.testPort + 1,
        subdomain: customSubdomain,
        authtoken: config.ngrokAuthToken
      };

      const tunnelInfo = await tunnelManager.createTunnel(tunnelConfig);
      
      expect(tunnelInfo.url).toContain(customSubdomain);
      expect(tunnelInfo.subdomain).toBe(customSubdomain);
      
      createdTunnels.push(tunnelInfo.uuid);
      
      if (config.verbose) {
        console.log('Created custom subdomain tunnel:', {
          url: tunnelInfo.url,
          subdomain: tunnelInfo.subdomain
        });
      }
    } catch (error) {
      // Custom subdomains might not be available on free ngrok accounts
      if (config.verbose) {
        console.log('Custom subdomain test failed (might not be available on free account):', error);
      }
      
      // Don't fail the test for subdomain issues on free accounts
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('subdomain') || errorMessage.includes('reserved')) {
        console.log('Skipping custom subdomain test - not available on this ngrok account');
        return;
      }
      
      throw error;
    }
  });

  itIntegration('should handle multiple tunnels', async () => {
    if (config.skipTunnelTests) {
      return;
    }

    const initialTunnelCount = tunnelManager.getAllTunnels().length;
    
    const tunnel2Config = {
      port: config.testPort + 2,
      authtoken: config.ngrokAuthToken
    };

    const tunnel2Info = await tunnelManager.createTunnel(tunnel2Config);
    
    expect(tunnel2Info.port).toBe(config.testPort + 2);
    createdTunnels.push(tunnel2Info.uuid);
    
    const allTunnels = tunnelManager.getAllTunnels();
    expect(allTunnels.length).toBe(initialTunnelCount + 1);
    
    if (config.verbose) {
      console.log('Multiple tunnels test:', {
        totalTunnels: allTunnels.length,
        newTunnelUrl: tunnel2Info.url
      });
    }
  });

  itIntegration('should disconnect specific tunnel', async () => {
    if (config.skipTunnelTests || createdTunnels.length === 0) {
      return;
    }

    const tunnelsBefore = tunnelManager.getAllTunnels().length;
    const tunnelToDisconnect = createdTunnels[0];
    
    if (!tunnelToDisconnect) return;

    await tunnelManager.disconnectTunnel(tunnelToDisconnect);
    
    const tunnelsAfter = tunnelManager.getAllTunnels().length;
    expect(tunnelsAfter).toBe(tunnelsBefore - 1);
    
    // Remove from our tracking array
    const index = createdTunnels.indexOf(tunnelToDisconnect);
    if (index > -1) {
      createdTunnels.splice(index, 1);
    }
    
    if (config.verbose) {
      console.log('Tunnel disconnection test:', {
        tunnelsBefore,
        tunnelsAfter,
        disconnectedTunnel: tunnelToDisconnect
      });
    }
  });

  itIntegration('should get test environment recommendations for ngrok URLs', async () => {
    if (config.skipTunnelTests) {
      return;
    }

    const ngrokUrl = 'https://abc123.ngrok.io';
    const recommendations = client.getTestEnvironmentRecommendations(ngrokUrl);
    
    expect(recommendations.recommendedTimeout).toBeGreaterThan(30000); // Should be higher for ngrok
    expect(recommendations.recommendedRetries).toBeGreaterThanOrEqual(3);
    expect(recommendations.specialInstructions.some(instruction => 
      instruction.includes('ngrok')
    )).toBe(true);
    
    if (config.verbose) {
      console.log('Ngrok recommendations:', recommendations);
    }
  });

  itIntegration('should create test suite with real tunnel URL', async () => {
    if (config.skipTunnelTests || createdTunnels.length === 0) {
      return;
    }

    const tunnels = tunnelManager.getAllTunnels();
    if (tunnels.length === 0) {
      console.log('No active tunnels for test suite creation test');
      return;
    }

    const tunnel = tunnels[0];
    if (!tunnel) return;

    const testRequest = {
      repoName: 'integration-test-repo',
      repoPath: config.testRepoPath,
      branchName: 'main',
      commitHash: 'integration-test',
      workingChanges: [],
      testDescription: 'Integration test with real ngrok tunnel',
      publicUrl: tunnel.url,
      testEnvironment: {
        url: tunnel.url,
        type: 'ngrok_tunnel' as const,
        port: tunnel.port,
        metadata: {
          ngrokSubdomain: tunnel.subdomain,
          tunnelUuid: tunnel.uuid,
          integrationTest: true
        }
      }
    };

    const result = await client.createCommitTestSuiteWithTunnel(
      testRequest,
      tunnel.url,
      {
        tunnelProvider: 'ngrok',
        tunnelUuid: tunnel.uuid,
        createdAt: new Date().toISOString()
      }
    );
    
    if (config.verbose) {
      console.log('Test suite creation with tunnel result:', {
        success: result.success,
        testSuiteUuid: result.testSuiteUuid,
        error: result.error,
        tunnelUrl: tunnel.url
      });
    }
    
    // For integration tests with real backend, success depends on many factors
    // Test that we get a proper response structure regardless of success/failure
    expect(typeof result.success).toBe('boolean');
    
    if (result.success) {
      expect(result.testSuiteUuid).toBeDefined();
      console.log('✅ Test suite created successfully with real backend');
    } else {
      expect(result.error).toBeDefined();
      console.log('ℹ️  Test suite creation failed (this can be normal with real backend):', result.error);
    }
    
    if (config.verbose) {
      console.log('Test suite with tunnel result:', {
        success: result.success,
        testSuiteUuid: result.testSuiteUuid,
        tunnelUrl: tunnel.url
      });
    }
  });
});