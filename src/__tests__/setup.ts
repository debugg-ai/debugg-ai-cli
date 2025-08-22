// Test setup and global mocks
import 'jest';

// Set NODE_ENV to 'test' to prevent process event listeners from being added in CLI
process.env.NODE_ENV = 'test';

// Mock console methods to reduce noise in tests
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Global test timeout
jest.setTimeout(30000);