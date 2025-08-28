// backend/cli/client.ts - Main CLI client using adapted backend services
import { CLITransport } from './transport';
import { CLIContextProvider, CLIContextTransport } from './context';
import { createCLIE2esService, CLIE2esService } from './services/e2es';
import { createCLIUsersService, CLIUsersService } from './services/users';

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
        
        console.log('Initializing CLI Backend Client...');
        
        // Initialize context provider to gather git info
        await this.contextProvider.initialize();
        
        // Test connection
        const connectionTest = await this.transport.testConnection();
        if (!connectionTest.success) {
            throw new Error(`API connection failed: ${connectionTest.error}`);
        }
        
        this.initialized = true;
        console.log('CLI Backend Client initialized successfully');
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
        publicUrl?: string;
        testEnvironment?: {
            url: string;
            type: 'ngrok_tunnel' | 'direct' | 'localhost';
            port?: number;
            metadata?: Record<string, any>;
        };
        context?: Record<string, any>;
        key?: string; // Tunnel UUID for custom endpoints (e.g., <uuid>.debugg.ai)
    }): Promise<{ success: boolean; testSuiteUuid?: string; tunnelKey?: string; error?: string }> {
        try {
            await this.ensureInitialized();
            
            console.log('Creating commit test suite with backend services...');
            
            // Use the proven backend service to create commit suite
            const commitSuite = await this.e2es.createE2eCommitSuite(request.testDescription, {
                repoName: request.repoName,
                repoPath: request.repoPath,
                branchName: request.branchName,
                commitHash: request.commitHash,
                workingChanges: request.workingChanges,
                publicUrl: request.publicUrl,
                testEnvironment: request.testEnvironment,
                key: request.key, // Tunnel UUID for custom endpoints
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
            console.error('Failed to create commit test suite:', error);
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
            return await this.e2es.getE2eCommitSuite(suiteUuid);
        } catch (error) {
            console.error(`Failed to get commit test suite status for ${suiteUuid}:`, error);
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

        console.log(`Waiting for commit test suite ${suiteUuid} to complete...`);

        while (Date.now() - startTime < maxWaitTime) {
            const suite = await this.getCommitTestSuiteStatus(suiteUuid);
            
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
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        console.error(`Test suite ${suiteUuid} timed out after ${maxWaitTime}ms`);
        return null;
    }

    /**
     * Download artifact (for test scripts, recordings, etc.)
     */
    async downloadArtifact(url: string): Promise<Buffer | null> {
        try {
            // Use the transport to download binary data
            const axios = (this.transport as any).axios;
            if (!axios) {
                throw new Error('Axios instance not available');
            }

            const response = await axios.get(url, {
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
}