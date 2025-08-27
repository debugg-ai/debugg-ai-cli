// backend/cli/services/users.ts - CLI-adapted users service
import { CLIContextTransport } from "../context";

// Simplified user config for CLI - we don't need all IDE-specific settings
export interface CLIUserConfig {
    id?: string;
    email?: string;
    debuggAiRepoSettings?: {
        repoName?: string;
        repoPath?: string;
        primaryLanguage?: string;
        testingLanguage?: string;
        testingFramework?: string;
        framework?: string;
    };
    debuggAiRepoSettingsLs?: Array<{
        repoName?: string;
        repoPath?: string;
        primaryLanguage?: string;
        testingLanguage?: string;
        testingFramework?: string;
        framework?: string;
    }>;
}

export interface CLIUsersService {
    getUserConfig(): Promise<CLIUserConfig | null>;
    getCurrentUser(): Promise<{ id?: string; email?: string } | null>;
}

export const createCLIUsersService = (transport: CLIContextTransport): CLIUsersService => ({
    /**
     * Get user configuration - adapted for CLI
     * Uses simpler endpoint that works with API key auth
     */
    async getUserConfig(): Promise<CLIUserConfig | null> {
        try {
            console.log("getUserConfig called");
            console.log("Transport auth header:", transport.getTransport().getAuthorizationHeader?.());
            
            // Use simpler user endpoint that works with Token auth
            const serverUrl = "api/v1/users/me/";
            
            if (transport.getTransport().getAuthorizationHeader()) {
                const response = await transport.get<CLIUserConfig>(serverUrl, {}, false);
                console.log("Raw API response:", response);
                
                // Enhance response with current repo context
                const context = transport.getContextProvider().getContext();
                if (response && context.repoName) {
                    // Add current repo settings based on context
                    response.debuggAiRepoSettings = {
                        repoName: context.repoName,
                        repoPath: context.repoPath,
                        // Note: We don't have project analysis in CLI yet, but can be added
                        primaryLanguage: 'typescript', // Default or could be detected
                        testingLanguage: 'typescript',
                        testingFramework: 'playwright',
                        framework: 'react', // Default or could be detected
                    };
                }
                
                return response;
            } else {
                console.log("Cannot call user config endpoint without auth header");
                return null;
            }
        } catch (err) {
            console.error("Error fetching user config:", err);
            return null;
        }
    },

    /**
     * Get current user information - useful for API key validation
     */
    async getCurrentUser(): Promise<{ id?: string; email?: string } | null> {
        try {
            const serverUrl = "api/v1/users/me/";
            const response = await transport.get<{ id?: string; email?: string }>(serverUrl, {}, false);
            return response;
        } catch (err) {
            console.error("Error fetching current user:", err);
            return null;
        }
    },
});