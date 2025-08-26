import axios from 'axios';
import { DebuggAIClient, CommitTestRequest, E2eTestSuite } from '../lib/api-client';
import { mockAxios, mockAxiosInstance, createMockAxiosResponse, createMockAxiosError } from './mocks/axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DebuggAIClient', () => {
  let client: DebuggAIClient;
  const mockConfig = {
    apiKey: 'test-api-key',
    baseUrl: 'https://api.debugg.ai',
    timeout: 30000
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
    client = new DebuggAIClient(mockConfig);
  });

  describe('constructor', () => {
    it('should create axios instance with correct configuration', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: mockConfig.baseUrl,
        timeout: mockConfig.timeout,
        headers: {
          'Authorization': `Token ${mockConfig.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': '@debugg-ai/cli'
        }
      });
    });

    it('should set up request and response interceptors', () => {
      expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });

    it('should use default timeout when not provided', () => {
      const configWithoutTimeout = { ...mockConfig };
      delete (configWithoutTimeout as any).timeout;
      
      new DebuggAIClient(configWithoutTimeout);
      
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 30000 })
      );
    });
  });

  describe('createCommitTestSuite', () => {
    const mockRequest: CommitTestRequest = {
      repoName: 'test-repo',
      repoPath: '/path/to/repo',
      branchName: 'main',
      commitHash: 'abc123',
      workingChanges: [
        { status: 'M', file: 'src/test.ts', diff: 'some diff content' }
      ],
      testDescription: 'Test description'
    };

    it('should successfully create a commit test suite', async () => {
      const mockResponse = { success: true, testSuiteUuid: 'suite-123' };
      mockAxiosInstance.post.mockResolvedValue(createMockAxiosResponse(mockResponse));

      const result = await client.createCommitTestSuite(mockRequest);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/v1/commit-suites/', {
        ...mockRequest,
        workingChanges: expect.arrayContaining([
          expect.objectContaining({
            file: expect.any(String),
            status: expect.any(String),
            absPath: expect.any(String)
          })
        ]),
        context: expect.objectContaining({
          source: 'cli',
          version: '1.0.1',
          timestamp: expect.any(String)
        }),
        timestamp: expect.any(String)
      });
      expect(result).toEqual(mockResponse);
    });

    it('should handle API errors gracefully', async () => {
      const mockError = createMockAxiosError(500, 'Internal Server Error');
      mockAxiosInstance.post.mockRejectedValue(mockError);

      const result = await client.createCommitTestSuite(mockRequest);

      expect(result).toEqual({
        success: false,
        error: 'Internal Server Error'
      });
    });

    it('should handle network errors gracefully', async () => {
      const networkError = new Error('Network Error');
      mockAxiosInstance.post.mockRejectedValue(networkError);

      const result = await client.createCommitTestSuite(mockRequest);

      expect(result).toEqual({
        success: false,
        error: 'Network Error'
      });
    });

    it('should include timestamp in request', async () => {
      const mockResponse = { success: true, testSuiteUuid: 'suite-123' };
      mockAxiosInstance.post.mockResolvedValue(createMockAxiosResponse(mockResponse));

      await client.createCommitTestSuite(mockRequest);

      const calledWith = mockAxiosInstance.post.mock.calls[0][1];
      expect(calledWith).toHaveProperty('timestamp');
      expect(new Date(calledWith.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('getTestSuiteStatus', () => {
    const suiteUuid = 'suite-123';

    it('should successfully get test suite status', async () => {
      const mockSuite: E2eTestSuite = {
        uuid: suiteUuid,
        name: 'Test Suite',
        status: 'completed',
        tests: []
      };
      mockAxiosInstance.get.mockResolvedValue(createMockAxiosResponse(mockSuite));

      const result = await client.getTestSuiteStatus(suiteUuid);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/api/v1/test-suites/${suiteUuid}/`);
      expect(result).toEqual(mockSuite);
    });

    it('should return null on error', async () => {
      const mockError = createMockAxiosError(404, 'Not Found');
      mockAxiosInstance.get.mockRejectedValue(mockError);

      const result = await client.getTestSuiteStatus(suiteUuid);

      expect(result).toBeNull();
    });
  });

  describe('waitForTestSuiteCompletion', () => {
    const suiteUuid = 'suite-123';

    it('should wait for completion and return final suite', async () => {
      const mockSuite: E2eTestSuite = {
        uuid: suiteUuid,
        status: 'completed',
        tests: []
      };

      // First call returns running, second call returns completed
      mockAxiosInstance.get
        .mockResolvedValueOnce(createMockAxiosResponse({ ...mockSuite, status: 'running' }))
        .mockResolvedValueOnce(createMockAxiosResponse(mockSuite));

      const result = await client.waitForTestSuiteCompletion(suiteUuid, {
        maxWaitTime: 1000,
        pollInterval: 100
      });

      expect(result).toEqual(mockSuite);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('should timeout after maxWaitTime', async () => {
      const mockSuite: E2eTestSuite = {
        uuid: suiteUuid,
        status: 'running',
        tests: []
      };

      mockAxiosInstance.get.mockResolvedValue(createMockAxiosResponse(mockSuite));

      const result = await client.waitForTestSuiteCompletion(suiteUuid, {
        maxWaitTime: 100,
        pollInterval: 50
      });

      expect(result).toBeNull();
    });

    it('should call onProgress callback', async () => {
      const mockSuite: E2eTestSuite = {
        uuid: suiteUuid,
        status: 'completed',
        tests: []
      };
      const onProgress = jest.fn();

      mockAxiosInstance.get.mockResolvedValue(createMockAxiosResponse(mockSuite));

      await client.waitForTestSuiteCompletion(suiteUuid, {
        maxWaitTime: 100,
        pollInterval: 50,
        onProgress
      });

      expect(onProgress).toHaveBeenCalledWith(mockSuite);
    });

    it('should return null if suite retrieval fails', async () => {
      mockAxiosInstance.get.mockRejectedValue(createMockAxiosError(404, 'Not Found'));

      const result = await client.waitForTestSuiteCompletion(suiteUuid, {
        maxWaitTime: 100,
        pollInterval: 50
      });

      expect(result).toBeNull();
    });

    it('should return immediately for failed status', async () => {
      const mockSuite: E2eTestSuite = {
        uuid: suiteUuid,
        status: 'failed',
        tests: []
      };

      mockAxiosInstance.get.mockResolvedValue(createMockAxiosResponse(mockSuite));

      const startTime = Date.now();
      const result = await client.waitForTestSuiteCompletion(suiteUuid, {
        maxWaitTime: 5000,
        pollInterval: 1000
      });
      const endTime = Date.now();

      expect(result).toEqual(mockSuite);
      expect(endTime - startTime).toBeLessThan(500); // Should return quickly
    });
  });

  describe('listTestSuites', () => {
    it('should list test suites with parameters', async () => {
      const mockResponse = {
        results: [
          { uuid: 'suite-1', name: 'Suite 1' },
          { uuid: 'suite-2', name: 'Suite 2' }
        ],
        count: 2
      };
      mockAxiosInstance.get.mockResolvedValue(createMockAxiosResponse(mockResponse));

      const result = await client.listTestSuites({
        repoName: 'test-repo',
        branchName: 'main',
        limit: 10,
        page: 1
      });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/test-suites/', {
        params: {
          repo_name: 'test-repo',
          branch_name: 'main',
          limit: 10,
          page: 1
        }
      });
      expect(result).toEqual({
        suites: mockResponse.results,
        total: mockResponse.count
      });
    });

    it('should use default parameters when none provided', async () => {
      const mockResponse = { results: [], count: 0 };
      mockAxiosInstance.get.mockResolvedValue(createMockAxiosResponse(mockResponse));

      await client.listTestSuites();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/test-suites/', {
        params: {
          repo_name: undefined,
          branch_name: undefined,
          limit: 20,
          page: 1
        }
      });
    });

    it('should handle errors gracefully', async () => {
      mockAxiosInstance.get.mockRejectedValue(createMockAxiosError(500, 'Server Error'));

      const result = await client.listTestSuites();

      expect(result).toEqual({ suites: [], total: 0 });
    });
  });

  describe('getTestDetails', () => {
    const testUuid = 'test-123';

    it('should get test details successfully', async () => {
      const mockTest = {
        uuid: testUuid,
        name: 'Test Name',
        curRun: { status: 'completed' }
      };
      mockAxiosInstance.get.mockResolvedValue(createMockAxiosResponse(mockTest));

      const result = await client.getTestDetails(testUuid);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(`/api/v1/e2e-tests/${testUuid}/`);
      expect(result).toEqual(mockTest);
    });

    it('should return null on error', async () => {
      mockAxiosInstance.get.mockRejectedValue(createMockAxiosError(404, 'Not Found'));

      const result = await client.getTestDetails(testUuid);

      expect(result).toBeNull();
    });
  });

  describe('downloadArtifact', () => {
    const artifactUrl = 'https://example.com/artifact.gif';

    it('should download artifact successfully', async () => {
      const mockBuffer = Buffer.from('test-data');
      mockAxiosInstance.get.mockResolvedValue(createMockAxiosResponse(mockBuffer.buffer));

      const result = await client.downloadArtifact(artifactUrl);

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(artifactUrl, {
        responseType: 'arraybuffer',
        headers: { 'Accept': '*/*' }
      });
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should return null on error', async () => {
      mockAxiosInstance.get.mockRejectedValue(createMockAxiosError(404, 'Not Found'));

      const result = await client.downloadArtifact(artifactUrl);

      expect(result).toBeNull();
    });
  });

  describe('testConnection', () => {
    it('should return success for healthy connection', async () => {
      mockAxiosInstance.get.mockResolvedValue(createMockAxiosResponse({ status: 'ok' }));

      const result = await client.testConnection();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/health');
      expect(result).toEqual({ success: true });
    });

    it('should return error for failed connection', async () => {
      const mockError = createMockAxiosError(500, 'Server Error');
      mockAxiosInstance.get.mockRejectedValue(mockError);

      const result = await client.testConnection();

      expect(result).toEqual({
        success: false,
        error: 'Server Error'
      });
    });

    it('should handle network errors', async () => {
      const networkError = new Error('Network unreachable');
      mockAxiosInstance.get.mockRejectedValue(networkError);

      const result = await client.testConnection();

      expect(result).toEqual({
        success: false,
        error: 'Network unreachable'
      });
    });
  });

  describe('getCurrentUser', () => {
    it('should get current user successfully', async () => {
      const mockUser = { id: 'user-123', email: 'test@example.com' };
      mockAxiosInstance.get.mockResolvedValue(createMockAxiosResponse(mockUser));

      const result = await client.getCurrentUser();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/users/me');
      expect(result).toEqual(mockUser);
    });

    it('should return null on error', async () => {
      mockAxiosInstance.get.mockRejectedValue(createMockAxiosError(401, 'Unauthorized'));

      const result = await client.getCurrentUser();

      expect(result).toBeNull();
    });
  });

  describe('response interceptor error handling', () => {
    it('should throw authentication error for 401 status', () => {
      const interceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      const error = createMockAxiosError(401, 'Unauthorized');

      expect(() => interceptor(error)).toThrow('Authentication failed. Please check your API key.');
    });

    it('should throw access forbidden error for 403 status', () => {
      const interceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      const error = createMockAxiosError(403, 'Forbidden');

      expect(() => interceptor(error)).toThrow('Access forbidden. Please check your API key permissions.');
    });

    it('should throw server error for 5xx status', () => {
      const interceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      const error = createMockAxiosError(500, 'Internal Server Error');

      expect(() => interceptor(error)).toThrow('Server error: 500 - Internal Server Error');
    });

    it('should pass through other errors unchanged', () => {
      const interceptor = mockAxiosInstance.interceptors.response.use.mock.calls[0][1];
      const error = createMockAxiosError(400, 'Bad Request');

      expect(() => interceptor(error)).toThrow(error);
    });
  });
});