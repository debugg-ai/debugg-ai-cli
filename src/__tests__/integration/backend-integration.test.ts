// Integration test for CLI backend services against real API
import { CLIBackendClient } from '../../backend/cli/client';
import { getIntegrationConfig, describeBackend } from './integration-config';

describeBackend('CLI Backend Integration', () => {
  let client: CLIBackendClient;
  let config: any;

  beforeAll(async () => {
    config = getIntegrationConfig();
    
    if (!config.apiKey || !config.baseUrl) {
      console.warn('⚠️  Skipping backend integration tests - missing API credentials');
      return;
    }

    client = new CLIBackendClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      repoPath: config.testRepoPath,
      timeout: 30000
    });
  });

  describe('Authentication', () => {
    it('should successfully authenticate with real API', async () => {
      if (!client) {
        console.warn('⚠️  Skipping test - no API credentials');
        return;
      }

      console.log('🔐 Testing authentication with backend services...');
      
      // Initialize the client
      await client.initialize();
      
      // Test authentication
      const authResult = await client.testAuthentication();
      
      expect(authResult.success).toBe(true);
      expect(authResult.user).toBeDefined();
      
      console.log(`✅ Authentication successful for user: ${authResult.user?.email || authResult.user?.id}`);
    }, 30000);

    it('should get user configuration via backend services', async () => {
      if (!client) {
        console.warn('⚠️  Skipping test - no API credentials');
        return;
      }

      console.log('👤 Testing user configuration retrieval...');
      
      const userConfig = await client.users.getUserConfig();
      
      expect(userConfig).toBeDefined();
      console.log(`✅ User config retrieved successfully`);
    }, 15000);
  });

  describe('E2E Services', () => {
    it('should list E2E commit suites via backend services', async () => {
      if (!client) {
        console.warn('⚠️  Skipping test - no API credentials');
        return;
      }

      console.log('📋 Testing E2E commit suites listing...');
      
      const commitSuites = await client.e2es.listE2eCommitSuites({ limit: 5 });
      
      // Should either get results or return empty list (not null for errors)
      expect(commitSuites).toBeDefined();
      expect(Array.isArray(commitSuites?.results)).toBe(true);
      
      console.log(`✅ Listed ${commitSuites?.results?.length || 0} commit suites`);
    }, 15000);

    it('should create and retrieve commit suite using proven backend logic', async () => {
      if (!client) {
        console.warn('⚠️  Skipping test - no API credentials');
        return;
      }

      console.log('🧪 Testing commit suite creation with backend services...');
      
      // Create a test commit suite using the high-level method
      const createResponse = await client.createCommitTestSuite({
        repoName: 'debugg-ai/cli-test',
        repoPath: config.testRepoPath,
        branchName: 'main',
        commitHash: 'abc123test',
        workingChanges: [
          {
            status: 'M',
            file: 'src/test-file.ts',
            diff: 'sample diff for integration test'
          }
        ],
        testDescription: 'Integration test suite created via CLI backend services'
      });

      expect(createResponse.success).toBe(true);
      expect(createResponse.testSuiteUuid).toBeDefined();
      
      console.log(`✅ Created commit suite: ${createResponse.testSuiteUuid}`);
      
      if (createResponse.testSuiteUuid) {
        // Retrieve the created suite
        const retrievedSuite = await client.getCommitTestSuiteStatus(createResponse.testSuiteUuid);
        
        expect(retrievedSuite).toBeDefined();
        expect(retrievedSuite.uuid).toBe(createResponse.testSuiteUuid);
        
        console.log(`✅ Retrieved commit suite: ${retrievedSuite.uuid} with status: ${retrievedSuite.status}`);
      }
    }, 30000);
  });

  describe('Transport Layer', () => {
    it('should use proper authentication headers', async () => {
      if (!client) {
        console.warn('⚠️  Skipping test - no API credentials');
        return;
      }

      const transport = client.getTransport();
      const authHeader = transport.getAuthorizationHeader();
      
      expect(authHeader).toBe(`Token ${config.apiKey}`);
      console.log('✅ Transport using correct Token-based authentication');
    });

    it('should handle API errors gracefully', async () => {
      if (!client) {
        console.warn('⚠️  Skipping test - no API credentials');
        return;
      }

      console.log('⚠️  Testing error handling...');
      
      // Try to get a non-existent commit suite
      const result = await client.getCommitTestSuiteStatus('non-existent-uuid-12345');
      
      // Should return null for not found, not throw error
      expect(result).toBeNull();
      
      console.log('✅ Error handling works correctly');
    });
  });

  describe('Context Provider', () => {
    it('should provide correct project context', async () => {
      if (!client) {
        console.warn('⚠️  Skipping test - no API credentials');
        return;
      }

      await client.initialize();
      
      const contextProvider = client.getContextProvider();
      const context = await contextProvider.getProjectContext();
      
      expect(context.repoName).toBeDefined();
      expect(context.repoPath).toBe(config.testRepoPath);
      expect(context.branchName).toBeDefined();
      
      console.log(`✅ Context: ${context.repoName} on ${context.branchName}`);
    });
  });
});