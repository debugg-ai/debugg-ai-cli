// backend/cli/services/e2es.ts - CLI-adapted E2E service
import { E2eRun, E2eTest, E2eTestCommitSuite, E2eTestSuite, PaginatedResponse } from "../../types";
import { CLIContextTransport } from "../context";
import { truncateForLogging } from "../transport";
import { log } from "../../../util/logging";

export interface CLIE2esService {
    createE2eTest(description: string, params?: Record<string, any>): Promise<E2eTest | null>;
    runE2eTest(uuid: string, params?: Record<string, any>): Promise<E2eTest | null>;
    createE2eRun(fileContents: Uint8Array, filePath: string, repoName: string, branchName: string, params?: Record<string, any>): Promise<E2eRun | null>;
    getE2eRun(uuid: string, params?: Record<string, any>): Promise<E2eRun | null>;
    listE2eTests(params?: Record<string, any>): Promise<PaginatedResponse<E2eTest> | null>;
    getE2eTest(uuid: string, params?: Record<string, any>): Promise<E2eTest | null>;
    deleteE2eTest(uuid: string): Promise<void>;
    formatRunResult(e2eRun: E2eRun): string;

    createE2eTestSuite(description: string, params?: Record<string, any>): Promise<E2eTestSuite | null>;
    listE2eTestSuites(params?: Record<string, any>): Promise<PaginatedResponse<E2eTestSuite> | null>;
    getE2eTestSuite(uuid: string, params?: Record<string, any>): Promise<E2eTestSuite | null>;
    runE2eTestSuite(uuid: string, params?: Record<string, any>): Promise<E2eTestSuite | null>;

    // Commit suites - the key functionality we need for CLI
    createE2eCommitSuite(description: string, params?: Record<string, any>): Promise<E2eTestCommitSuite | null>;
    runE2eCommitSuite(uuid: string, params?: Record<string, any>): Promise<E2eTestCommitSuite | null>;
    getE2eCommitSuite(uuid: string, params?: Record<string, any>): Promise<E2eTestCommitSuite | null>;
    listE2eCommitSuites(params?: Record<string, any>): Promise<PaginatedResponse<E2eTestCommitSuite> | null>;
}

/**
 * Path normalization function adapted from proven backend logic
 * This preserves the exact logic from paramsToBody in the original backend service
 */
const processParamsForAPI = (contextTransport: CLIContextTransport, params: Record<string, any>) => {
    const filePath = params?.filePath;
    const repoName = params?.repoName;
    const branchName = params?.branchName;
    const contextProvider = contextTransport.getContextProvider();
    
    if (filePath) {
        // Use the proven path normalization logic
        const normalizedPaths = contextProvider.normalizeFilePath(filePath);
        
        return {
            ...params,
            absPath: normalizedPaths.absolutePath,
            filePath: normalizedPaths.relativePath,
            repoName: repoName ?? contextProvider.getContext().repoName,
            branchName: branchName ?? contextProvider.getContext().branchName,
        };
    }

    const body = {
        ...params,
        repoName: repoName ?? contextProvider.getContext().repoName,
        branchName: branchName ?? contextProvider.getContext().branchName,
    };
    
    log.debug('Processed API params', { repoName: body.repoName, branchName: body.branchName, paramCount: Object.keys(body).length });
    return body;
};

export const createCLIE2esService = (transport: CLIContextTransport): CLIE2esService => ({
    /**
     * Create E2E test - preserves exact backend logic
     */
    async createE2eTest(
        description: string,
        params?: Record<string, any>
    ): Promise<E2eTest | null> {
        try {
            const serverUrl = "api/v1/e2e-tests/";
            const response = await transport.post<E2eTest>(serverUrl, { description, ...params });

            log.debug("API response", truncateForLogging(response));
            return response;

        } catch (err) {
            log.error('Error creating E2E test', { error: String(err) });
            return null;
        }
    },

    /**
     * Run E2E test - preserves exact backend logic
     */
    async runE2eTest(
        uuid: string,
        params?: Record<string, any>
    ): Promise<E2eTest | null> {
        try {
            const serverUrl = `api/v1/e2e-tests/${uuid}/run/`;
            const response = await transport.post<E2eTest>(serverUrl, { ...params });

            log.debug("API response", truncateForLogging(response));
            return response;

        } catch (err) {
            log.error('Error running E2E test', { error: String(err) });
            return null;
        }
    },

    async createE2eRun(
        fileContents: Uint8Array,
        filePath: string,
        repoName: string,
        branchName: string,
        params?: Record<string, any>
    ): Promise<E2eRun | null> {
        try {
            const serverUrl = "api/v1/e2e-runs/";
            log.debug('E2E run parameters', { branchName, repoName, hasRepoPath: !!params?.repoPath });

            const contextProvider = transport.getContextProvider();
            const normalizedPaths = contextProvider.normalizeFilePath(filePath);
            
            log.debug('Path normalization', { hasFullPath: !!filePath, hasRelativePath: !!normalizedPaths.relativePath });
            
            const fileParams = {
                ...params,
                fileContents: fileContents,
                absPath: normalizedPaths.absolutePath,
                filePath: normalizedPaths.relativePath,
                repoName: repoName,
                branchName: branchName,
            };
            
            const response = await transport.post<E2eRun>(serverUrl, fileParams, undefined, false);

            log.debug("API response", truncateForLogging(response));
            return response;

        } catch (err) {
            log.error('Error creating E2E run', { error: String(err) });
            return null;
        }
    },

    /**
     * Get E2E run - preserves exact backend logic
     */
    async getE2eRun(
        uuid: string,
        params?: Record<string, any>
    ): Promise<E2eRun | null> {
        try {
            const serverUrl = `api/v1/e2e-runs/${uuid}/`;
            const response = await transport.get<E2eRun>(serverUrl, { ...params });

            log.debug("API response", truncateForLogging(response));
            return response;

        } catch (err) {
            log.error('Error fetching E2E run', { error: String(err) });
            return null;
        }
    },

    /**
     * Get E2E test - preserves exact backend logic
     */
    async getE2eTest(
        uuid: string,
        params?: Record<string, any>
    ): Promise<E2eTest | null> {
        try {
            const serverUrl = `api/v1/e2e-tests/${uuid}/`;
            const response = await transport.get<E2eTest>(serverUrl, { ...params });

            log.debug("API response", truncateForLogging(response));
            return response;

        } catch (err) {
            log.error('Error fetching E2E test', { error: String(err) });
            return null;
        }
    },

    /**
     * Delete E2E test - preserves exact backend logic
     */
    async deleteE2eTest(uuid: string): Promise<void> {
        try {
            const serverUrl = `api/v1/e2e-tests/${uuid}/`;
            await transport.delete(serverUrl);
        } catch (err) {
            log.error('Error deleting E2E test', { error: String(err) });
        }
    },

    /**
     * List E2E tests - preserves exact backend logic
     */
    async listE2eTests(
        params?: Record<string, any>
    ): Promise<PaginatedResponse<E2eTest> | null> {
        try {
            const serverUrl = `api/v1/e2e-tests/`;
            const response = await transport.get<PaginatedResponse<E2eTest>>(serverUrl, { ...params }, true);

            log.debug("API response", truncateForLogging(response));
            return response;

        } catch (err: any) {
            log.error('Error listing E2E tests', { error: String(err) });
            throw err;
        }
    },

    /**
     * Create E2E test suite - preserves exact backend logic
     */
    async createE2eTestSuite(
        description: string,
        params?: Record<string, any>
    ): Promise<E2eTestSuite | null> {
        try {
            const serverUrl = "api/v1/test-suites/generate_tests/";
            const body = processParamsForAPI(transport, {...params, description});
            const response = await transport.post<E2eTestSuite>(serverUrl, body, undefined, false);
            log.debug("API response", truncateForLogging(response));
            return response;
        } catch (err) {
            log.error('Error creating E2E test suite', { error: String(err) });
            return null;
        }
    },

    async listE2eTestSuites(params?: Record<string, any>): Promise<PaginatedResponse<E2eTestSuite> | null> {
        try {
            const serverUrl = "api/v1/test-suites/";
            const response = await transport.get<PaginatedResponse<E2eTestSuite>>(serverUrl, { ...params }, true);
            log.debug("API response", truncateForLogging(response));
            return response;
        } catch (err) {
            log.error('Error listing E2E test suites', { error: String(err) });
            return null;
        }
    },

    async getE2eTestSuite(
        uuid: string,
        params?: Record<string, any>
    ): Promise<E2eTestSuite | null> {   
        try {
            const serverUrl = `api/v1/test-suites/${uuid}/`;
            const response = await transport.get<E2eTestSuite>(serverUrl, { ...params });
            log.debug("API response", truncateForLogging(response));
            return response;
        } catch (err) {
            log.error('Error fetching E2E test suite', { error: String(err) });
            return null;
        }
    },

    async runE2eTestSuite(
        uuid: string,
        params?: Record<string, any>
    ): Promise<E2eTestSuite | null> {
        try {
            const serverUrl = `api/v1/test-suites/${uuid}/run/`;
            const response = await transport.post<E2eTestSuite>(serverUrl, { ...params });
            log.debug("API response", truncateForLogging(response));
            return response;
        } catch (err) {
            log.error('Error running E2E test suite', { error: String(err) });
            return null;
        }
    },

    /**
     * Create E2E commit suite - KEY functionality for CLI
     * Preserves exact backend logic from proven implementation
     */
    async createE2eCommitSuite(
        description: string,
        params?: Record<string, any>
    ): Promise<E2eTestCommitSuite | null> {
        try {
            const serverUrl = "api/v1/commit-suites/";
            const body = processParamsForAPI(transport, {...params, description});
            const response = await transport.post<E2eTestCommitSuite>(serverUrl, body, undefined, false);
            log.debug("API response", truncateForLogging(response));
            return response;
        } catch (err) {
            log.error('Error creating E2E commit suite', { error: String(err) });
            return null;
        }
    },

    /**
     * Run E2E commit suite - preserves exact backend logic
     */
    async runE2eCommitSuite(
        uuid: string,
        params?: Record<string, any>
    ): Promise<E2eTestCommitSuite | null> {
        try {
            const serverUrl = `api/v1/commit-suites/${uuid}/run/`;
            const response = await transport.post<E2eTestCommitSuite>(serverUrl, { ...params });
            log.debug("API response", truncateForLogging(response));
            return response;
        } catch (err) {
            log.error('Error running E2E commit suite', { error: String(err) });
            return null;
        }
    },

    /**
     * Get E2E commit suite - KEY functionality for CLI
     * Preserves exact backend logic from proven implementation
     */
    async getE2eCommitSuite(
        uuid: string,
        params?: Record<string, any>
    ): Promise<E2eTestCommitSuite | null> {
        try {
            const serverUrl = `api/v1/commit-suites/${uuid}/`;
            const response = await transport.get<E2eTestCommitSuite>(serverUrl, { ...params });    
            log.debug("API response", truncateForLogging(response));
            return response;
        } catch (err: any) {
            log.error('Error fetching E2E commit suite', { 
                error: String(err),
                status: err.response?.status,
                message: err.message
            });
            return null;
        }
    },

    async listE2eCommitSuites(params?: Record<string, any>): Promise<PaginatedResponse<E2eTestCommitSuite> | null> {
        try {
            const serverUrl = "api/v1/commit-suites/";
            const response = await transport.get<PaginatedResponse<E2eTestCommitSuite>>(serverUrl, { ...params }, true);
            log.debug("API response for commit suites", response);
            return response;
        } catch (err) {
            log.error("Error listing E2E commit suites", err);
            return null;
        }
    },

    /**
     * Format run result - preserves exact backend logic
     */
    formatRunResult(result: E2eRun): string {
        if (!result) return 'No result data available.';
        
        const duration = new Date().getTime() - new Date(result.timestamp).getTime();
        return `
🧪 Test Name: ${result.test?.name}
🧪 Test Description: ${result.test?.description}
⏱ Duration: ${duration}ms
✅ Passed: ${result.status === 'completed' && result.outcome === 'pass'}
${result.status === 'completed' && result.outcome !== 'pass' ? `\n### Failures:\n${result.outcome}` : ''}
`.trim();
    }
});