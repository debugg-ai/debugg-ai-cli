// Test for the new CLI backend client
import { CLIBackendClient } from '../backend/cli/client';

// Mock environment variables for testing
const TEST_CONFIG = {
  apiKey: 'test-api-key-47c1f152f7',
  baseUrl: 'https://api.debugg.ai',
  repoPath: process.cwd() // Use current directory which is a valid git repo
};

describe('CLI Backend Client', () => {
  let client: CLIBackendClient;

  beforeEach(() => {
    client = new CLIBackendClient(TEST_CONFIG);
  });

  describe('initialization', () => {
    it('should create client with correct config', () => {
      expect(client).toBeDefined();
      const context = client.getContext();
      expect(context.repoPath).toBe(TEST_CONFIG.repoPath);
      // repoName and branchName will be populated after initialization
    });

    it('should not be initialized initially', () => {
      expect(client.isInitialized()).toBe(false);
    });
  });

  describe('context provider', () => {
    it('should have context provider', () => {
      const contextProvider = client.getContextProvider();
      expect(contextProvider).toBeDefined();
    });

    it('should handle path normalization', () => {
      const contextProvider = client.getContextProvider();
      const testPath = `${TEST_CONFIG.repoPath}/src/file.ts`;
      const result = contextProvider.normalizeFilePath(testPath);
      expect(result.relativePath).toBe('src/file.ts');
      expect(result.absolutePath).toBe(testPath);
    });
  });

  describe('services', () => {
    it('should have e2es service', () => {
      expect(client.e2es).toBeDefined();
      expect(typeof client.e2es.createE2eCommitSuite).toBe('function');
      expect(typeof client.e2es.getE2eCommitSuite).toBe('function');
    });

    it('should have users service', () => {
      expect(client.users).toBeDefined();
      expect(typeof client.users.getCurrentUser).toBe('function');
      expect(typeof client.users.getUserConfig).toBe('function');
    });
  });

  describe('transport', () => {
    it('should have transport with correct configuration', () => {
      const transport = client.getTransport();
      expect(transport).toBeDefined();
      expect(transport.getAuthorizationHeader()).toBe(`Token ${TEST_CONFIG.apiKey}`);
    });
  });

  describe('high-level methods', () => {
    it('should have createCommitTestSuite method', () => {
      expect(typeof client.createCommitTestSuite).toBe('function');
    });

    it('should have getCommitTestSuiteStatus method', () => {
      expect(typeof client.getCommitTestSuiteStatus).toBe('function');
    });

    it('should have waitForCommitTestSuiteCompletion method', () => {
      expect(typeof client.waitForCommitTestSuiteCompletion).toBe('function');
    });

    it('should have downloadArtifact method', () => {
      expect(typeof client.downloadArtifact).toBe('function');
    });
  });
});