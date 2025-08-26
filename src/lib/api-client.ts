import axios, { AxiosInstance } from 'axios';

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
    absPath?: string; // Enhanced: preserve absolute paths
  }>;
  testDescription: string;
  publicUrl?: string;
  testEnvironment?: {
    url: string;
    type: 'ngrok_tunnel' | 'direct' | 'localhost';
    port?: number | undefined;
    metadata?: Record<string, any> | undefined;
  };
  // Enhanced: add context similar to backend services
  context?: {
    source: string;
    version: string;
    timestamp: string;
    environment?: any;
    [key: string]: any;
  };
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
        'Authorization': `Token ${this.apiKey}`,
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
   * Enhanced with better parameter handling patterns from backend services
   */
  async createCommitTestSuite(request: CommitTestRequest): Promise<CommitTestResponse> {
    try {
      console.log('Creating commit test suite...');
      
      // Enhanced parameter processing similar to backend services
      const processedRequest = this.processCommitTestRequest(request);
      
      const response = await this.axios.post<CommitTestResponse>('/api/v1/commit-suites/', {
        ...processedRequest,
        // Add timestamp for uniqueness
        timestamp: new Date().toISOString()
      });

      console.log('API Response:', response.data);
      
      // Django might return different structure, normalize it
      const data = response.data as any;
      if (data && typeof data === 'object') {
        // If Django returns the actual object directly, wrap it in our expected format
        if (data.uuid && !data.success) {
          return {
            success: true,
            testSuiteUuid: data.uuid
          };
        }
      }

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
   * Process commit test request similar to backend service patterns
   * Handles path normalization and context extraction
   */
  private processCommitTestRequest(request: CommitTestRequest): CommitTestRequest {
    const { repoPath, repoName, branchName } = request;
    
    // Normalize paths and extract relative paths for working changes
    const processedWorkingChanges = request.workingChanges?.map(change => {
      let relativePath = change.file;
      
      // Convert absolute path to relative path (similar to backend service logic)
      if (repoPath && change.file.startsWith(repoPath)) {
        relativePath = change.file.replace(repoPath + "/", "");
      } else if (repoName) {
        // Handle repo name-based path extraction
        const repoBaseName = repoName.split("/").pop() || "";
        const splitPath = change.file.split(repoBaseName);
        if (splitPath.length === 2) {
          relativePath = splitPath[1]?.replace(/^\/+/, "") || change.file;
        }
      }
      
      return {
        ...change,
        file: relativePath,
        // Preserve absolute path for reference
        absPath: change.file
      };
    });

    return {
      ...request,
      ...(processedWorkingChanges && { workingChanges: processedWorkingChanges }),
      // Add enhanced context similar to backend services
      context: {
        source: 'cli',
        version: '1.0.1',
        timestamp: new Date().toISOString(),
        ...(request.testEnvironment && { 
          environment: request.testEnvironment 
        })
      }
    };
  }

  /**
   * Get the status of a test suite
   */
  async getTestSuiteStatus(suiteUuid: string): Promise<E2eTestSuite | null> {
    try {
      const response = await this.axios.get<E2eTestSuite>(`/api/v1/test-suites/${suiteUuid}/`);
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
      const response = await this.axios.get('/api/v1/test-suites/', {
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
      const response = await this.axios.get<E2eTest>(`/api/v1/e2e-tests/${testUuid}/`);
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
      await this.axios.get('/api/v1/health');
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

  /**
   * Create a commit test suite with enhanced tunnel URL support
   */
  async createCommitTestSuiteWithTunnel(
    request: CommitTestRequest,
    tunnelUrl: string,
    tunnelMetadata?: Record<string, any>
  ): Promise<CommitTestResponse> {
    const enhancedRequest: CommitTestRequest = {
      ...request,
      publicUrl: tunnelUrl,
      testEnvironment: {
        url: tunnelUrl,
        type: 'ngrok_tunnel',
        port: this.extractPortFromUrl(tunnelUrl) || undefined,
        metadata: tunnelMetadata ? {
          ...tunnelMetadata,
          timestamp: new Date().toISOString(),
          source: 'workflow-orchestrator'
        } : {
          timestamp: new Date().toISOString(),
          source: 'workflow-orchestrator'
        }
      }
    };

    return this.createCommitTestSuite(enhancedRequest);
  }

  /**
   * Validate tunnel URL accessibility
   */
  async validateTunnelUrl(tunnelUrl: string, timeout: number = 10000): Promise<{
    accessible: boolean;
    responseTime?: number;
    statusCode?: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      const response = await this.axios.get(tunnelUrl, {
        timeout,
        validateStatus: (status) => status < 500
      });

      return {
        accessible: true,
        responseTime: Date.now() - startTime,
        statusCode: response.status
      };
    } catch (error) {
      return {
        accessible: false,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Extract port number from URL
   */
  private extractPortFromUrl(url: string): number | undefined {
    try {
      const urlObj = new URL(url);
      if (urlObj.port) {
        return parseInt(urlObj.port, 10);
      }
      
      if (urlObj.protocol === 'https:') return 443;
      if (urlObj.protocol === 'http:') return 80;
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Get test environment recommendations based on tunnel type
   */
  getTestEnvironmentRecommendations(tunnelUrl: string): {
    recommendedTimeout: number;
    recommendedRetries: number;
    specialInstructions: string[];
  } {
    const isNgrokTunnel = tunnelUrl.includes('ngrok');
    
    return {
      recommendedTimeout: isNgrokTunnel ? 60000 : 30000,
      recommendedRetries: isNgrokTunnel ? 3 : 2,
      specialInstructions: isNgrokTunnel 
        ? [
            'Using ngrok tunnel - tests may take longer due to proxy latency',
            'Ensure ngrok tunnel remains active throughout test execution',
            'Consider increasing timeouts for network operations'
          ]
        : [
            'Using direct URL access',
            'Standard timeout and retry settings apply'
          ]
    };
  }
}