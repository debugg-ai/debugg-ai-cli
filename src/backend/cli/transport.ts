// backend/cli/transport.ts - CLI-compatible transport layer
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import {
    objToCamelCase,
    objToSnakeCase,
} from "../../util/objectNaming";

/** Constructor options for CLI transport */
export interface CLITransportOptions {
    baseUrl: string;
    apiKey: string;
    timeout?: number;
    /** You can pass a pre‑configured axios instance (e.g. for tests) */
    instance?: AxiosInstance;
}

/**
 * CLI-compatible transport layer based on proven AxiosTransport
 * Uses simple API key authentication instead of complex auth system
 */
export class CLITransport {
    protected readonly axios: AxiosInstance;
    private instanceId: string = Math.random().toString(36).substring(7);
    private apiKey: string;

    constructor({ baseUrl, apiKey, timeout, instance }: CLITransportOptions) {
        this.apiKey = apiKey;
        
        // Use an injected instance or create one
        this.axios = instance ?? axios.create({
            baseURL: baseUrl.replace(/\/+$/, "/"),
            timeout: timeout || 30000,
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                'User-Agent': '@debugg-ai/cli',
            },
        });
        
        // Set authorization header in common headers
        this.axios.defaults.headers.common['Authorization'] = `Token ${apiKey}`;
        
        console.log(`CLITransport created with baseURL: ${this.axios.defaults.baseURL}, instanceId: ${this.instanceId}`);
        console.log(`Auth header: Token ${apiKey.substring(0, 10)}...`);

        /* ---------- INTERCEPTORS ---------- */
        // Request → snake_case (preserve proven logic)
        this.axios.interceptors.request.use((cfg) => {
            console.log(`Request interceptor - URL: ${cfg.url}, Method: ${cfg.method}, instanceId: ${this.instanceId}`);
            console.log(`Request Authorization:`, cfg.headers?.Authorization);
            
            // Verify the Authorization header format
            const authHeader = cfg.headers?.Authorization;
            if (authHeader && typeof authHeader === 'string') {
                if (!authHeader.startsWith('Token ')) {
                    console.warn(`⚠️ Authorization header doesn't start with 'Token ': ${authHeader}`);
                }
                const token = authHeader.replace('Token ', '');
                if (token.length < 10) {
                    console.warn(`⚠️ Token seems too short: ${token.length} characters`);
                }
            }
            
            if (cfg.data && typeof cfg.data === "object") {
                cfg.data = objToSnakeCase(cfg.data);
            }
            if (cfg.params && typeof cfg.params === "object") {
                cfg.params = objToSnakeCase(cfg.params);
            }
            return cfg;
        });

        // Response interceptor - handle errors and transform data (preserve proven logic)
        this.axios.interceptors.response.use(
            (res: AxiosResponse) => {
                res.data = objToCamelCase(res.data);
                return res;
            },
            async (err) => {
                console.log(`Response interceptor caught error:`, {
                    status: err.response?.status,
                    detail: err.response?.data?.detail,
                    url: err.config?.url,
                    instanceId: this.instanceId
                });
                
                // Handle authentication failures
                if (err.response?.status === 401) {
                    console.error('Authentication failed. Please check your API key.');
                    throw new Error('Authentication failed. Please check your API key.');
                }
                if (err.response?.status === 403) {
                    console.error('Access forbidden. Please check your API key permissions.');
                    throw new Error('Access forbidden. Please check your API key permissions.');
                }
                if (err.response?.status >= 500) {
                    const message = `Server error: ${err.response.status} - ${err.response.statusText}`;
                    console.error(message);
                    throw new Error(message);
                }
                
                // Transform the error
                return Promise.reject(
                    (err.response && err.response.data) || "Unknown Axios error",
                );
            }
        );
    }

    /* ---------- SHORTHAND METHODS (preserve proven interface) ---------- */
    async request<T = unknown>(cfg: AxiosRequestConfig): Promise<T> {
        const res = await this.axios.request<T>(cfg);
        return res.data;
    }

    get<T = unknown>(url: string, params?: any) {
        return this.request<T>({ url, method: "GET", params });
    }

    post<T = unknown>(url: string, data?: any, cfg?: AxiosRequestConfig) {
        return this.request<T>({ url, method: "POST", data, ...cfg });
    }

    put<T = unknown>(url: string, data?: any, cfg?: AxiosRequestConfig) {
        return this.request<T>({ url, method: "PUT", data, ...cfg });
    }

    delete<T = unknown>(url: string, cfg?: AxiosRequestConfig) {
        return this.request<T>({ url, method: "DELETE", ...cfg });
    }

    /**
     * Update the API key for this transport instance.
     */
    updateApiKey(apiKey: string): void {
        console.log(`CLITransport.updateApiKey called with apiKey: ${apiKey.substring(0, 10)}..., instanceId: ${this.instanceId}`);
        this.apiKey = apiKey;
        if (this.axios) {
            console.log(`Before update - Authorization header: ${this.axios.defaults.headers.common['Authorization']}`);
            this.axios.defaults.headers.common['Authorization'] = `Token ${apiKey}`;
            // Also update the instance headers directly
            this.axios.defaults.headers['Authorization'] = `Token ${apiKey}`;
            console.log(`After update - Authorization header: ${this.axios.defaults.headers.common['Authorization']}`);
            console.log(`Updated Authorization header to: Token ${apiKey.substring(0, 10)}...`);
        } else {
            console.warn('Axios instance not available for API key update');
        }
    }

    /**
     * Get the current authorization header for debugging.
     */
    getAuthorizationHeader(): string | undefined {
        return this.axios?.defaults.headers.common['Authorization'] as string | undefined;
    }

    /**
     * Verify that the axios instance is properly configured with the current API key.
     */
    verifyApiKeyConfiguration(): void {
        console.log(`Verifying API key configuration for instanceId: ${this.instanceId}`);
        console.log(`Default headers:`, this.axios?.defaults.headers);
        console.log(`Common headers:`, this.axios?.defaults.headers.common);
        console.log(`Authorization header:`, this.axios?.defaults.headers.common['Authorization']);
    }

    /**
     * Test the API connection and authentication
     */
    async testConnection(): Promise<{ success: boolean; error?: string }> {
        try {
            // Test with a simple endpoint that should work with valid API key
            await this.get('/api/v1/users/me/');
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Connection test failed'
            };
        }
    }
}