import { E2EManager, E2EManagerOptions } from '../lib/e2e-manager';
import { CLIBackendClient } from '../backend/cli/client';
import { GitAnalyzer } from '../lib/git-analyzer';
import * as fs from 'fs-extra';
import { mockFsExtra, setupMockFileSystem } from './mocks/fs-extra';

// Mock dependencies
jest.mock('../backend/cli/client');
jest.mock('../lib/git-analyzer');
jest.mock('fs-extra');
jest.mock('ora', () => {
  return jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    text: ''
  }));
});

// Mock global fetch for server waiting
global.fetch = jest.fn();

const MockedCLIBackendClient = CLIBackendClient as jest.MockedClass<typeof CLIBackendClient>;
const MockedGitAnalyzer = GitAnalyzer as jest.MockedClass<typeof GitAnalyzer>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('E2EManager', () => {
  let testManager: E2EManager;
  let mockClient: jest.Mocked<CLIBackendClient>;
  let mockGitAnalyzer: jest.Mocked<GitAnalyzer>;
  
  const defaultOptions: E2EManagerOptions = {
    apiKey: 'test-api-key',
    repoPath: '/test/repo',
    baseUrl: 'https://api.debugg.ai',
    testOutputDir: 'tests/debugg-ai'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Clean environment variables to ensure test isolation
    delete process.env.GITHUB_SHA;
    
    // Setup fs-extra mocks
    setupMockFileSystem({
      '/test/repo/.git': true,
      '/test/repo/tests/debugg-ai': true
    });

    // Setup client mock
    mockClient = {
      initialize: jest.fn(),
      testAuthentication: jest.fn(),
      createCommitTestSuite: jest.fn(),
      waitForCommitTestSuiteCompletion: jest.fn(),
      downloadArtifact: jest.fn()
    } as any;
    
    MockedCLIBackendClient.mockImplementation(() => mockClient);

    // Setup git analyzer mock
    mockGitAnalyzer = {
      validateGitRepo: jest.fn(),
      getCurrentBranchInfo: jest.fn(),
      getWorkingChanges: jest.fn(),
      getCommitChanges: jest.fn(),
      getCommitsFromRange: jest.fn(),
      getCommitsSince: jest.fn(),
      getPRNumber: jest.fn().mockReturnValue(null),
      getLastCommits: jest.fn(),
      getCombinedCommitChanges: jest.fn(),
      getRepoName: jest.fn(),
      analyzeChangesWithContext: jest.fn()
    } as any;
    
    MockedGitAnalyzer.mockImplementation(() => mockGitAnalyzer);

    testManager = new E2EManager(defaultOptions);
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      expect(MockedCLIBackendClient).toHaveBeenCalledWith({
        apiKey: defaultOptions.apiKey,
        baseUrl: defaultOptions.baseUrl,
        repoPath: defaultOptions.repoPath,
        timeout: 30000
      });

      expect(MockedGitAnalyzer).toHaveBeenCalledWith({
        repoPath: defaultOptions.repoPath
      });
    });

    it('should merge custom options with defaults', () => {
      const customOptions: E2EManagerOptions = {
        apiKey: 'custom-key',
        repoPath: '/custom/path',
        serverTimeout: 60000,
        maxTestWaitTime: 900000
      };

      new E2EManager(customOptions);

      expect(MockedCLIBackendClient).toHaveBeenCalledWith({
        apiKey: 'custom-key',
        baseUrl: 'https://api.debugg.ai',
        repoPath: '/custom/path',
        timeout: 60000
      });
    });
  });

  describe('runCommitTests', () => {
    beforeEach(() => {
      // Setup default successful responses
      mockGitAnalyzer.validateGitRepo.mockResolvedValue(true);
      mockClient.initialize.mockResolvedValue();
      mockClient.testAuthentication.mockResolvedValue({ success: true, user: { id: 'user-123', email: 'test@example.com' } });
      mockGitAnalyzer.getWorkingChanges.mockResolvedValue({
        changes: [
          { status: 'M', file: 'src/test.ts', diff: 'test diff' }
        ],
        branchInfo: { branch: 'main', commitHash: 'abc123' }
      });
      mockGitAnalyzer.getCommitChanges.mockResolvedValue({
        changes: [
          { status: 'M', file: 'src/test.ts', diff: 'test diff' }
        ],
        branchInfo: { branch: 'main', commitHash: 'abc123' }
      });
      mockGitAnalyzer.getRepoName.mockReturnValue('test-repo');
      mockGitAnalyzer.analyzeChangesWithContext.mockResolvedValue({
        totalFiles: 1,
        fileTypes: { 'TypeScript': 1 },
        componentChanges: ['src/test.ts'],
        routingChanges: [],
        configChanges: [],
        testChanges: [],
        affectedLanguages: ['TypeScript'],
        changeComplexity: 'medium',
        suggestedFocusAreas: ['Component logic']
      });
      mockClient.createCommitTestSuite.mockResolvedValue({
        success: true,
        testSuiteUuid: 'suite-123'
      });
      mockClient.waitForCommitTestSuiteCompletion.mockResolvedValue({
        uuid: 'suite-123',
        status: 'completed',
        tests: []
      });
    });

    it('should complete full test run successfully', async () => {
      const result = await testManager.runCommitTests();

      expect(result.success).toBe(true);
      expect(result.suiteUuid).toBe('suite-123');
      expect(mockGitAnalyzer.validateGitRepo).toHaveBeenCalled();
      expect(mockClient.initialize).toHaveBeenCalled();
      expect(mockClient.testAuthentication).toHaveBeenCalled();
    });

    it('should fail if not a valid git repository', async () => {
      mockGitAnalyzer.validateGitRepo.mockResolvedValue(false);

      const result = await testManager.runCommitTests();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not a valid git repository');
    });

    it('should fail if API connection test fails', async () => {
      mockClient.initialize.mockRejectedValue(new Error('Connection failed'));

      const result = await testManager.runCommitTests();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection failed');
    });

    it('should fail if API key validation fails', async () => {
      mockClient.testAuthentication.mockResolvedValue({ success: false, error: 'Invalid API key' });

      const result = await testManager.runCommitTests();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed: Invalid API key');
    });

    it('should skip test generation when no changes detected', async () => {
      // Ensure GITHUB_SHA is not set to avoid interference
      delete process.env.GITHUB_SHA;
      
      mockGitAnalyzer.getWorkingChanges.mockResolvedValue({
        changes: [],
        branchInfo: { branch: 'main', commitHash: 'abc123' }
      });

      const result = await testManager.runCommitTests();

      expect(result.success).toBe(true);
      expect(result.testFiles).toEqual([]);
      expect(mockClient.createCommitTestSuite).not.toHaveBeenCalled();
    });

    it('should analyze commit changes when GITHUB_SHA is present', async () => {
      process.env.GITHUB_SHA = 'commit-sha-123';
      
      mockGitAnalyzer.getCommitChanges.mockResolvedValue({
        changes: [{ status: 'M', file: 'src/test.ts', diff: 'diff' }],
        branchInfo: { branch: 'main', commitHash: 'commit-sha-123' }
      });

      await testManager.runCommitTests();

      expect(mockGitAnalyzer.getCommitChanges).toHaveBeenCalledWith('commit-sha-123');
      expect(mockGitAnalyzer.getWorkingChanges).not.toHaveBeenCalled();

      delete process.env.GITHUB_SHA;
    });

    it('should fail if test suite creation fails', async () => {
      mockClient.createCommitTestSuite.mockResolvedValue({
        success: false,
        error: 'Suite creation failed'
      });

      const result = await testManager.runCommitTests();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to create test suite: Suite creation failed');
    });

    it('should fail if test suite UUID is missing', async () => {
      mockClient.createCommitTestSuite.mockResolvedValue({
        success: true
        // Missing testSuiteUuid
      });

      const result = await testManager.runCommitTests();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to create test suite: undefined');
    });

    it('should fail if test suite times out', async () => {
      mockClient.waitForCommitTestSuiteCompletion.mockResolvedValue(null);

      const result = await testManager.runCommitTests();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Test suite timed out or failed to complete');
    });

    it('should handle unexpected errors gracefully', async () => {
      mockGitAnalyzer.validateGitRepo.mockRejectedValue(new Error('Unexpected error'));

      const result = await testManager.runCommitTests();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unexpected error');
    });

    it('should call progress callback during test waiting', async () => {
      const mockSuite = {
        uuid: 'suite-123',
        status: 'completed',
        tests: [
          { curRun: { status: 'completed' } },
          { curRun: { status: 'failed' } },
          { curRun: { status: 'running' } }
        ]
      };

      mockClient.waitForCommitTestSuiteCompletion.mockImplementation(async (uuid, options) => {
        if (options?.onProgress) {
          options.onProgress(mockSuite as any);
        }
        return mockSuite as any;
      });

      await testManager.runCommitTests();

      expect(mockClient.waitForCommitTestSuiteCompletion).toHaveBeenCalledWith(
        'suite-123',
        expect.objectContaining({
          maxWaitTime: 600000,
          pollInterval: 5000,
          onProgress: expect.any(Function)
        })
      );
    });
  });

  describe('waitForServer', () => {
    it('should return true when server responds successfully', async () => {
      const mockResponse = { ok: true };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await testManager.waitForServer(3000, 5000);

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000', {
        method: 'GET',
        signal: expect.any(AbortSignal)
      });
    });

    it('should return true when server responds with 404', async () => {
      const mockResponse = { ok: false, status: 404 };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const result = await testManager.waitForServer(3000, 5000);

      expect(result).toBe(true);
    });

    it('should timeout when server does not start', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Connection refused'));

      const result = await testManager.waitForServer(3000, 100); // Very short timeout

      expect(result).toBe(false);
    });

    it('should continue polling until server is ready', async () => {
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({ ok: true });

      const result = await testManager.waitForServer(3000, 10000);

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('saveTestArtifacts', () => {
    it('should save all test artifacts successfully', async () => {
      const mockSuite = {
        uuid: 'suite-123',
        tests: [
          {
            uuid: 'test-1',
            name: 'Test One',
            curRun: {
              runScript: 'https://example.com/script.js',
              runGif: 'https://example.com/recording.gif',
              runJson: 'https://example.com/details.json'
            }
          }
        ]
      };

      mockClient.downloadArtifactToFile = jest.fn()
        .mockResolvedValueOnce(true)  // script download success
        .mockResolvedValueOnce(true)  // gif download success
        .mockResolvedValueOnce(true); // json download success

      const result = await (testManager as any).saveTestArtifacts(mockSuite);

      expect(mockedFs.ensureDir).toHaveBeenCalledWith('/test/repo/tests/debugg-ai');
      expect(mockedFs.ensureDir).toHaveBeenCalledWith('/test/repo/tests/debugg-ai/Test One');
      
      expect(mockClient.downloadArtifactToFile).toHaveBeenCalledWith(
        'https://example.com/script.js',
        '/test/repo/tests/debugg-ai/Test One/Test One.spec.js',
        'http://localhost:3000'
      );
      
      expect(result).toHaveLength(3);
    });

    it('should handle missing test runs gracefully', async () => {
      const mockSuite = {
        uuid: 'suite-123',
        tests: [
          {
            uuid: 'test-1',
            name: 'Test One'
            // Missing curRun
          }
        ]
      };

      const result = await (testManager as any).saveTestArtifacts(mockSuite);

      expect(result).toHaveLength(0);
      expect(mockClient.downloadArtifact).not.toHaveBeenCalled();
    });

    it('should handle download errors gracefully', async () => {
      const mockSuite = {
        uuid: 'suite-123',
        tests: [
          {
            uuid: 'test-1',
            name: 'Test One',
            curRun: {
              runScript: 'https://example.com/script.js'
            }
          }
        ]
      };

      mockClient.downloadArtifact.mockRejectedValue(new Error('Download failed'));

      const result = await (testManager as any).saveTestArtifacts(mockSuite);

      expect(result).toHaveLength(0);
    });

    it('should handle null download responses', async () => {
      const mockSuite = {
        uuid: 'suite-123',
        tests: [
          {
            uuid: 'test-1',
            name: 'Test One',
            curRun: {
              runScript: 'https://example.com/script.js'
            }
          }
        ]
      };

      mockClient.downloadArtifact.mockResolvedValue(null);

      const result = await (testManager as any).saveTestArtifacts(mockSuite);

      expect(result).toHaveLength(0);
      expect(mockedFs.writeFile).not.toHaveBeenCalled();
    });

    it('should use test UUID when name is missing', async () => {
      const mockSuite = {
        uuid: 'suite-123',
        tests: [
          {
            uuid: 'test-uuid-123',
            curRun: {
              runScript: 'https://example.com/script.js'
            }
          }
        ]
      };

      mockClient.downloadArtifact.mockResolvedValue(Buffer.from('content'));

      await (testManager as any).saveTestArtifacts(mockSuite);

      expect(mockedFs.ensureDir).toHaveBeenCalledWith('/test/repo/tests/debugg-ai/test-test-uui');
    });

    it('should return empty array for empty test suite', async () => {
      const mockSuite = {
        uuid: 'suite-123',
        tests: []
      };

      const result = await (testManager as any).saveTestArtifacts(mockSuite);

      expect(result).toHaveLength(0);
    });

    it('should handle missing tests array', async () => {
      const mockSuite = {
        uuid: 'suite-123'
        // Missing tests array
      };

      const result = await (testManager as any).saveTestArtifacts(mockSuite);

      expect(result).toHaveLength(0);
    });
  });

  describe('createTestDescription', () => {
    it('should create comprehensive test description', async () => {
      const mockChanges = {
        changes: [
          { status: 'M', file: 'src/component.tsx' },
          { status: 'A', file: 'src/utils.ts' },
          { status: 'M', file: 'styles/main.css' }
        ],
        branchInfo: {
          branch: 'feature/new-feature',
          commitHash: 'abcd1234efgh5678'
        }
      };

      mockGitAnalyzer.analyzeChangesWithContext.mockResolvedValue({
        totalFiles: 3,
        fileTypes: { 'TypeScript': 2, 'Stylesheets': 1 },
        componentChanges: ['src/component.tsx', 'src/utils.ts'],
        routingChanges: [],
        configChanges: [],
        testChanges: [],
        affectedLanguages: ['TypeScript', 'CSS'],
        changeComplexity: 'medium',
        suggestedFocusAreas: ['Component logic', 'Styling']
      });

      const description = await (testManager as any).createTestDescription(mockChanges);

      expect(description).toContain('working changes');
      expect(description).toContain('feature/new-feature');
      expect(description).toContain('Component logic');
      expect(description).toContain('Styling');
      expect(description).toContain('TypeScript');
    });

    it('should handle different file types correctly', async () => {
      const mockChanges = {
        changes: [
          { status: 'M', file: 'src/app.js' },
          { status: 'A', file: 'docs/README.md' },
          { status: 'M', file: 'package.json' },
          { status: 'A', file: 'test/spec.test.js' }
        ],
        branchInfo: {
          branch: 'main',
          commitHash: 'abc123'
        }
      };

      mockGitAnalyzer.analyzeChangesWithContext.mockResolvedValue({
        totalFiles: 4,
        fileTypes: { 'JavaScript': 2, 'Documentation': 1, 'Configuration': 1 },
        componentChanges: ['src/app.js'],
        routingChanges: [],
        configChanges: ['package.json'],
        testChanges: ['test/spec.test.js'],
        affectedLanguages: ['JavaScript'],
        changeComplexity: 'low',
        suggestedFocusAreas: ['Application logic', 'Configuration']
      });

      const description = await (testManager as any).createTestDescription(mockChanges);

      expect(description).toContain('JavaScript');
      expect(description).toContain('Application logic');
      expect(description).toContain('Configuration');
    });
  });

  describe('analyzeFileTypes', () => {
    it('should correctly categorize file types', () => {
      const files = [
        'src/app.ts',
        'src/component.tsx',
        'src/utils.js',
        'src/component.jsx',
        'styles/main.css',
        'styles/theme.scss',
        'index.html',
        'package.json',
        'README.md',
        'src/app.test.ts',
        'config/webpack.config.js',
        'src/data.py',
        'Main.java',
        'unknown.xyz'
      ];

      const result = (testManager as any).analyzeFileTypes(files);

      const typeMap = new Map(result.map((item: any) => [item.type, item.count]));

      expect(typeMap.get('TypeScript')).toBe(3); // .ts, .tsx, .test.ts (extension takes precedence)
      expect(typeMap.get('JavaScript')).toBe(3); // .js, .jsx, webpack.config.js (by extension)
      expect(typeMap.get('Stylesheets')).toBe(2); // .css, .scss
      expect(typeMap.get('HTML')).toBe(1);
      expect(typeMap.get('Configuration')).toBe(1); // package.json only
      expect(typeMap.get('Documentation')).toBe(1);
      expect(typeMap.get('Python')).toBe(1);
      expect(typeMap.get('Java')).toBe(1);
      expect(typeMap.get('Other')).toBe(1);
    });
  });

  describe('reportResults', () => {
    it('should report successful test results', () => {
      const mockSuite = {
        uuid: 'suite-123',
        name: 'Test Suite',
        status: 'completed',
        tests: [
          { name: 'Test 1', curRun: { status: 'completed' } },
          { name: 'Test 2', curRun: { status: 'completed' } }
        ]
      };

      // This is mainly testing that it doesn't throw
      expect(() => {
        (testManager as any).reportResults(mockSuite);
      }).not.toThrow();
    });

    it('should set exit code for failed tests', () => {
      const originalExitCode = process.exitCode;
      
      const mockSuite = {
        uuid: 'suite-123',
        status: 'completed',
        tests: [
          { name: 'Test 1', curRun: { status: 'completed' } },
          { name: 'Test 2', curRun: { status: 'failed' } }
        ]
      };

      (testManager as any).reportResults(mockSuite);

      expect(process.exitCode).toBe(1);
      
      // Restore original exit code
      process.exitCode = originalExitCode;
    });
  });

  describe('getStatusColor', () => {
    it('should return correct colored status strings', () => {
      const testCases = [
        { status: 'completed', expected: 'PASSED' },
        { status: 'failed', expected: 'FAILED' },
        { status: 'running', expected: 'RUNNING' },
        { status: 'pending', expected: 'PENDING' },
        { status: 'unknown', expected: 'UNKNOWN' }
      ];

      testCases.forEach(({ status, expected }) => {
        const result = (testManager as any).getStatusColor(status);
        expect(result).toContain(expected);
      });
    });
  });
});