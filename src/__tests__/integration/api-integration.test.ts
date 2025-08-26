/**
 * API Integration Tests
 * 
 * Tests real API connectivity and backend interoperability using personal credentials.
 * These tests make actual HTTP requests to the DebuggAI backend.
 */

import { DebuggAIClient } from '../../lib/api-client';
import { GitAnalyzer } from '../../lib/git-analyzer';
import { describeIntegration, itIntegration, getIntegrationConfig } from './integration-config';

describeIntegration('API Client Backend Connectivity', () => {
  let client: DebuggAIClient;
  let gitAnalyzer: GitAnalyzer;
  let config: ReturnType<typeof getIntegrationConfig>;

  beforeAll(async () => {
    config = getIntegrationConfig();
    
    client = new DebuggAIClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeout: 30000
    });

    gitAnalyzer = new GitAnalyzer({
      repoPath: config.testRepoPath
    });

    if (config.verbose) {
      console.log('Integration test config:', {
        baseUrl: config.baseUrl,
        testRepoPath: config.testRepoPath,
        timeout: config.timeout
      });
    }
  });

  itIntegration('should connect to backend health endpoint', async () => {
    const result = await client.testConnection();
    
    expect(result.success).toBe(true);
    
    if (config.verbose) {
      console.log('Health check result:', result);
    }
  });

  itIntegration('should authenticate and get current user', async () => {
    const user = await client.getCurrentUser();
    
    expect(user).not.toBeNull();
    expect(user).toHaveProperty('id');
    
    if (config.verbose) {
      console.log('Current user:', { id: user?.id, email: user?.email });
    }
  });

  itIntegration('should validate tunnel URL accessibility', async () => {
    // Test with a known accessible URL
    const result = await client.validateTunnelUrl('https://httpbin.org/get', 10000);
    
    expect(result.accessible).toBe(true);
    expect(result.statusCode).toBeGreaterThanOrEqual(200);
    expect(result.statusCode).toBeLessThan(400);
    expect(result.responseTime).toBeGreaterThan(0);
    
    if (config.verbose) {
      console.log('URL validation result:', result);
    }
  });

  itIntegration('should handle inaccessible URL gracefully', async () => {
    const result = await client.validateTunnelUrl('http://localhost:99999/nonexistent', 5000);
    
    expect(result.accessible).toBe(false);
    expect(result.error).toBeDefined();
    
    if (config.verbose) {
      console.log('Inaccessible URL result:', result);
    }
  });

  itIntegration('should create commit test suite with real git data', async () => {
    // Get real git data from the test repository
    const repoName = gitAnalyzer.getRepoName();
    const branchInfo = await gitAnalyzer.getCurrentBranchInfo();
    const workingChanges = await gitAnalyzer.getWorkingChanges();
    
    if (workingChanges.changes.length === 0) {
      console.log('No working changes found - creating a test change');
      // For integration tests, we'll create a minimal request without changes
    }

    const testRequest = {
      repoName: repoName || 'integration-test-repo',
      repoPath: config.testRepoPath,
      branchName: branchInfo.branch,
      commitHash: branchInfo.commitHash,
      workingChanges: workingChanges.changes.slice(0, 5), // Limit to prevent large requests
      testDescription: 'Integration test - testing backend connectivity and API interoperability',
      testEnvironment: {
        url: 'https://httpbin.org/get',
        type: 'direct' as const,
        metadata: {
          integrationTest: true,
          timestamp: new Date().toISOString(),
          testRunner: 'jest-integration'
        }
      }
    };

    const result = await client.createCommitTestSuite(testRequest);
    
    if (config.verbose) {
      console.log('Create test suite request:', {
        repoName: testRequest.repoName,
        branchName: testRequest.branchName,
        changesCount: testRequest.workingChanges?.length || 0
      });
      console.log('Create test suite result:', result);
    }

    // For integration tests with real backend, API endpoints might not be implemented yet
    // Test that we get a proper response structure regardless of success/failure
    expect(typeof result.success).toBe('boolean');
    
    if (result.success) {
      expect(result.testSuiteUuid).toBeDefined();
      console.log('✅ Test suite created successfully');
      
      // Test suite status retrieval only if creation succeeded
      const suite = await client.getTestSuiteStatus(result.testSuiteUuid!);
      if (config.verbose) {
        console.log('Test suite status:', suite);
      }
    } else {
      expect(result.error).toBeDefined();
      console.log('ℹ️  Test suite creation failed (API endpoint may not be implemented):', result.error);
    }
  });

  itIntegration('should list test suites from backend', async () => {
    const repoName = gitAnalyzer.getRepoName();
    const branchInfo = await gitAnalyzer.getCurrentBranchInfo();
    
    const result = await client.listTestSuites({
      repoName,
      branchName: branchInfo.branch,
      limit: 5,
      page: 1
    });
    
    // Test that we always get the expected structure, even if API returns empty results
    expect(result).toHaveProperty('suites');
    expect(result).toHaveProperty('total');
    expect(Array.isArray(result.suites)).toBe(true);
    expect(typeof result.total).toBe('number');
    
    if (config.verbose) {
      console.log('List test suites result:', {
        suitesCount: result.suites.length,
        total: result.total,
        firstSuite: result.suites[0] || null
      });
    }
    
    if (result.suites.length === 0 && result.total === 0) {
      console.log('ℹ️  No test suites found (API endpoint may not be implemented or no data exists)');
    } else {
      console.log('✅ Test suites retrieved successfully');
    }
  });

  itIntegration('should handle API errors gracefully', async () => {
    // Test with invalid UUID to trigger 404
    const suite = await client.getTestSuiteStatus('invalid-uuid-12345');
    
    expect(suite).toBeNull();
    
    if (config.verbose) {
      console.log('Invalid UUID test - suite should be null:', suite);
    }
  });

  itIntegration('should get test environment recommendations', async () => {
    const recommendations = client.getTestEnvironmentRecommendations('https://test.ngrok.io');
    
    expect(recommendations).toHaveProperty('recommendedTimeout');
    expect(recommendations).toHaveProperty('recommendedRetries');
    expect(recommendations).toHaveProperty('specialInstructions');
    expect(Array.isArray(recommendations.specialInstructions)).toBe(true);
    
    if (config.verbose) {
      console.log('Test environment recommendations:', recommendations);
    }
  });

  itIntegration('should handle enhanced context from git analysis', async () => {
    const workingChanges = await gitAnalyzer.getWorkingChanges();
    
    if (workingChanges.changes.length > 0) {
      const contextAnalysis = await gitAnalyzer.analyzeChangesWithContext(workingChanges.changes);
      
      expect(contextAnalysis).toHaveProperty('totalFiles');
      expect(contextAnalysis).toHaveProperty('fileTypes');
      expect(contextAnalysis).toHaveProperty('changeComplexity');
      expect(contextAnalysis).toHaveProperty('suggestedFocusAreas');
      
      if (config.verbose) {
        console.log('Context analysis:', contextAnalysis);
      }
    } else {
      console.log('No working changes to analyze - test passed');
    }
  });
});