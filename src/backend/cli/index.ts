// backend/cli/index.ts - Main exports for CLI backend
export { CLIBackendClient } from './client';
export { CLITransport } from './transport';
export { CLIContextProvider, CLIContextTransport } from './context';
export { createCLIE2esService, CLIE2esService } from './services/e2es';
export { createCLIUsersService, CLIUsersService } from './services/users';
export type { CLIClientConfig } from './client';
export type { CLITransportOptions } from './transport';
export type { CLIContext } from './context';