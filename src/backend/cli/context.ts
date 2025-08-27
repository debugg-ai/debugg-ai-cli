// backend/cli/context.ts - CLI abstractions to replace IDE dependencies
import * as path from 'path';
import { GitAnalyzer } from '../../lib/git-analyzer';

/**
 * CLI context information that replaces IDE-specific data
 * This provides the same information that backend services need
 * but sourced from CLI environment instead of IDE
 */
export interface CLIContext {
    repoName: string;
    repoPath: string;
    branchName: string;
    filePath?: string;
}

/**
 * CLI-compatible abstraction layer that replaces IDE interface dependencies
 * Provides the same functionality as IDE interface but for CLI environment
 */
export class CLIContextProvider {
    private gitAnalyzer: GitAnalyzer;
    private context: CLIContext;

    constructor(repoPath: string) {
        this.gitAnalyzer = new GitAnalyzer({ repoPath });
        this.context = {
            repoName: '', // Will be populated during initialization
            repoPath: repoPath,
            branchName: '', // Will be populated during initialization
        };
    }

    /**
     * Initialize the context by gathering git information
     * This replaces the IDE-based project analysis
     */
    async initialize(): Promise<void> {
        // Get repo name using existing GitAnalyzer logic
        this.context.repoName = this.gitAnalyzer.getRepoName();
        
        // Get current branch
        const branchInfo = await this.gitAnalyzer.getCurrentBranchInfo();
        this.context.branchName = branchInfo.branch;
        
        console.log('CLI Context initialized:', {
            repoName: this.context.repoName,
            repoPath: this.context.repoPath,
            branchName: this.context.branchName
        });
    }

    /**
     * Get project context for API calls
     * This replaces the addProjectToCall() method from DebuggTransport
     */
    async getProjectContext(): Promise<{
        repoName: string;
        repoPath: string;
        branchName: string;
        filePath?: string;
    }> {
        const result: any = {
            repoName: this.context.repoName,
            repoPath: this.context.repoPath,
            branchName: this.context.branchName,
        };
        
        if (this.context.filePath) {
            result.filePath = this.context.filePath;
        }
        
        return result;
    }

    /**
     * Set the current file path context
     * This replaces IDE.getCurrentFile()
     */
    setCurrentFile(filePath?: string): void {
        if (filePath) {
            this.context.filePath = filePath;
        } else {
            delete (this.context as any).filePath;
        }
    }

    /**
     * Get repository information
     * This replaces IDE git methods
     */
    async getRepoInfo(): Promise<{
        repoName: string;
        repoPath: string;
        branchName: string;
    }> {
        return {
            repoName: this.context.repoName,
            repoPath: this.context.repoPath,
            branchName: this.context.branchName,
        };
    }

    /**
     * Convert absolute path to relative path based on repo
     * This preserves the proven path normalization logic from backend services
     */
    normalizeFilePath(absolutePath: string): {
        relativePath: string;
        absolutePath: string;
    } {
        let relativePath = absolutePath;
        
        // Convert absolute path to relative path (preserve proven logic from paramsToBody)
        if (this.context.repoPath && absolutePath.startsWith(this.context.repoPath)) {
            relativePath = absolutePath.replace(this.context.repoPath + "/", "");
        } else if (this.context.repoName) {
            // Handle repo name-based path extraction (preserve proven logic)
            const repoBaseName = this.context.repoName.split("/").pop() || "";
            const splitPath = absolutePath.split(repoBaseName);
            if (splitPath.length === 2) {
                relativePath = splitPath[1]?.replace(/^\/+/, "") || absolutePath;
            }
        }
        
        return {
            relativePath,
            absolutePath
        };
    }

    /**
     * Process parameters for API calls with path normalization
     * This preserves the proven paramsToBody logic from backend services
     */
    processParams(params: Record<string, any>): Record<string, any> {
        const filePath = params?.filePath;
        
        if (filePath) {
            const normalizedPaths = this.normalizeFilePath(filePath);
            
            return {
                ...params,
                absPath: normalizedPaths.absolutePath,
                filePath: normalizedPaths.relativePath,
                repoName: this.context.repoName,
                branchName: this.context.branchName,
                repoPath: this.context.repoPath,
            };
        }
        
        return {
            ...params,
            repoName: this.context.repoName,
            branchName: this.context.branchName,
            repoPath: this.context.repoPath,
        };
    }

    /**
     * Get current context
     */
    getContext(): CLIContext {
        return { ...this.context };
    }

    /**
     * Update context
     */
    updateContext(updates: Partial<CLIContext>): void {
        this.context = { ...this.context, ...updates };
    }
}

/**
 * Enhanced CLI transport that includes context
 * This combines the proven transport layer with CLI context
 */
export class CLIContextTransport {
    constructor(
        private transport: any, // CLITransport - using any to avoid circular imports
        private contextProvider: CLIContextProvider
    ) {}

    /**
     * GET request with automatic context injection
     */
    async get<T = unknown>(url: string, params?: any, addProjectToCall: boolean = true): Promise<T> {
        const contextParams = addProjectToCall 
            ? await this.contextProvider.getProjectContext() 
            : {};
        
        return this.transport.get(url, { ...params, ...contextParams }) as Promise<T>;
    }

    /**
     * POST request with automatic context injection
     */
    async post<T = unknown>(url: string, data?: any, cfg?: any, addProjectToCall: boolean = true): Promise<T> {
        // For post calls, we default to injecting the project information (preserve backend logic)
        const shouldAddContext = addProjectToCall === undefined || addProjectToCall === true;
        const contextParams = shouldAddContext 
            ? await this.contextProvider.getProjectContext() 
            : {};
        
        const processedData = this.contextProvider.processParams({ ...data, ...contextParams });
        
        return this.transport.post(url, processedData, cfg) as Promise<T>;
    }

    /**
     * PUT request with automatic context injection
     */
    async put<T = unknown>(url: string, data?: any, cfg?: any, addProjectToCall: boolean = true): Promise<T> {
        const contextParams = addProjectToCall 
            ? await this.contextProvider.getProjectContext() 
            : {};
            
        const processedData = this.contextProvider.processParams({ ...data, ...contextParams });
        
        return this.transport.put(url, processedData, cfg) as Promise<T>;
    }

    /**
     * DELETE request
     */
    async delete<T = unknown>(url: string, cfg?: any): Promise<T> {
        return this.transport.delete(url, cfg) as Promise<T>;
    }

    /**
     * Direct access to underlying transport for special cases
     */
    getTransport() {
        return this.transport;
    }

    /**
     * Get context provider for direct access
     */
    getContextProvider(): CLIContextProvider {
        return this.contextProvider;
    }
}