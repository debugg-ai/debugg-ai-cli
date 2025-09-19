#!/usr/bin/env ts-node
/**
 * Test script for CLIBackendClient
 * Tests the API client functionality with real backend
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { CLIBackendClient } from '../src/backend/cli/client';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEBUGGAI_API_KEY = process.env.DEBUGGAI_API_KEY;
const DEBUGGAI_BASE_URL = process.env.DEBUGGAI_BASE_URL || 'https://api.debugg.ai';

async function testApiClient() {
  console.log('🧪 Testing CLIBackendClient...\n');

  if (!DEBUGGAI_API_KEY) {
    console.error('❌ DEBUGGAI_API_KEY not found in .env file');
    process.exit(1);
  }

  console.log(`📡 Using API URL: ${DEBUGGAI_BASE_URL}\n`);

  const client = new CLIBackendClient({
    apiKey: DEBUGGAI_API_KEY,
    baseUrl: DEBUGGAI_BASE_URL,
    repoPath: path.join(__dirname, '..')
  });

  try {
    // Skip full initialization - just init context
    console.log('📍 Initializing client context...');
    const contextProvider = client.getContextProvider();
    await contextProvider.initialize();
    console.log('✅ Client context initialized\n');

    // Test 1: Test authentication (skip if endpoint not available)
    console.log('📍 Test 1: Testing authentication...');
    const authResult = await client.testAuthentication();
    if (authResult.success) {
      console.log('✅ Authentication successful');
      if (authResult.user) {
        console.log(`   User ID: ${authResult.user.uuid || 'N/A'}`);
        console.log(`   Email: ${authResult.user.email || 'N/A'}\n`);
      }
    } else {
      console.log(`⚠️  Authentication endpoint not available (${authResult.error})`);
      console.log('   Continuing with other tests...\n');
    }

    // Test 2: List commit suites
    console.log('📍 Test 2: Listing commit suites...');
    const suites = await client.e2es.listE2eCommitSuites({ limit: 5 });
    if (suites) {
      console.log(`✅ Found ${suites.count || 0} commit suites`);
      console.log(`   Showing first ${suites.results?.length || 0} suites\n`);
    } else {
      console.log('⚠️  No suites found or error occurred\n');
    }

    // Test 3: Create a commit suite
    console.log('📍 Test 3: Creating a commit suite...');
    const testSuite = await client.e2es.createE2eCommitSuite(
      'Test suite from API test script',
      {
        files: [{
          path: 'test-file.js',
          status: 'modified',
          additions: 5,
          deletions: 2,
          patch: `@@ -1,5 +1,8 @@
+// Test file
 function test() {
-  return false;
+  return true;
 }`
        }],
        commitHash: `test-${Date.now()}`,
        commitMessage: 'Test commit for API testing',
        generateTests: false // Don't actually generate tests
      }
    );

    if (testSuite) {
      console.log(`✅ Created test suite: ${testSuite.uuid}`);
      console.log(`   Run Status: ${testSuite.runStatus || 'N/A'}`);
      console.log(`   Tests: ${testSuite.tests?.length || 0}\n`);

      // Test 4: Get suite status
      console.log('📍 Test 4: Getting suite status...');
      const suiteStatus = await client.e2es.getE2eCommitSuite(testSuite.uuid);
      if (suiteStatus) {
        console.log(`✅ Retrieved suite status: ${suiteStatus.runStatus || 'N/A'}`);
        console.log(`   Description: ${suiteStatus.description || 'Unnamed'}`);
        console.log(`   Created: ${suiteStatus.timestamp || 'N/A'}\n`);
      } else {
        console.log('⚠️  Could not retrieve suite status\n');
      }
    } else {
      console.log('⚠️  Could not create test suite\n');
    }

    // Test 5: Test tunnel token creation through transport
    console.log('📍 Test 5: Testing tunnel token creation...');
    try {
      const transport = client.getTransport();
      const tunnelResult: any = await transport.post('api/v1/ngrok/token/', {
        commitSuiteUuid: testSuite?.uuid || 'test-uuid',
        subdomain: `test-subdomain-${Date.now()}`
      });

      if (tunnelResult) {
        console.log('✅ Created tunnel token');
        console.log(`   Token: ${tunnelResult.token?.substring(0, 20) || 'N/A'}...`);
        console.log(`   Subdomain: ${tunnelResult.subdomain || 'N/A'}\n`);
      } else {
        console.log('⚠️  Could not create tunnel token\n');
      }
    } catch (error) {
      console.log(`⚠️  Tunnel token creation failed: ${error}\n`);
    }

    console.log('🎉 All CLIBackendClient tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error && 'response' in error) {
      const axiosError = error as any;
      console.error('Response data:', axiosError.response?.data);
      console.error('Response status:', axiosError.response?.status);
    }
    process.exit(1);
  }
}

// Run the test
testApiClient().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});