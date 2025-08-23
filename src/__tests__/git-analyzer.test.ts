import { simpleGit } from 'simple-git';
import * as fs from 'fs-extra';
import { GitAnalyzer, WorkingChange, BranchInfo } from '../lib/git-analyzer';
import { 
  mockSimpleGit, 
  mockSimpleGitFactory, 
  createMockStatusResult, 
  createMockLogResult, 
  createMockCommit,
  createMockDiffSummary 
} from './mocks/simple-git';
import { mockFsExtra, setupMockFileSystem } from './mocks/fs-extra';

// Mock dependencies
jest.mock('simple-git');
jest.mock('fs-extra');

const mockedSimpleGit = simpleGit as jest.MockedFunction<typeof simpleGit>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('GitAnalyzer', () => {
  let analyzer: GitAnalyzer;
  const repoPath = '/test/repo';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup fs-extra mocks
    setupMockFileSystem({
      '/test/repo/.git': true,
      '/test/repo/src/test.ts': 'test file content',
      '/test/repo/package.json': '{"name": "test"}'
    });

    // Setup simple-git mocks
    mockedSimpleGit.mockReturnValue(mockSimpleGit as any);
    
    analyzer = new GitAnalyzer({ repoPath });
  });

  describe('constructor', () => {
    it('should initialize with correct options', () => {
      expect(mockedSimpleGit).toHaveBeenCalledWith(repoPath);
    });

    it('should use default ignored folders', () => {
      const expectedIgnoredFolders = [
        'node_modules', 
        'dist', 
        'build', 
        'out',
        '.git',
        '.github',
        'coverage',
        'tests/debugg-ai'
      ];
      
      const testAnalyzer = new GitAnalyzer({ repoPath });
      expect((testAnalyzer as any).ignoredFolders).toEqual(expectedIgnoredFolders);
    });

    it('should accept custom ignored folders', () => {
      const customIgnored = ['custom', 'folders'];
      const testAnalyzer = new GitAnalyzer({ 
        repoPath, 
        ignoredFolders: customIgnored 
      });
      
      expect((testAnalyzer as any).ignoredFolders).toEqual(customIgnored);
    });
  });

  describe('getCurrentBranchInfo', () => {
    it('should get branch info from git commands when no env vars set', async () => {
      // Ensure no environment variables are set
      delete process.env.GITHUB_HEAD_REF;
      delete process.env.GITHUB_REF_NAME;
      
      mockSimpleGit.revparse
        .mockResolvedValueOnce('feature/test-branch')
        .mockResolvedValueOnce('abc123def456');

      const result = await analyzer.getCurrentBranchInfo();

      expect(mockSimpleGit.revparse).toHaveBeenCalledWith(['--abbrev-ref', 'HEAD']);
      expect(mockSimpleGit.revparse).toHaveBeenCalledWith(['HEAD']);
      expect(result).toEqual({
        branch: 'feature/test-branch',
        commitHash: 'abc123def456'
      });
    });

    it('should use environment variables when available', async () => {
      process.env.GITHUB_HEAD_REF = 'feature/env-branch';
      mockSimpleGit.revparse.mockResolvedValue('abc123def456');

      const result = await analyzer.getCurrentBranchInfo();

      // When env var is set, should only call revparse once for commit hash
      expect(mockSimpleGit.revparse).toHaveBeenCalledWith(['HEAD']);
      expect(mockSimpleGit.revparse).toHaveBeenCalledTimes(1);
      expect(result.branch).toBe('feature/env-branch');
      expect(result.commitHash).toBe('abc123def456');
      
      delete process.env.GITHUB_HEAD_REF;
    });

    it('should use GITHUB_REF_NAME when GITHUB_HEAD_REF is not available', async () => {
      delete process.env.GITHUB_HEAD_REF; // Ensure GITHUB_HEAD_REF is not set
      process.env.GITHUB_REF_NAME = 'refs/heads/main';
      mockSimpleGit.revparse.mockResolvedValue('abc123def456');

      const result = await analyzer.getCurrentBranchInfo();

      // When env var is set, should only call revparse once for commit hash
      expect(mockSimpleGit.revparse).toHaveBeenCalledWith(['HEAD']);
      expect(mockSimpleGit.revparse).toHaveBeenCalledTimes(1);
      expect(result.branch).toBe('main');
      expect(result.commitHash).toBe('abc123def456');
      
      delete process.env.GITHUB_REF_NAME;
    });

    it('should handle detached HEAD state', async () => {
      // Ensure no environment variables are set  
      delete process.env.GITHUB_HEAD_REF;
      delete process.env.GITHUB_REF_NAME;
      
      mockSimpleGit.revparse
        .mockResolvedValueOnce('HEAD')
        .mockResolvedValueOnce('abc123def456');

      const result = await analyzer.getCurrentBranchInfo();

      expect(mockSimpleGit.revparse).toHaveBeenCalledWith(['--abbrev-ref', 'HEAD']);
      expect(mockSimpleGit.revparse).toHaveBeenCalledWith(['HEAD']);
      expect(result.branch).toBe('main'); // fallback for detached HEAD
      expect(result.commitHash).toBe('abc123def456');
    });

    it('should remove refs/heads/ prefix', async () => {
      delete process.env.GITHUB_HEAD_REF; // Ensure GITHUB_HEAD_REF is not set
      process.env.GITHUB_REF_NAME = 'refs/heads/feature/test';
      mockSimpleGit.revparse.mockResolvedValue('abc123def456');

      const result = await analyzer.getCurrentBranchInfo();

      // When env var is set, should only call revparse once for commit hash
      expect(mockSimpleGit.revparse).toHaveBeenCalledWith(['HEAD']);
      expect(mockSimpleGit.revparse).toHaveBeenCalledTimes(1);
      expect(result.branch).toBe('feature/test');
      expect(result.commitHash).toBe('abc123def456');
      
      delete process.env.GITHUB_REF_NAME;
    });

    it('should handle errors gracefully', async () => {
      // Ensure no environment variables are set
      delete process.env.GITHUB_HEAD_REF;
      delete process.env.GITHUB_REF_NAME;
      
      mockSimpleGit.revparse.mockRejectedValue(new Error('Git error'));

      const result = await analyzer.getCurrentBranchInfo();

      expect(result).toEqual({
        branch: 'main',
        commitHash: 'unknown'
      });
    });
  });

  describe('getWorkingChanges', () => {
    beforeEach(() => {
      // Ensure no environment variables are set so git commands are used
      delete process.env.GITHUB_HEAD_REF;
      delete process.env.GITHUB_REF_NAME;
      
      // Mock getCurrentBranchInfo
      mockSimpleGit.revparse
        .mockResolvedValueOnce('main')
        .mockResolvedValueOnce('abc123');
    });

    it('should get modified files with diffs', async () => {
      const mockStatus = createMockStatusResult({
        modified: ['src/file1.ts', 'src/file2.ts'],
        staged: [],
        not_added: [],
        deleted: []
      });

      mockSimpleGit.status.mockResolvedValue(mockStatus);
      mockSimpleGit.diff
        .mockResolvedValueOnce('diff for file1')
        .mockResolvedValueOnce('diff for file2');

      const result = await analyzer.getWorkingChanges();

      expect(mockSimpleGit.status).toHaveBeenCalled();
      expect(mockSimpleGit.diff).toHaveBeenCalledWith(['HEAD', '--', 'src/file1.ts']);
      expect(mockSimpleGit.diff).toHaveBeenCalledWith(['HEAD', '--', 'src/file2.ts']);
      
      expect(result.changes).toHaveLength(2);
      expect(result.changes[0]).toEqual({
        status: 'M',
        file: 'src/file1.ts',
        diff: 'diff for file1'
      });
    });

    it('should get staged files with cached diffs', async () => {
      const mockStatus = createMockStatusResult({
        modified: [],
        staged: ['src/staged.ts'],
        not_added: [],
        deleted: []
      });

      mockSimpleGit.status.mockResolvedValue(mockStatus);
      mockSimpleGit.diff.mockResolvedValue('cached diff');

      const result = await analyzer.getWorkingChanges();

      expect(mockSimpleGit.diff).toHaveBeenCalledWith(['--cached', '--', 'src/staged.ts']);
      expect(result.changes[0]).toEqual({
        status: 'A',
        file: 'src/staged.ts',
        diff: 'cached diff'
      });
    });

    it('should get untracked files with content', async () => {
      const mockStatus = createMockStatusResult({
        modified: [],
        staged: [],
        not_added: ['src/new-file.ts'],
        deleted: []
      });

      mockSimpleGit.status.mockResolvedValue(mockStatus);
      const readFile = jest.mocked(require('fs-extra').readFile);
      readFile.mockResolvedValue('new file content');

      const result = await analyzer.getWorkingChanges();

      expect(readFile).toHaveBeenCalledWith('/test/repo/src/new-file.ts', 'utf8');
      expect(result.changes[0]).toEqual({
        status: '??',
        file: 'src/new-file.ts',
        diff: 'new file content'
      });
    });

    it('should get deleted files', async () => {
      const mockStatus = createMockStatusResult({
        modified: [],
        staged: [],
        not_added: [],
        deleted: ['src/deleted.ts']
      });

      mockSimpleGit.status.mockResolvedValue(mockStatus);

      const result = await analyzer.getWorkingChanges();

      expect(result.changes[0]).toEqual({
        status: 'D',
        file: 'src/deleted.ts',
        diff: '--- File deleted ---'
      });
    });

    it('should ignore files in ignored folders', async () => {
      const mockStatus = createMockStatusResult({
        modified: ['src/file.ts', 'node_modules/package/file.js', 'dist/build.js'],
        staged: [],
        not_added: [],
        deleted: []
      });

      mockSimpleGit.status.mockResolvedValue(mockStatus);
      mockSimpleGit.diff.mockResolvedValue('diff content');

      const result = await analyzer.getWorkingChanges();

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]?.file).toBe('src/file.ts');
    });

    it('should handle diff errors gracefully', async () => {
      const mockStatus = createMockStatusResult({
        modified: ['src/file.ts'],
        staged: [],
        not_added: [],
        deleted: []
      });

      mockSimpleGit.status.mockResolvedValue(mockStatus);
      mockSimpleGit.diff.mockRejectedValue(new Error('Diff error'));

      const result = await analyzer.getWorkingChanges();

      expect(result.changes[0]).toEqual({
        status: 'M',
        file: 'src/file.ts'
      });
    });

    it('should handle file read errors gracefully', async () => {
      const mockStatus = createMockStatusResult({
        modified: [],
        staged: [],
        not_added: ['src/unreadable.ts'],
        deleted: []
      });

      mockSimpleGit.status.mockResolvedValue(mockStatus);
      mockFsExtra.readFile.mockRejectedValue(new Error('File read error'));

      const result = await analyzer.getWorkingChanges();

      expect(result.changes[0]).toEqual({
        status: '??',
        file: 'src/unreadable.ts'
      });
    });

    it('should handle status errors gracefully', async () => {
      mockSimpleGit.status.mockRejectedValue(new Error('Status error'));

      const result = await analyzer.getWorkingChanges();

      expect(result.changes).toHaveLength(0);
    });
  });

  describe('getCommitChanges', () => {
    const commitHash = 'abc123def';

    beforeEach(() => {
      // Ensure no environment variables are set so git commands are used
      delete process.env.GITHUB_HEAD_REF;
      delete process.env.GITHUB_REF_NAME;
      
      // Mock getCurrentBranchInfo
      mockSimpleGit.revparse
        .mockResolvedValueOnce('main')
        .mockResolvedValueOnce('current123');
    });

    it('should get commit changes with correct status detection', async () => {
      const mockDiffSummary = createMockDiffSummary([
        { file: 'src/added.ts', insertions: 10, deletions: 0 },
        { file: 'src/modified.ts', insertions: 5, deletions: 3 },
        { file: 'src/deleted.ts', insertions: 0, deletions: 8 }
      ]);

      mockSimpleGit.diffSummary.mockResolvedValue(mockDiffSummary);
      mockSimpleGit.show
        .mockResolvedValueOnce('added file diff')
        .mockResolvedValueOnce('modified file diff')
        .mockResolvedValueOnce('deleted file diff');

      const result = await analyzer.getCommitChanges(commitHash);

      expect(mockSimpleGit.diffSummary).toHaveBeenCalledWith([`${commitHash}^`, commitHash]);
      expect(result.changes).toHaveLength(3);
      
      expect(result.changes[0]).toEqual({
        status: 'A',
        file: 'src/added.ts',
        diff: 'added file diff'
      });
      
      expect(result.changes[1]).toEqual({
        status: 'M',
        file: 'src/modified.ts',
        diff: 'modified file diff'
      });
      
      expect(result.changes[2]).toEqual({
        status: 'D',
        file: 'src/deleted.ts',
        diff: 'deleted file diff'
      });
    });

    it('should handle binary files', async () => {
      const mockDiffSummary = createMockDiffSummary([
        { file: 'image.png', binary: true }
      ]);

      mockSimpleGit.diffSummary.mockResolvedValue(mockDiffSummary);
      mockSimpleGit.show.mockResolvedValue('binary file diff');

      const result = await analyzer.getCommitChanges(commitHash);

      expect(result.changes[0]?.status).toBe('M'); // Default for binary files
    });

    it('should ignore files in ignored folders', async () => {
      const mockDiffSummary = createMockDiffSummary([
        { file: 'src/file.ts', insertions: 5, deletions: 0 },
        { file: 'node_modules/package.json', insertions: 1, deletions: 0 }
      ]);

      mockSimpleGit.diffSummary.mockResolvedValue(mockDiffSummary);
      mockSimpleGit.show.mockResolvedValue('diff content');

      const result = await analyzer.getCommitChanges(commitHash);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]?.file).toBe('src/file.ts');
    });

    it('should handle show errors gracefully', async () => {
      const mockDiffSummary = createMockDiffSummary([
        { file: 'src/file.ts', insertions: 5, deletions: 0 }
      ]);

      mockSimpleGit.diffSummary.mockResolvedValue(mockDiffSummary);
      mockSimpleGit.show.mockRejectedValue(new Error('Show error'));

      const result = await analyzer.getCommitChanges(commitHash);

      expect(result.changes[0]).toEqual({
        status: 'A',
        file: 'src/file.ts'
      });
    });

    it('should update branch info with provided commit hash', async () => {
      const mockDiffSummary = createMockDiffSummary([]);
      mockSimpleGit.diffSummary.mockResolvedValue(mockDiffSummary);

      const result = await analyzer.getCommitChanges(commitHash);

      expect(result.branchInfo.commitHash).toBe(commitHash);
    });
  });

  describe('getCommitInfo', () => {
    const commitHash = 'abc123def';

    it('should get detailed commit information', async () => {
      const mockCommit = createMockCommit(commitHash, 'Test commit message');
      const mockLog = createMockLogResult([mockCommit]);
      const mockDiffSummary = createMockDiffSummary([
        { file: 'src/file1.ts' },
        { file: 'src/file2.ts' }
      ]);

      mockSimpleGit.log.mockResolvedValue(mockLog);
      mockSimpleGit.diffSummary.mockResolvedValue(mockDiffSummary);
      mockSimpleGit.show.mockResolvedValue('full commit diff');

      const result = await analyzer.getCommitInfo(commitHash);

      expect(mockSimpleGit.log).toHaveBeenCalledWith({
        from: commitHash,
        to: commitHash,
        maxCount: 1
      });

      expect(result).toEqual({
        hash: commitHash,
        message: 'Test commit message',
        author: 'Test Author',
        date: '2023-01-01',
        files: ['src/file1.ts', 'src/file2.ts'],
        diff: 'full commit diff'
      });
    });

    it('should return null for non-existent commit', async () => {
      const mockLog = createMockLogResult([]);
      mockSimpleGit.log.mockResolvedValue(mockLog);

      const result = await analyzer.getCommitInfo(commitHash);

      expect(result).toBeNull();
    });

    it('should return null when commit is undefined', async () => {
      const mockLog = { all: [undefined], total: 1, latest: null };
      mockSimpleGit.log.mockResolvedValue(mockLog as any);

      const result = await analyzer.getCommitInfo(commitHash);

      expect(result).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      mockSimpleGit.log.mockRejectedValue(new Error('Log error'));

      const result = await analyzer.getCommitInfo(commitHash);

      expect(result).toBeNull();
    });
  });

  describe('getLatestCommitHash', () => {
    it('should get latest commit hash', async () => {
      mockSimpleGit.revparse.mockResolvedValue('latest123');

      const result = await analyzer.getLatestCommitHash();

      expect(mockSimpleGit.revparse).toHaveBeenCalledWith(['HEAD']);
      expect(result).toBe('latest123');
    });

    it('should handle errors gracefully', async () => {
      mockSimpleGit.revparse.mockRejectedValue(new Error('Revparse error'));

      const result = await analyzer.getLatestCommitHash();

      expect(result).toBe('unknown');
    });
  });

  describe('getRepoName', () => {
    it('should return repository name from path', () => {
      const result = analyzer.getRepoName();
      expect(result).toBe('repo');
    });
  });

  describe('shouldIgnoreFile', () => {
    it('should ignore files in ignored folders', () => {
      const testCases = [
        { path: 'node_modules/package.json', shouldIgnore: true },
        { path: 'dist/build.js', shouldIgnore: true },
        { path: '.git/config', shouldIgnore: true },
        { path: 'src/file.ts', shouldIgnore: false },
        { path: 'README.md', shouldIgnore: false }
      ];

      testCases.forEach(({ path, shouldIgnore }) => {
        const result = (analyzer as any).shouldIgnoreFile(path);
        expect(result).toBe(shouldIgnore);
      });
    });

    it('should ignore exact folder matches', () => {
      const result = (analyzer as any).shouldIgnoreFile('node_modules');
      expect(result).toBe(true);
    });
  });

  describe('getRecentCommits', () => {
    it('should get recent commits with details', async () => {
      const mockCommits = [
        createMockCommit('commit1', 'First commit'),
        createMockCommit('commit2', 'Second commit')
      ];
      const mockLog = createMockLogResult(mockCommits);

      mockSimpleGit.log.mockResolvedValue(mockLog);
      mockSimpleGit.diffSummary
        .mockResolvedValueOnce(createMockDiffSummary([{ file: 'file1.ts' }]))
        .mockResolvedValueOnce(createMockDiffSummary([{ file: 'file2.ts' }]));
      mockSimpleGit.show
        .mockResolvedValueOnce('diff1')
        .mockResolvedValueOnce('diff2');

      const result = await analyzer.getRecentCommits(2);

      expect(mockSimpleGit.log).toHaveBeenCalledWith({ maxCount: 2 });
      expect(result).toHaveLength(2);
      expect(result[0]?.hash).toBe('commit1');
      expect(result[1]?.hash).toBe('commit2');
    });

    it('should use default count when not provided', async () => {
      const mockLog = createMockLogResult([]);
      mockSimpleGit.log.mockResolvedValue(mockLog);

      await analyzer.getRecentCommits();

      expect(mockSimpleGit.log).toHaveBeenCalledWith({ maxCount: 5 });
    });

    it('should handle errors gracefully', async () => {
      mockSimpleGit.log.mockRejectedValue(new Error('Log error'));

      const result = await analyzer.getRecentCommits();

      expect(result).toEqual([]);
    });
  });

  describe('validateGitRepo', () => {
    it('should return true for valid git repository', async () => {
      mockSimpleGit.revparse.mockResolvedValue('.git');

      const result = await analyzer.validateGitRepo();

      expect(mockSimpleGit.revparse).toHaveBeenCalledWith(['--git-dir']);
      expect(result).toBe(true);
    });

    it('should return false for invalid git repository', async () => {
      mockSimpleGit.revparse.mockRejectedValue(new Error('Not a git repository'));

      const result = await analyzer.validateGitRepo();

      expect(result).toBe(false);
    });
  });

  describe('getChangesBetween', () => {
    const fromRef = 'main';
    const toRef = 'feature/branch';

    it('should get changes between two references', async () => {
      const mockDiffSummary = createMockDiffSummary([
        { file: 'src/file.ts', insertions: 5, deletions: 2 }
      ]);

      mockSimpleGit.diffSummary.mockResolvedValue(mockDiffSummary);
      mockSimpleGit.diff.mockResolvedValue('diff content');

      const result = await analyzer.getChangesBetween(fromRef, toRef);

      expect(mockSimpleGit.diffSummary).toHaveBeenCalledWith([fromRef, toRef]);
      expect(mockSimpleGit.diff).toHaveBeenCalledWith([fromRef, toRef, '--', 'src/file.ts']);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        status: 'M',
        file: 'src/file.ts',
        diff: 'diff content'
      });
    });

    it('should handle errors gracefully', async () => {
      mockSimpleGit.diffSummary.mockRejectedValue(new Error('Diff error'));

      const result = await analyzer.getChangesBetween(fromRef, toRef);

      expect(result).toEqual([]);
    });
  });
});