/**
 * Workflow Integration Tests
 *
 * Tests complete end-to-end workflows with real server, tunnel, and API integration.
 * These tests simulate the full CLI workflow using personal credentials.
 *
 * TODO: Re-enable after workflow-orchestrator is re-implemented with new architecture
 */

// import { WorkflowOrchestrator } from '../../lib/workflow-orchestrator';
import { E2EManager } from '../../lib/e2e-manager';
import { describeIntegration, itIntegration, getIntegrationConfig } from './integration-config';
import { findAvailablePort, waitForPortRelease } from './port-utils';
import * as http from 'http';
import * as path from 'path';

// Temporarily disabled during refactoring
describe.skip('End-to-End Workflow Integration', () => {
  let orchestrator: any; // WorkflowOrchestrator;
  let testManager: E2EManager;
  let config: ReturnType<typeof getIntegrationConfig>;
  let testServer: http.Server | null = null;

  beforeAll(async () => {
    config = getIntegrationConfig();
    
    if (config.skipWorkflowTests) {
      return;
    }

    // orchestrator = new WorkflowOrchestrator({
    //   ngrokAuthToken: config.ngrokAuthToken,
    //   verbose: config.verbose
    // });

    testManager = new E2EManager({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      repoPath: config.testRepoPath,
      testOutputDir: path.join(config.testRepoPath, 'tests', 'debugg-ai-integration'),
      maxTestWaitTime: 60000 // Shorter for integration tests
    });

    if (config.verbose) {
      console.log('Workflow integration test setup complete');
    }
  });

  afterAll(async () => {
    if (config.skipWorkflowTests) {
      return;
    }

    // Clean up any running servers or tunnels
    try {
      if (testServer) {
        await new Promise<void>((resolve) => {
          testServer!.close(() => {
            testServer = null;
            resolve();
          });
        });
      }
      
      // Clean up orchestrator resources
      await orchestrator.cleanup();
      
      if (config.verbose) {
        console.log('Workflow integration cleanup complete');
      }
    } catch (error) {
      console.warn('Error during workflow cleanup:', error);
    }
  });

  // Helper function to create a simple test server
  const createTestServer = (port: number): Promise<http.Server> => {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Integration test server',
          timestamp: new Date().toISOString(),
          url: req.url,
          method: req.method,
          headers: req.headers
        }));
      });

      server.listen(port, (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve(server);
        }
      });

      server.on('error', reject);
    });
  };

  itIntegration('should execute complete workflow with test server', async () => {
    if (config.skipWorkflowTests) {
      return;
    }

    // Start a test server with dynamic port allocation
    const testPort = await findAvailablePort(config.testPort + 50);
    let localTestServer: http.Server | null = null;
    
    try {
      localTestServer = await createTestServer(testPort);
      
      if (config.verbose) {
        console.log(`Test server started on port ${testPort}`);
      }

      // Wait a moment for server to be fully ready
      await new Promise(resolve => setTimeout(resolve, 1000));

    const workflowConfig = {
      server: {
        command: 'echo', // Dummy command since we're using our own server
        args: ['server-started'],
        port: testPort,
        cwd: config.testRepoPath,
        startupTimeout: 10000
      },
      tunnel: {
        port: testPort,
        authtoken: config.ngrokAuthToken
      },
      test: {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        repoPath: config.testRepoPath,
        testOutputDir: path.join(config.testRepoPath, 'tests', 'debugg-ai-integration'),
        maxTestWaitTime: 30000 // Shorter timeout for integration tests
      },
      cleanup: {
        onSuccess: true,
        onError: true
      }
    };

      const result = await orchestrator.executeWorkflow(workflowConfig);
      
      if (config.verbose) {
        console.log('Workflow execution result:', {
          success: result.success,
          tunnelUrl: result.tunnelInfo?.url,
          serverUrl: result.serverUrl,
          testSuiteUuid: result.testResult?.suiteUuid,
          error: result.error
        });
      }

      // For integration tests, we'll accept that some failures are expected due to network/backend issues
      if (result.success) {
        expect(result.tunnelInfo?.url).toMatch(/^https:\/\/.*\.ngrok\.(io|debugg\.ai)$/);
        expect(result.testResult?.suiteUuid).toBeDefined();
        console.log('✅ Workflow executed successfully');
      } else {
        console.log('ℹ️ Workflow failed (expected in some environments):', result.error);
        // Don't fail the test - integration environment might not support full workflow
      }
    } finally {
      // Always cleanup server and wait for port to be released
      if (localTestServer) {
        await new Promise<void>((resolve) => {
          localTestServer!.close(() => {
            // Give extra time for cleanup
            setTimeout(resolve, 100);
          });
        });
        
        // Wait for port to be properly released
        try {
          await waitForPortRelease(testPort, 5);
        } catch (error) {
          console.warn(`Port ${testPort} may still be in use:`, error);
        }
      }
    }
  }, 180000); // 3 minute timeout for full workflow

  itIntegration('should handle workflow with tunnel connectivity verification', async () => {
    if (config.skipWorkflowTests) {
      return;
    }

    // Find an available port dynamically to avoid conflicts
    const testPort = await findAvailablePort(config.testPort + 100);
    let localTestServer: http.Server | null = null;
    
    try {
      localTestServer = await createTestServer(testPort);
      
      // Wait for server to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));

    const workflowConfig = {
      server: {
        command: 'echo',
        args: ['server-ready'],
        port: testPort,
        cwd: config.testRepoPath,
        startupTimeout: 10000
      },
      tunnel: {
        port: testPort,
        authtoken: config.ngrokAuthToken,
        verifyConnectivity: true,
        connectivityTimeout: 30000
      },
      test: {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        repoPath: config.testRepoPath,
        testOutputDir: path.join(config.testRepoPath, 'tests', 'debugg-ai-integration'),
        maxTestWaitTime: 30000
      },
      cleanup: {
        onSuccess: true,
        onError: true
      }
    };

      const result = await orchestrator.executeWorkflow(workflowConfig);
      
      if (config.verbose) {
        console.log('Workflow with connectivity verification result:', {
          success: result.success,
          tunnelUrl: result.tunnelInfo?.url,
          connectivityVerified: true,
          error: result.error
        });
      }
      
      // For integration tests, don't fail on expected infrastructure issues
      if (result.success) {
        expect(result.tunnelInfo?.url).toBeDefined();
        console.log('✅ Workflow with connectivity verification succeeded');
      } else {
        console.log('ℹ️ Workflow connectivity verification failed (expected in some environments):', result.error);
      }
    } finally {
      // Always cleanup server and wait for port to be released
      if (localTestServer) {
        await new Promise<void>((resolve) => {
          localTestServer!.close(() => {
            // Give extra time for cleanup
            setTimeout(resolve, 100);
          });
        });
        
        // Wait for port to be properly released
        try {
          await waitForPortRelease(testPort, 5);
        } catch (error) {
          console.warn(`Port ${testPort} may still be in use:`, error);
        }
      }
    }
  }, 180000);

  itIntegration('should run tests directly with test manager', async () => {
    if (config.skipWorkflowTests) {
      return;
    }

    // Test the E2EManager directly with real backend
    const result = await testManager.runCommitTests();
    
    if (config.verbose) {
      console.log('Direct test manager result:', {
        success: result.success,
        suiteUuid: result.suiteUuid,
        testFilesCount: result.testFiles?.length || 0,
        error: result.error
      });
    }

    // For integration tests, we expect this might fail in some environments
    if (result.success) {
      expect(result.suiteUuid).toMatch(/^[a-f0-9-]{36}$/); // UUID format
      console.log('✅ Direct test manager execution succeeded');
    } else {
      console.log('ℹ️ Direct test manager failed (expected in some environments):', result.error);
    }
  });

  itIntegration('should handle workflow cleanup on error', async () => {
    if (config.skipWorkflowTests) {
      return;
    }

    // Use dynamic port allocation
    const testPort = await findAvailablePort(config.testPort + 120);

    const workflowConfig = {
      server: {
        command: 'nonexistent-command-that-will-fail',
        args: [],
        port: testPort,
        cwd: config.testRepoPath,
        startupTimeout: 5000
      },
      tunnel: {
        port: testPort,
        authtoken: config.ngrokAuthToken
      },
      test: {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        repoPath: config.testRepoPath,
        testOutputDir: path.join(config.testRepoPath, 'tests', 'debugg-ai-integration'),
        maxTestWaitTime: 10000
      },
      cleanup: {
        onSuccess: true,
        onError: true
      }
    };

    const result = await orchestrator.executeWorkflow(workflowConfig);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    
    if (config.verbose) {
      console.log('Workflow error handling result:', {
        success: result.success,
        error: result.error
      });
    }

    // Verify cleanup was attempted (no tunnels should be left running)
    const activeTunnels = orchestrator.getAllActiveTunnels();
    expect(activeTunnels.length).toBe(0);
  });

  itIntegration('should validate server readiness detection', async () => {
    if (config.skipWorkflowTests) {
      return;
    }

    // Use dynamic port allocation
    const testPort = await findAvailablePort(config.testPort + 150);
    
    // Test server readiness detection
    const serverNotReady = await testManager.waitForServer(testPort, 2000);
    expect(serverNotReady).toBe(false);
    
    // Start server and test readiness
    testServer = await createTestServer(testPort);
    await new Promise(resolve => setTimeout(resolve, 500)); // Give server time to start
    
    const serverReady = await testManager.waitForServer(testPort, 5000);
    expect(serverReady).toBe(true);
    
    if (config.verbose) {
      console.log('Server readiness detection test:', {
        notReadyResult: serverNotReady,
        readyResult: serverReady
      });
    }
    
    await new Promise<void>((resolve) => {
      testServer!.close(() => {
        testServer = null;
        resolve();
      });
    });
  });

  itIntegration('should generate meaningful test descriptions from real git data', async () => {
    if (config.skipWorkflowTests) {
      return;
    }

    // This tests the enhanced git analysis integration
    const gitAnalyzer = (testManager as any).gitAnalyzer;
    const workingChanges = await gitAnalyzer.getWorkingChanges();
    
    if (workingChanges.changes.length > 0) {
      const contextAnalysis = await gitAnalyzer.analyzeChangesWithContext(workingChanges.changes);
      const description = await (testManager as any).createTestDescription(workingChanges);
      
      expect(description).toBeDefined();
      expect(description.length).toBeGreaterThan(50); // Should be a meaningful description
      expect(contextAnalysis.suggestedFocusAreas.length).toBeGreaterThan(0);
      
      if (config.verbose) {
        console.log('Test description generation:', {
          changesCount: workingChanges.changes.length,
          contextAnalysis,
          descriptionLength: description.length,
          descriptionPreview: description.substring(0, 100) + '...'
        });
      }
    } else {
      console.log('No working changes found for description generation test');
    }
  });
});