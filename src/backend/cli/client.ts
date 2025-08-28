// backend/cli/client.ts - Main CLI client using adapted backend services
import { CLITransport } from './transport';
import { CLIContextProvider, CLIContextTransport } from './context';
import { createCLIE2esService, CLIE2esService } from './services/e2es';
import { createCLIUsersService, CLIUsersService } from './services/users';
import { log } from '../../util/logging';

export interface CLIClientConfig {
    apiKey: string;
    baseUrl: string;
    repoPath: string;
    timeout?: number;
}

/**
 * Main CLI client that combines the proven backend services with CLI adaptations
 * This preserves all the working data structures and API patterns from the backend
 * while removing VSCode dependencies and complex auth
 */
export class CLIBackendClient {
    private transport: CLITransport;
    private contextTransport: CLIContextTransport;
    private contextProvider: CLIContextProvider;
    private initialized: boolean = false;

    // Public service interfaces (same pattern as backend client)
    public e2es: CLIE2esService;
    public users: CLIUsersService;

    constructor(config: CLIClientConfig) {
        // Initialize transport layer with simple API key auth
        this.transport = new CLITransport({
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            timeout: config.timeout || 30000
        });

        // Initialize CLI context provider
        this.contextProvider = new CLIContextProvider(config.repoPath);
        
        // Combine transport with context
        this.contextTransport = new CLIContextTransport(this.transport, this.contextProvider);

        // Initialize services using adapted backend service factories
        this.e2es = createCLIE2esService(this.contextTransport);
        this.users = createCLIUsersService(this.contextTransport);
    }

    /**
     * Initialize the client and context
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        
        log.info('Initializing CLI Backend Client');
        
        // Initialize context provider to gather git info
        await this.contextProvider.initialize();
        
        // Test connection
        const connectionTest = await this.transport.testConnection();
        if (!connectionTest.success) {
            throw new Error(`API connection failed: ${connectionTest.error}`);
        }
        
        this.initialized = true;
        log.success('CLI Backend Client initialized');
    }

    /**
     * Test authentication by calling a simple endpoint
     */
    async testAuthentication(): Promise<{ success: boolean; user?: any; error?: string }> {
        try {
            const user = await this.users.getCurrentUser();
            if (user) {
                return { success: true, user };
            } else {
                return { success: false, error: 'Failed to authenticate with API key' };
            }
        } catch (error) {
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Authentication test failed' 
            };
        }
    }

    /**
     * Get context provider for direct access
     */
    getContextProvider(): CLIContextProvider {
        return this.contextProvider;
    }

    /**
     * Get transport for direct access if needed
     */
    getTransport(): CLITransport {
        return this.transport;
    }

    /**
     * Update API key
     */
    updateApiKey(apiKey: string): void {
        this.transport.updateApiKey(apiKey);
    }

    /**
     * Check if client is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Get current context information
     */
    getContext() {
        return this.contextProvider.getContext();
    }

    /**
     * Ensure client is initialized before operations
     */
    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    /**
     * High-level method to create commit test suite
     * This matches the functionality expected by TestManager
     */
    async createCommitTestSuite(request: {
        repoName: string;
        repoPath: string;
        branchName: string;
        commitHash?: string;
        workingChanges?: Array<{
            status: string;
            file: string;
            diff?: string;
            absPath?: string;
        }>;
        testDescription: string;
        key?: string; // Tunnel UUID for custom endpoints (e.g., <uuid>.debugg.ai)
        publicUrl?: string;
        testEnvironment?: {
            url: string;
            type: 'ngrok_tunnel' | 'direct' | 'localhost';
            port?: number;
            metadata?: Record<string, any>;
        };
        context?: Record<string, any>;
    }): Promise<{ success: boolean; testSuiteUuid?: string; tunnelKey?: string; error?: string }> {
        try {
            await this.ensureInitialized();
            
            log.info('Creating commit test suite');
            
            // Use the proven backend service to create commit suite
            const commitSuite = await this.e2es.createE2eCommitSuite(request.testDescription, {
                key: request.key, // Tunnel UUID for custom endpoints
                repoName: request.repoName,
                repoPath: request.repoPath,
                branchName: request.branchName,
                commitHash: request.commitHash,
                workingChanges: request.workingChanges,
                publicUrl: request.publicUrl,
                testEnvironment: request.testEnvironment,
                ...request.context
            });

            if (commitSuite?.uuid) {
                return {
                    success: true,
                    testSuiteUuid: commitSuite.uuid,
                    tunnelKey: (commitSuite as any).tunnelKey // Backend provides tunnel key for ngrok setup
                };
            } else {
                return {
                    success: false,
                    error: 'Failed to create commit test suite'
                };
            }
        } catch (error) {
            log.error('Failed to create commit test suite', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * High-level method to get commit test suite status
     */
    async getCommitTestSuiteStatus(suiteUuid: string): Promise<any> {
        try {
            await this.ensureInitialized();
            const result = await this.e2es.getE2eCommitSuite(suiteUuid);
            
            if (!result) {
                log.warn(`No data returned for commit test suite ${suiteUuid}`);
                return null;
            }
            
            // Debug log to help troubleshoot status issues
            log.debug(`Status check for ${suiteUuid}`, {
                runStatus: result.runStatus,
                testsCount: result.tests?.length || 0,
                hasTests: !!result.tests
            });
            
            return result;
        } catch (error) {
            log.error(`Failed to get commit test suite status for ${suiteUuid}`, error);
            return null;
        }
    }

    /**
     * High-level method to wait for commit test suite completion
     */
    async waitForCommitTestSuiteCompletion(
        suiteUuid: string,
        options: {
            maxWaitTime?: number;
            pollInterval?: number;
            onProgress?: (suite: any) => void;
        } = {}
    ): Promise<any> {
        const maxWaitTime = options.maxWaitTime || 10 * 60 * 1000; // 10 minutes
        const pollInterval = options.pollInterval || 5000; // 5 seconds
        const startTime = Date.now();

        log.progress(`Waiting for test suite to complete`);

        while (Date.now() - startTime < maxWaitTime) {
            const suite = await this.getCommitTestSuiteStatus(suiteUuid);
            
            if (!suite) {
                log.error('Failed to get test suite status - received null/undefined response');
                return null;
            }

            if (options.onProgress) {
                options.onProgress(suite);
            }

            // Backend uses 'runStatus' field for commit suites
            const status = suite.runStatus;
            
            if (!status) {
                log.error('Test suite response missing runStatus field', {
                    runStatus: suite.runStatus,
                    hasTests: !!suite.tests,
                    testCount: suite.tests?.length || 0
                });
                // Continue polling in case it's a temporary issue
            } else if (status === 'completed') {
                log.success(`Test suite completed`);
                return suite;
            }

            log.debug(`Test suite status: ${status || 'undefined'}, waiting...`);
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        log.error(`Test suite timed out after ${maxWaitTime}ms`);
        return null;
    }

    /**
     * Download artifact (for test scripts, recordings, etc.)
     * Uses the proven redirect handling logic from the IDE
     */
    async downloadArtifact(url: string, originalBaseUrl?: string): Promise<Buffer | null> {
        const { downloadArtifactToBuffer } = await import('../../util/artifact-downloader');
        return downloadArtifactToBuffer(url, originalBaseUrl);
    }

    /**
     * Download artifact directly to file (more efficient for large files)
     * Uses the proven redirect handling logic from the IDE
     */
    async downloadArtifactToFile(url: string, filePath: string, originalBaseUrl?: string): Promise<boolean> {
        const { downloadArtifactToFile } = await import('../../util/artifact-downloader');
        return downloadArtifactToFile(url, filePath, originalBaseUrl);
    }
}