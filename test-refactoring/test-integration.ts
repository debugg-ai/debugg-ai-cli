#!/usr/bin/env ts-node
/**
 * End-to-end integration test
 * Tests the complete flow with real backend and tunnel
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as http from 'http';
import { E2EManager } from '../src/lib/e2e-manager';
import { TunnelService } from '../src/lib/tunnel-service';
import { CLIBackendClient } from '../src/backend/cli/client';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEBUGGAI_API_KEY = process.env.DEBUGGAI_API_KEY!;
const DEBUGGAI_BASE_URL = process.env.DEBUGGAI_BASE_URL || 'https://api.debugg.ai';
const NGROK_AUTH_TOKEN = process.env.NGROK_AUTH_TOKEN!;
const TEST_PORT = 3456;

async function createTestServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      console.log(`📥 Test server received request: ${req.method} ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Test Server</title></head>
        <body>
          <h1>Test Server Running</h1>
          <p>Time: ${new Date().toISOString()}</p>
        </body>
        </html>
      `);
    });

    server.listen(TEST_PORT, () => {
      console.log(`✅ Test server running on port ${TEST_PORT}`);
      resolve(server);
    });
  });
}

async function testEndToEnd() {
  console.log('🧪 Testing End-to-End Integration...\n');

  if (!DEBUGGAI_API_KEY || !NGROK_AUTH_TOKEN) {
    console.error('❌ Required environment variables not found');
    process.exit(1);
  }

  let server: http.Server | null = null;
  let tunnelService: TunnelService | null = null;

  try {
    // Step 1: Start test server
    console.log('📍 Step 1: Starting test server...');
    server = await createTestServer();
    console.log('');

    // Step 2: Create tunnel using backend token
    console.log('📍 Step 2: Setting up tunnel through backend...');

    // First, create an API client to get tunnel token
    const apiClient = new CLIBackendClient({
      apiKey: DEBUGGAI_API_KEY,
      baseUrl: DEBUGGAI_BASE_URL,
      repoPath: path.join(__dirname, '..')
    });

    await apiClient.initialize();
    console.log('   API client initialized');

    // Create a test suite to get a valid UUID
    console.log('   Creating test suite...');
    const suite = await apiClient.e2es.createE2eCommitSuite(
      'Integration test suite',
      {
        files: [{
          path: 'integration-test.js',
          status: 'modified',
          additions: 3,
          deletions: 1,
          patch: `@@ -1,3 +1,5 @@
+// Integration test
 function test() {
-  return false;
+  return true;
 }`
        }],
        commitHash: `integration-${Date.now()}`,
        commitMessage: 'Integration test commit',
        branchName: 'integration-test',
        repoName: 'debugg-ai-cli',
        generateTests: false
      }
    );

    if (!suite) {
      throw new Error('Failed to create test suite');
    }
    console.log(`   Suite created: ${suite.uuid}`);

    // Get tunnel token from backend
    const urlUuidSubdomain = `integration-test-${Date.now()}`;
    console.log(`   Requesting tunnel token for subdomain: ${urlUuidSubdomain}`);

    const transport = apiClient.getTransport();
    const tunnelTokenResult = await transport.post('api/v1/ngrok/token/', {
      commitSuiteUuid: suite.uuid,
      subdomain: urlUuidSubdomain
    });

    if (!tunnelTokenResult || !tunnelTokenResult.token) {
      throw new Error('Failed to get tunnel token from backend');
    }
    console.log(`   Got tunnel token from backend`);

    // Create tunnel using the backend-provided token
    tunnelService = new TunnelService({ verbose: true });
    const tunnelInfo = await tunnelService.createTunnel(
      TEST_PORT,
      tunnelTokenResult.subdomain,
      tunnelTokenResult.token
    );
    console.log(`✅ Tunnel created: ${tunnelInfo.url}\n`);

    // Step 3: Test with E2EManager
    console.log('📍 Step 3: Testing with E2EManager...');
    const testManager = new E2EManager({
      apiKey: DEBUGGAI_API_KEY,
      repoPath: path.join(__dirname, '..'),
      baseUrl: DEBUGGAI_BASE_URL,
      testOutputDir: path.join(__dirname, 'test-output'),
      tunnelUrl: tunnelInfo.url, // Pass the tunnel URL
      maxTestWaitTime: 30000
    });

    // Test server readiness check
    console.log('   Checking server readiness...');
    const isReady = await testManager.waitForServer(TEST_PORT, 5000);
    console.log(`   Server ready: ${isReady ? '✅' : '❌'}\n`);

    // Step 4: Run a simple test
    console.log('📍 Step 4: Running commit tests...');
    const result = await testManager.runCommitTests();

    if (result.success) {
      console.log('✅ Tests completed successfully!');
      if (result.suiteUuid) {
        console.log(`   Suite UUID: ${result.suiteUuid}`);
      }
      if (result.testFiles && result.testFiles.length > 0) {
        console.log(`   Generated ${result.testFiles.length} test files`);
      }
    } else {
      console.log(`❌ Tests failed: ${result.error}`);
    }
    console.log('');

    // Step 5: Cleanup
    console.log('📍 Step 5: Cleaning up...');
    if (tunnelService) {
      await tunnelService.cleanup();
      console.log('   Tunnel closed');
    }
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => {
          console.log('   Server stopped');
          resolve();
        });
      });
    }

    console.log('\n🎉 All integration tests passed!');

  } catch (error) {
    console.error('❌ Integration test failed:', error);

    // Cleanup on error
    if (tunnelService) {
      try {
        await tunnelService.cleanup();
      } catch (e) {
        console.error('Failed to cleanup tunnel:', e);
      }
    }
    if (server) {
      server.close();
    }

    process.exit(1);
  }
}

// Run the test
testEndToEnd().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});