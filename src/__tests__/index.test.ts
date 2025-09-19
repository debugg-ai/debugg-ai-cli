import * as indexModule from '../index';
import { E2EManager } from '../lib/e2e-manager';

// Mock dependencies
jest.mock('../lib/e2e-manager');

const MockedE2EManager = E2EManager as jest.MockedClass<typeof E2EManager>;

describe('Index Module', () => {
  describe('exports', () => {
    it('should export all main classes', () => {
      expect(indexModule.CLIBackendClient).toBeDefined();
      expect(indexModule.GitAnalyzer).toBeDefined();
      expect(indexModule.E2EManager).toBeDefined();
    });

    it('should export CLI backend client', () => {
      // These are TypeScript types, so we can't test them at runtime
      // but we can verify the module structure is correct
      expect(typeof indexModule.CLIBackendClient).toBe('function');
    });

    it('should export git analyzer types', () => {
      expect(typeof indexModule.GitAnalyzer).toBe('function');
    });

    it('should export E2E manager types', () => {
      expect(typeof indexModule.E2EManager).toBe('function');
    });

    it('should export DEFAULT_CONFIG constants', () => {
      expect(indexModule.DEFAULT_CONFIG).toBeDefined();
      expect(indexModule.DEFAULT_CONFIG.BASE_URL).toBe('https://api.debugg.ai');
      expect(indexModule.DEFAULT_CONFIG.TEST_OUTPUT_DIR).toBe('tests/debugg-ai');
      expect(indexModule.DEFAULT_CONFIG.SERVER_TIMEOUT).toBe(30000);
      expect(indexModule.DEFAULT_CONFIG.MAX_TEST_WAIT_TIME).toBe(600000);
      expect(indexModule.DEFAULT_CONFIG.POLL_INTERVAL).toBe(5000);
      expect(indexModule.DEFAULT_CONFIG.DEFAULT_SERVER_PORT).toBe(3000);
      expect(indexModule.DEFAULT_CONFIG.DEFAULT_SERVER_WAIT_TIME).toBe(60000);
    });

    it('should export ENV_VARS constants', () => {
      expect(indexModule.ENV_VARS).toBeDefined();
      expect(indexModule.ENV_VARS.API_KEY).toBe('DEBUGGAI_API_KEY');
      expect(indexModule.ENV_VARS.BASE_URL).toBe('DEBUGGAI_BASE_URL');
      expect(indexModule.ENV_VARS.GITHUB_SHA).toBe('GITHUB_SHA');
      expect(indexModule.ENV_VARS.GITHUB_REF_NAME).toBe('GITHUB_REF_NAME');
      expect(indexModule.ENV_VARS.GITHUB_HEAD_REF).toBe('GITHUB_HEAD_REF');
    });

    it('should have config objects with expected values', () => {
      // Test that config objects exist and have expected structure
      expect(indexModule.DEFAULT_CONFIG).toMatchObject({
        BASE_URL: 'https://api.debugg.ai',
        TEST_OUTPUT_DIR: 'tests/debugg-ai',
        SERVER_TIMEOUT: 30000,
        MAX_TEST_WAIT_TIME: 600000,
        POLL_INTERVAL: 5000,
        DEFAULT_SERVER_PORT: 3000,
        DEFAULT_SERVER_WAIT_TIME: 60000
      });

      expect(indexModule.ENV_VARS).toMatchObject({
        API_KEY: 'DEBUGGAI_API_KEY',
        BASE_URL: 'DEBUGGAI_BASE_URL',
        GITHUB_SHA: 'GITHUB_SHA',
        GITHUB_REF_NAME: 'GITHUB_REF_NAME',
        GITHUB_HEAD_REF: 'GITHUB_HEAD_REF'
      });
    });
  });

  describe('runDebuggAITests function', () => {
    let mockE2EManager: jest.Mocked<E2EManager>;

    beforeEach(() => {
      jest.clearAllMocks();
      
      mockE2EManager = {
        waitForServer: jest.fn(),
        runCommitTests: jest.fn()
      } as any;
      
      MockedE2EManager.mockImplementation(() => mockE2EManager);
    });

    it('should run tests successfully with minimal options', async () => {
      const options = {
        apiKey: 'test-api-key'
      };

      mockE2EManager.runCommitTests.mockResolvedValue({
        success: true,
        suiteUuid: 'suite-123',
        testFiles: ['/path/to/test.spec.js']
      });

      const result = await indexModule.runDebuggAITests(options);

      expect(MockedE2EManager).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: 'test-api-key',
        repoPath: process.cwd(),
        baseUrl: 'https://api.debugg.ai',
        testOutputDir: 'tests/debugg-ai',
        maxTestWaitTime: 600000
      }));

      expect(result).toEqual({
        success: true,
        suiteUuid: 'suite-123',
        testFiles: ['/path/to/test.spec.js']
      });
    });

    it('should use custom options when provided', async () => {
      const options = {
        apiKey: 'test-api-key',
        repoPath: '/custom/repo',
        baseUrl: 'https://custom.api.com',
        testOutputDir: 'custom/tests',
        maxTestWaitTime: 900000
      };

      mockE2EManager.runCommitTests.mockResolvedValue({
        success: true,
        suiteUuid: 'suite-456'
      });

      const result = await indexModule.runDebuggAITests(options);

      expect(MockedE2EManager).toHaveBeenCalledWith(expect.objectContaining({
        apiKey: 'test-api-key',
        repoPath: '/custom/repo',
        baseUrl: 'https://custom.api.com',
        testOutputDir: 'custom/tests',
        maxTestWaitTime: 900000
      }));

      expect(result.success).toBe(true);
      expect(result.suiteUuid).toBe('suite-456');
    });

    it('should wait for server when requested', async () => {
      const options = {
        apiKey: 'test-api-key',
        waitForServer: true,
        serverPort: 4000
      };

      mockE2EManager.waitForServer.mockResolvedValue(true);
      mockE2EManager.runCommitTests.mockResolvedValue({
        success: true,
        suiteUuid: 'suite-789'
      });

      const result = await indexModule.runDebuggAITests(options);

      expect(mockE2EManager.waitForServer).toHaveBeenCalledWith(4000, 60000);
      expect(mockE2EManager.runCommitTests).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should use default server port when not specified', async () => {
      const options = {
        apiKey: 'test-api-key',
        waitForServer: true
      };

      mockE2EManager.waitForServer.mockResolvedValue(true);
      mockE2EManager.runCommitTests.mockResolvedValue({
        success: true,
        suiteUuid: 'suite-default'
      });

      await indexModule.runDebuggAITests(options);

      expect(mockE2EManager.waitForServer).toHaveBeenCalledWith(3000, 60000);
    });

    it('should fail when server does not start', async () => {
      const options = {
        apiKey: 'test-api-key',
        waitForServer: true,
        serverPort: 5000
      };

      mockE2EManager.waitForServer.mockResolvedValue(false);

      const result = await indexModule.runDebuggAITests(options);

      expect(result).toEqual({
        success: false,
        error: 'Server on port 5000 did not start in time'
      });

      expect(mockE2EManager.runCommitTests).not.toHaveBeenCalled();
    });

    it('should handle test execution failure', async () => {
      const options = {
        apiKey: 'test-api-key'
      };

      mockE2EManager.runCommitTests.mockResolvedValue({
        success: false,
        error: 'Test execution failed'
      });

      const result = await indexModule.runDebuggAITests(options);

      expect(result).toEqual({
        success: false,
        error: 'Test execution failed'
      });
    });

    it('should return partial results when available', async () => {
      const options = {
        apiKey: 'test-api-key'
      };

      mockE2EManager.runCommitTests.mockResolvedValue({
        success: true,
        suiteUuid: 'suite-partial',
        testFiles: []
      });

      const result = await indexModule.runDebuggAITests(options);

      expect(result).toEqual({
        success: true,
        suiteUuid: 'suite-partial',
        testFiles: []
      });
    });

    it('should handle missing optional result properties', async () => {
      const options = {
        apiKey: 'test-api-key'
      };

      mockE2EManager.runCommitTests.mockResolvedValue({
        success: true
        // Missing suiteUuid and testFiles
      });

      const result = await indexModule.runDebuggAITests(options);

      expect(result).toEqual({
        success: true
      });
    });

    it('should create response object with all available properties', async () => {
      const options = {
        apiKey: 'test-api-key'
      };

      mockE2EManager.runCommitTests.mockResolvedValue({
        success: true,
        suiteUuid: 'suite-complete',
        testFiles: ['/test1.spec.js', '/test2.spec.js']
      });

      const result = await indexModule.runDebuggAITests(options);

      expect(result).toEqual({
        success: true,
        suiteUuid: 'suite-complete',
        testFiles: ['/test1.spec.js', '/test2.spec.js']
      });
    });

    it('should include error in response when present', async () => {
      const options = {
        apiKey: 'test-api-key'
      };

      mockE2EManager.runCommitTests.mockResolvedValue({
        success: false,
        error: 'Something went wrong',
        suiteUuid: 'partial-suite'
      });

      const result = await indexModule.runDebuggAITests(options);

      expect(result).toEqual({
        success: false,
        suiteUuid: 'partial-suite',
        error: 'Something went wrong'
      });
    });

    it('should handle dynamic import properly', async () => {
      // This test ensures the dynamic import works correctly
      const options = {
        apiKey: 'test-api-key'
      };

      mockE2EManager.runCommitTests.mockResolvedValue({
        success: true
      });

      // Mock the dynamic import by ensuring E2EManager is available
      expect(MockedE2EManager).toBeDefined();
      
      const result = await indexModule.runDebuggAITests(options);
      
      expect(result.success).toBe(true);
    });

    it('should use correct server wait time from DEFAULT_CONFIG', async () => {
      const options = {
        apiKey: 'test-api-key',
        waitForServer: true
      };

      mockE2EManager.waitForServer.mockResolvedValue(true);
      mockE2EManager.runCommitTests.mockResolvedValue({
        success: true
      });

      await indexModule.runDebuggAITests(options);

      expect(mockE2EManager.waitForServer).toHaveBeenCalledWith(
        indexModule.DEFAULT_CONFIG.DEFAULT_SERVER_PORT,
        indexModule.DEFAULT_CONFIG.DEFAULT_SERVER_WAIT_TIME
      );
    });

    it('should handle concurrent calls properly', async () => {
      const options = {
        apiKey: 'test-api-key'
      };

      mockE2EManager.runCommitTests.mockResolvedValue({
        success: true,
        suiteUuid: 'concurrent-suite'
      });

      // Run multiple concurrent calls
      const promises = [
        indexModule.runDebuggAITests(options),
        indexModule.runDebuggAITests(options),
        indexModule.runDebuggAITests(options)
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.suiteUuid).toBe('concurrent-suite');
      });

      expect(MockedE2EManager).toHaveBeenCalledTimes(3);
    });
  });

  describe('module structure validation', () => {
    it('should have consistent export structure', () => {
      const exportedKeys = Object.keys(indexModule);
      
      const expectedExports = [
        'CLIBackendClient',
        'GitAnalyzer',
        'E2EManager',
        'TunnelService',
        'ServerManager',
        'DEFAULT_CONFIG',
        'ENV_VARS',
        'runDebuggAITests'
      ];

      expectedExports.forEach(exportName => {
        expect(exportedKeys).toContain(exportName);
      });
    });

    it('should export function with correct signature', () => {
      expect(typeof indexModule.runDebuggAITests).toBe('function');
      expect(indexModule.runDebuggAITests.length).toBe(1); // Should accept one parameter
    });
  });
});