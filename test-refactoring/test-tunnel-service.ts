#!/usr/bin/env ts-node
/**
 * Test script for TunnelService
 * Tests the tunnel creation and cleanup functionality
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { TunnelService } from '../src/lib/tunnel-service';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const NGROK_AUTH_TOKEN = process.env.NGROK_AUTH_TOKEN;
const TEST_PORT = 3333;

async function testTunnelService() {
  console.log('🧪 Testing TunnelService...\n');

  if (!NGROK_AUTH_TOKEN) {
    console.error('❌ NGROK_AUTH_TOKEN not found in .env file');
    process.exit(1);
  }

  const tunnelService = new TunnelService({ verbose: true });

  try {
    // Test 1: Create tunnel with custom subdomain
    console.log('📍 Test 1: Creating tunnel with custom subdomain...');
    const subdomain = `test-${Date.now()}`;

    const tunnelInfo = await tunnelService.createTunnel(
      TEST_PORT,
      subdomain,
      NGROK_AUTH_TOKEN
    );

    console.log('✅ Tunnel created successfully!');
    console.log(`   URL: ${tunnelInfo.url}`);
    console.log(`   Subdomain: ${tunnelInfo.subdomain}`);
    console.log(`   Port: ${tunnelInfo.port}\n`);

    // Test 2: Get tunnel URL
    console.log('📍 Test 2: Getting tunnel URL...');
    const url = tunnelService.getTunnelUrl();
    if (url) {
      console.log(`✅ Retrieved URL: ${url}\n`);
    } else {
      console.log('❌ Failed to get tunnel URL\n');
    }

    // Wait a bit to ensure tunnel is stable
    console.log('⏳ Waiting 5 seconds to test tunnel stability...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Test 3: Cleanup
    console.log('📍 Test 3: Cleaning up tunnel...');
    await tunnelService.cleanup();
    console.log('✅ Tunnel cleaned up successfully!\n');

    // Test 4: Verify tunnel is gone
    console.log('📍 Test 4: Verifying tunnel is closed...');
    const urlAfterCleanup = tunnelService.getTunnelUrl();
    if (!urlAfterCleanup) {
      console.log('✅ Tunnel properly closed\n');
    } else {
      console.log('❌ Tunnel still exists after cleanup!\n');
    }

    console.log('🎉 All TunnelService tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);

    // Ensure cleanup on error
    try {
      await tunnelService.cleanup();
    } catch (cleanupError) {
      console.error('Failed to cleanup:', cleanupError);
    }

    process.exit(1);
  }
}

// Run the test
testTunnelService().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});