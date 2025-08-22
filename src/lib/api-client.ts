import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

export interface E2eTest {
  uuid?: string;
  name?: string;
  description?: string;
  title?: string;
  curRun?: {
    uuid?: string;
    status?: 'pending' | 'running' | 'completed' | 'failed';
    runGif?: string;
    runScript?: string;
    runJson?: string;
  };
}

export interface E2eTestSuite {
  uuid?: string;
  name?: string;
  description?: string;
  title?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  tests?: E2eTest[];
}

export interface CommitTestRequest {
  repoName: string;
  repoPath: string;
  branchName: string;
  commitHash?: string;
  workingChanges?: Array<{
    status: string;
    file: string;
    diff?: string;
  }>;
  testDescription: string;
}

export interface CommitTestResponse {
  success: boolean;
  testSuiteUuid?: string;
  error?: string;
}

export interface ApiClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
}

/**
 * Simplified API client for DebuggAI that uses only an API key
 * This is designed for CI/CD environments like GitHub Actions
 */
export class DebuggAIClient {
  private axios: AxiosInstance;
  private apiKey: string;

  constructor(config: ApiClientConfig) {
    this.apiKey = config.apiKey;
    
    const baseURL = config.baseUrl;
    
    this.axios = axios.create({
      baseURL,
      timeout: config.timeout || 30000,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': '@debugg-ai/cli'
      }
    });

    // Add request interceptor for logging
    this.axios.interceptors.request.use((config) => {
      console.log(`Making API request: ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    // Add response interceptor for error handling
    this.axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          throw new Error('Authentication failed. Please check your API key.');
        }
        if (error.response?.status === 403) {
          throw new Error('Access forbidden. Please check your API key permissions.');
        }
        if (error.response?.status >= 500) {
          throw new Error(`Server error: ${error.response?.status} - ${error.response?.statusText}`);
        }
        throw error;
      }
    );
  }

  /**
   * Create a new E2E test suite from commit changes
   */
  async createCommitTestSuite(request: CommitTestRequest): Promise<CommitTestResponse> {
    try {
      console.log('Creating commit test suite...');
      const response = await this.axios.post<CommitTestResponse>('/api/v1/e2es/commit-suite', {
        ...request,
        // Add timestamp for uniqueness
        timestamp: new Date().toISOString()
      });

      return response.data;
    } catch (error) {
      console.error('Failed to create commit test suite:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get the status of a test suite
   */
  async getTestSuiteStatus(suiteUuid: string): Promise<E2eTestSuite | null> {
    try {
      const response = await this.axios.get<E2eTestSuite>(`/api/v1/e2es/suites/${suiteUuid}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to get test suite status for ${suiteUuid}:`, error);
      return null;
    }
  }

  /**
   * Wait for a test suite to complete with polling
   */
  async waitForTestSuiteCompletion(
    suiteUuid: string,
    options: {
      maxWaitTime?: number; // in milliseconds
      pollInterval?: number; // in milliseconds
      onProgress?: (suite: E2eTestSuite) => void;
    } = {}
  ): Promise<E2eTestSuite | null> {
    const maxWaitTime = options.maxWaitTime || 10 * 60 * 1000; // 10 minutes
    const pollInterval = options.pollInterval || 5000; // 5 seconds
    const startTime = Date.now();

    console.log(`Waiting for test suite ${suiteUuid} to complete...`);

    while (Date.now() - startTime < maxWaitTime) {
      const suite = await this.getTestSuiteStatus(suiteUuid);
      
      if (!suite) {
        console.error('Failed to get test suite status');
        return null;
      }

      if (options.onProgress) {
        options.onProgress(suite);
      }

      if (suite.status === 'completed' || suite.status === 'failed') {
        console.log(`Test suite ${suiteUuid} finished with status: ${suite.status}`);
        return suite;
      }

      console.log(`Test suite status: ${suite.status}, waiting...`);
      await this.sleep(pollInterval);
    }

    console.error(`Test suite ${suiteUuid} timed out after ${maxWaitTime}ms`);
    return null;
  }

  /**
   * List E2E test suites for a repository
   */
  async listTestSuites(params: {
    repoName?: string;
    branchName?: string;
    limit?: number;
    page?: number;
  } = {}): Promise<{ suites: E2eTestSuite[], total: number }> {
    try {
      const response = await this.axios.get('/api/v1/e2es/suites', {
        params: {
          repo_name: params.repoName,
          branch_name: params.branchName,
          limit: params.limit || 20,
          page: params.page || 1
        }
      });

      return {
        suites: response.data.results || [],
        total: response.data.count || 0
      };
    } catch (error) {
      console.error('Failed to list test suites:', error);
      return { suites: [], total: 0 };
    }
  }

  /**
   * Get detailed information about a test including results
   */
  async getTestDetails(testUuid: string): Promise<E2eTest | null> {
    try {
      const response = await this.axios.get<E2eTest>(`/api/v1/e2es/tests/${testUuid}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to get test details for ${testUuid}:`, error);
      return null;
    }
  }

  /**
   * Download test artifacts (scripts, recordings, etc.)
   */
  async downloadArtifact(url: string): Promise<Buffer | null> {
    try {
      const response = await this.axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'Accept': '*/*'
        }
      });
      
      return Buffer.from(response.data);
    } catch (error) {
      console.error(`Failed to download artifact from ${url}:`, error);
      return null;
    }
  }

  /**
   * Test the API connection and authentication
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.axios.get('/api/v1/health');
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed'
      };
    }
  }

  /**
   * Helper method to sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current user information (useful for validating API key)
   */
  async getCurrentUser(): Promise<{ id?: string; email?: string } | null> {
    try {
      const response = await this.axios.get('/api/v1/users/me');
      return response.data;
    } catch (error) {
      console.error('Failed to get current user:', error);
      return null;
    }
  }
}