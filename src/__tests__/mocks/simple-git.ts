// Simple-git mock utilities for testing git operations
import { StatusResult, LogResult, DiffResult } from 'simple-git';

export const createMockStatusResult = (overrides: Partial<StatusResult> = {}): StatusResult => ({
  not_added: [],
  conflicted: [],
  created: [],
  deleted: [],
  modified: [],
  renamed: [],
  files: [],
  staged: [],
  ahead: 0,
  behind: 0,
  current: 'main',
  tracking: 'origin/main',
  detached: false,
  isClean: () => true,
  ...overrides
});

export const createMockLogResult = (commits: any[] = []): LogResult => ({
  all: commits,
  total: commits.length,
  latest: commits[0] || null
});

export const createMockCommit = (hash: string, message: string, author: string = 'Test Author') => ({
  hash,
  date: '2023-01-01',
  message,
  author_name: author,
  author_email: 'test@example.com',
  refs: ''
});

export const createMockDiffSummary = (files: Array<{file: string; insertions?: number; deletions?: number; binary?: boolean}> = []) => ({
  files,
  insertions: files.reduce((sum, f) => sum + (f.insertions || 0), 0),
  deletions: files.reduce((sum, f) => sum + (f.deletions || 0), 0),
  changed: files.length
});

export const mockSimpleGit = {
  status: jest.fn(),
  log: jest.fn(),
  diff: jest.fn(),
  diffSummary: jest.fn(),
  show: jest.fn(),
  revparse: jest.fn(),
  raw: jest.fn(),
  checkoutLocalBranch: jest.fn(),
  checkout: jest.fn(),
  add: jest.fn(),
  commit: jest.fn(),
  push: jest.fn(),
  pull: jest.fn(),
  fetch: jest.fn(),
  clone: jest.fn(),
  init: jest.fn()
};

export const mockSimpleGitFactory = jest.fn(() => mockSimpleGit);