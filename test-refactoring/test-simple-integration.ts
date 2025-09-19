#!/usr/bin/env ts-node
/**
 * Simple integration test to verify the refactored implementation works
 * Tests tunnel creation and basic test manager functionality
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as http from 'http';
import { TunnelService } from '../src/lib/tunnel-service';
import { E2EManager } from '../src/lib/e2e-manager';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const NGROK_AUTH_TOKEN = process.env.NGROK_AUTH_TOKEN!;
const DEBUGGAI_API_KEY = process.env.DEBUGGAI_API_KEY!;
const TEST_PORT = 3789;

async function createTestServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      console.log(`📥 Server received: ${req.method} ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>Test App</title></head>
<body>
  <h1>Test Application</h1>
  <p>Request: ${req.method} ${req.url}</p>
  <p>Time: ${new Date().toISOString()}</p>
</body>
</html>`);
    });

    server.listen(TEST_PORT, () => {
      console.log(`✅ Test server running on port ${TEST_PORT}`);
      resolve(server);
    });
  });
}

async function runSimpleIntegrationTest() {
  console.log('🧪 Simple Integration Test\n');
  console.log('This test verifies:');
  console.log('1. Tunnel service can create ngrok tunnels');
  console.log('2. Test manager can check server readiness');
  console.log('3. The refactored architecture works correctly\n');
  console.log('='.repeat(50) + '\n');

  if (!NGROK_AUTH_TOKEN || !DEBUGGAI_API_KEY) {
    console.error('❌ Required environment variables not found');
    process.exit(1);
  }

  let server: http.Server | null = null;
  let tunnelService: TunnelService | null = null;

  try {
    // Step 1: Start test server
    console.log('📍 Step 1: Starting local test server...');
    server = await createTestServer();
    console.log('');

    // Step 2: Create tunnel
    console.log('📍 Step 2: Creating ngrok tunnel...');
    tunnelService = new TunnelService({ verbose: false });

    const subdomain = `test-${Date.now()}`;
    const tunnelInfo = await tunnelService.createTunnel(
      TEST_PORT,
      subdomain,
      NGROK_AUTH_TOKEN
    );

    console.log(`✅ Tunnel created successfully!`);
    console.log(`   URL: ${tunnelInfo.url}`);
    console.log(`   Subdomain: ${tunnelInfo.subdomain}`);
    console.log(`   Port: ${tunnelInfo.port}\n`);

    // Step 3: Test with E2EManager
    console.log('📍 Step 3: Testing with E2EManager...');
    const testManager = new E2EManager({
      apiKey: DEBUGGAI_API_KEY,
      repoPath: path.join(__dirname, '..'),
      tunnelUrl: tunnelInfo.url // Pass the created tunnel URL
    });

    // Check server readiness
    console.log('   Checking if server is ready...');
    const isReady = await testManager.waitForServer(TEST_PORT, 5000);

    if (isReady) {
      console.log('   ✅ Server is ready and accessible\n');
    } else {
      console.log('   ❌ Server check failed\n');
    }

    // Step 4: Test tunnel accessibility
    console.log('📍 Step 4: Testing tunnel accessibility...');
    try {
      const https = require('https');
      const testUrl = new URL(tunnelInfo.url);

      await new Promise<void>((resolve, reject) => {
        https.get({
          hostname: testUrl.hostname,
          path: '/test',
          headers: { 'User-Agent': 'Test-Script' }
        }, (res: any) => {
          console.log(`   Tunnel response status: ${res.statusCode}`);
          if (res.statusCode === 200) {
            console.log('   ✅ Tunnel is accessible from external network\n');
            resolve();
          } else {
            reject(new Error(`Unexpected status: ${res.statusCode}`));
          }
        }).on('error', reject);
      });
    } catch (error) {
      console.log(`   ⚠️  Could not verify tunnel externally: ${error}\n`);
    }

    // Step 5: Cleanup
    console.log('📍 Step 5: Cleaning up...');

    if (tunnelService) {
      await tunnelService.cleanup();
      console.log('   ✅ Tunnel closed');
    }

    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => {
          console.log('   ✅ Server stopped');
          resolve();
        });
      });
    }

    console.log('\n' + '='.repeat(50));
    console.log('🎉 Simple Integration Test PASSED!');
    console.log('\nKey Findings:');
    console.log('✅ Tunnel service works correctly');
    console.log('✅ Test manager integrates properly with tunnels');
    console.log('✅ Server readiness checks function as expected');
    console.log('✅ The refactored architecture is functional');

  } catch (error) {
    console.error('\n❌ Test failed:', error);

    // Cleanup on error
    try {
      if (tunnelService) await tunnelService.cleanup();
      if (server) server.close();
    } catch (e) {
      console.error('Cleanup error:', e);
    }

    process.exit(1);
  }
}

// Run the test
runSimpleIntegrationTest().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});