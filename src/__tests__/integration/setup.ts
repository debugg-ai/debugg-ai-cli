/**
 * Integration Test Setup
 * 
 * This file is loaded before any integration tests run to ensure
 * environment variables are loaded from .env file.
 */

import { config } from 'dotenv';
import * as path from 'path';

// Load environment variables from .env file at project root
const envPath = path.resolve(process.cwd(), '.env');
const result = config({ path: envPath });

// Only log in verbose mode and if .env was loaded
if (process.env.INTEGRATION_VERBOSE === 'true' && result.parsed) {
  const apiKey = process.env.DEBUGGAI_API_KEY;
  const ngrokToken = process.env.NGROK_AUTH_TOKEN;
  
  // Check if credentials are placeholders
  const isApiKeyPlaceholder = apiKey && (
    apiKey.includes('your-') || 
    apiKey.includes('placeholder') ||
    apiKey === 'your-actual-api-key-here'
  );
  
  const isNgrokTokenPlaceholder = ngrokToken && (
    ngrokToken.includes('your-') || 
    ngrokToken.includes('placeholder') ||
    ngrokToken === 'your-actual-ngrok-token-here'
  );

  console.log('🔧 Loaded .env file for integration tests:', envPath);
  console.log('📦 Environment variables:', {
    DEBUGGAI_API_KEY: !apiKey ? 'not set' : isApiKeyPlaceholder ? 'placeholder' : '***set***',
    NGROK_AUTH_TOKEN: !ngrokToken ? 'not set' : isNgrokTokenPlaceholder ? 'placeholder' : '***set***',
    DEBUGGAI_BASE_URL: process.env.DEBUGGAI_BASE_URL || 'default',
  });
  
  if (isApiKeyPlaceholder || isNgrokTokenPlaceholder) {
    console.log('⚠️  Integration tests will be skipped - replace placeholder values in .env file with real credentials');
  }
}