// backend/cli/transport.ts - CLI-compatible transport layer
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import {
    objToCamelCase,
    objToSnakeCase,
} from "../../util/objectNaming";
import { log } from "../../util/logging";

/**
 * Utility function to truncate large objects for logging
 */
export function truncateForLogging(obj: any, maxChars: number = 500): any {
    if (obj === null || obj === undefined) return obj;
    
    // If it's an array, show first few items and count
    if (Array.isArray(obj)) {
        const truncated = obj.slice(0, 2);
        return truncated.length < obj.length 
            ? [...truncated, `... ${obj.length - truncated.length} more items`]
            : truncated;
    }
    
    // If it's an object, show essential fields only
    if (typeof obj === 'object') {
        const essential: any = {};
        
        // Always include these fields if they exist
        const keyFields = ['id', 'uuid', 'runStatus', 'status', 'name', 'title'];
        keyFields.forEach(key => {
            if (obj[key] !== undefined) {
                essential[key] = obj[key];
            }
        });
        
        // Special handling for description - heavily truncate
        if (obj.description) {
            const desc = String(obj.description);
            essential.description = desc.length > 100 ? desc.substring(0, 100) + '... (truncated)' : desc;
        }
        
        // Add counts for arrays
        Object.keys(obj).forEach(key => {
            if (Array.isArray(obj[key])) {
                essential[`${key}Count`] = obj[key].length;
            }
        });
        
        return essential;
    }
    
    // For strings or other primitives, truncate if too long
    const str = String(obj);
    return str.length <= maxChars ? obj : str.substring(0, maxChars) + '... (truncated)';
}

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

    constructor({ baseUrl, apiKey, timeout, instance }: CLITransportOptions) {
        
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
        
        log.debug(`CLITransport created with baseURL: ${this.axios.defaults.baseURL}`);

        /* ---------- INTERCEPTORS ---------- */
        // Request → snake_case (preserve proven logic)
        this.axios.interceptors.request.use((cfg) => {
            log.debug(`${cfg.method?.toUpperCase()} ${cfg.url}`);
            
            // Verify the Authorization header format
            const authHeader = cfg.headers?.Authorization;
            if (authHeader && typeof authHeader === 'string') {
                if (!authHeader.startsWith('Token ')) {
                    log.warn(`Authorization header doesn't start with 'Token '`);
                }
                const token = authHeader.replace('Token ', '');
                if (token.length < 10) {
                    log.warn(`Token seems too short: ${token.length} characters`);
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
                // Show full error response for debugging
                const errorData = err.response?.data;
                let errorMessage = '';

                // Extract meaningful error message from response
                if (errorData) {
                    if (typeof errorData === 'string') {
                        // If it's HTML, try to extract the title or body text
                        if (errorData.includes('<!DOCTYPE html>')) {
                            const titleMatch = errorData.match(/<title>(.*?)<\/title>/i);
                            const h1Match = errorData.match(/<h1>(.*?)<\/h1>/i);
                            if (titleMatch) {
                                errorMessage = `HTML Error Page: ${titleMatch[1]}`;
                            } else if (h1Match) {
                                errorMessage = `HTML Error: ${h1Match[1]}`;
                            } else {
                                errorMessage = 'HTML error page returned (likely wrong endpoint or method)';
                            }
                        } else {
                            errorMessage = errorData;
                        }
                    } else if (errorData.detail) {
                        errorMessage = errorData.detail;
                    } else if (errorData.message) {
                        errorMessage = errorData.message;
                    } else if (errorData.error) {
                        errorMessage = errorData.error;
                    } else {
                        errorMessage = JSON.stringify(errorData);
                    }
                }

                log.error(`API Error: ${err.response?.status} ${err.config?.method?.toUpperCase()} ${err.config?.url}`);
                log.error(`Error details: ${errorMessage || 'No error details available'}`);

                // Log request data for debugging POST/PUT/PATCH failures
                if (err.config?.data && ['POST', 'PUT', 'PATCH'].includes(err.config?.method?.toUpperCase())) {
                    try {
                        const requestData = typeof err.config.data === 'string'
                            ? JSON.parse(err.config.data)
                            : err.config.data;
                        log.debug('Request data that failed:', truncateForLogging(requestData));
                    } catch (e) {
                        // Ignore JSON parse errors
                    }
                }

                // Handle specific HTTP status codes
                if (err.response?.status === 404) {
                    const endpoint = err.config?.url || 'unknown';
                    log.error(`Endpoint not found: ${endpoint}`);
                    log.error('This likely means the API endpoint does not exist or the URL is incorrect');
                    throw new Error(`API endpoint not found: ${endpoint}. Please check the API version and endpoint path.`);
                }
                if (err.response?.status === 401) {
                    log.error('Authentication failed. Please check your API key.');
                    throw new Error('Authentication failed. Please check your API key.');
                }
                if (err.response?.status === 403) {
                    log.error('Access forbidden. Please check your API key permissions.');
                    throw new Error('Access forbidden. Please check your API key permissions.');
                }
                if (err.response?.status >= 500) {
                    const message = `Server error: ${err.response.status} - ${err.response.statusText}`;
                    log.error(message);
                    throw new Error(message);
                }

                // Transform the error with better message
                const finalError = errorMessage || err.response?.data || "Unknown API error";
                return Promise.reject(finalError);
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

    patch<T = unknown>(url: string, data?: any, cfg?: AxiosRequestConfig) {
        return this.request<T>({ url, method: "PATCH", data, ...cfg });
    }

    delete<T = unknown>(url: string, cfg?: AxiosRequestConfig) {
        return this.request<T>({ url, method: "DELETE", ...cfg });
    }

    /**
     * Update the API key for this transport instance.
     */
    updateApiKey(apiKey: string): void {
        log.debug(`Updating API key`);
        if (this.axios) {
            this.axios.defaults.headers.common['Authorization'] = `Token ${apiKey}`;
            this.axios.defaults.headers['Authorization'] = `Token ${apiKey}`;
            log.debug(`API key updated`);
        } else {
            log.warn('Axios instance not available for API key update');
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
        log.debug(`Verifying API key configuration`);
        const authHeader = this.axios?.defaults.headers.common['Authorization'];
        log.debug(`Authorization configured: ${authHeader ? 'Yes' : 'No'}`);
    }

    /**
     * Test the API connection and authentication
     */
    async testConnection(): Promise<{ success: boolean; error?: string }> {
        try {
            // Test with a simple endpoint that should work with valid API key
            // Try /api/v1/users/me/ first, fall back to a simple health check
            try {
                await this.get('/api/v1/users/me/');
                return { success: true };
            } catch (userError) {
                // If users/me fails, try a simple listing endpoint to verify auth works
                await this.get('/api/v1/e2e-tests/commit-suites/?limit=1');
                return { success: true };
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Connection test failed'
            };
        }
    }
}