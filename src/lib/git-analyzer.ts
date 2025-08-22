import { SimpleGit, simpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs-extra';

export interface WorkingChange {
  status: string;
  file: string;
  diff?: string;
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
  diff: string;
}

export interface BranchInfo {
  branch: string;
  commitHash: string;
}

export interface WorkingChanges {
  changes: WorkingChange[];
  branchInfo: BranchInfo;
}

export interface GitAnalyzerOptions {
  repoPath: string;
  ignoredFolders?: string[];
}

/**
 * Git analyzer for CI/CD environments like GitHub Actions
 * Simplified version of the commitTester.ts logic
 */
export class GitAnalyzer {
  private git: SimpleGit;
  private repoPath: string;
  private ignoredFolders: string[];

  constructor(options: GitAnalyzerOptions) {
    this.repoPath = options.repoPath;
    this.ignoredFolders = options.ignoredFolders || [
      'node_modules', 
      'dist', 
      'build', 
      'out',
      '.git',
      '.github',
      'coverage',
      'tests/debugg-ai'
    ];
    
    this.git = simpleGit(this.repoPath);
  }

  /**
   * Get current branch information
   */
  async getCurrentBranchInfo(): Promise<BranchInfo> {
    try {
      // In GitHub Actions, we might be in a detached HEAD state
      // Try to get branch from environment variables first
      let branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
      
      if (!branch) {
        const currentBranch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
        branch = currentBranch === 'HEAD' ? 'main' : currentBranch; // fallback for detached HEAD
      }
      
      // Clean branch name (remove refs/heads/ if present)
      branch = branch.replace('refs/heads/', '');

      const commitHash = await this.git.revparse(['HEAD']);

      return {
        branch: branch.trim(),
        commitHash: commitHash.trim()
      };
    } catch (error) {
      console.warn('Failed to get branch info, using defaults:', error);
      return {
        branch: 'main',
        commitHash: 'unknown'
      };
    }
  }

  /**
   * Get working changes (uncommitted changes)
   */
  async getWorkingChanges(): Promise<WorkingChanges> {
    const branchInfo = await this.getCurrentBranchInfo();
    const changes: WorkingChange[] = [];

    try {
      // Get status of all files
      const status = await this.git.status();
      
      // Process modified files
      for (const file of status.modified) {
        if (this.shouldIgnoreFile(file)) continue;
        
        try {
          const diff = await this.git.diff(['HEAD', '--', file]);
          changes.push({
            status: 'M',
            file,
            diff
          });
        } catch (error) {
          console.warn(`Failed to get diff for ${file}:`, error);
          changes.push({
            status: 'M',
            file
          });
        }
      }

      // Process added files (staged)
      for (const file of status.staged) {
        if (this.shouldIgnoreFile(file)) continue;
        
        try {
          const diff = await this.git.diff(['--cached', '--', file]);
          changes.push({
            status: 'A',
            file,
            diff
          });
        } catch (error) {
          console.warn(`Failed to get staged diff for ${file}:`, error);
          changes.push({
            status: 'A',
            file
          });
        }
      }

      // Process new files (untracked)
      for (const file of status.not_added) {
        if (this.shouldIgnoreFile(file)) continue;
        
        try {
          const filePath = path.join(this.repoPath, file);
          const content = await fs.readFile(filePath, 'utf8');
          changes.push({
            status: '??',
            file,
            diff: content
          });
        } catch (error) {
          console.warn(`Failed to read new file ${file}:`, error);
          changes.push({
            status: '??',
            file
          });
        }
      }

      // Process deleted files
      for (const file of status.deleted) {
        if (this.shouldIgnoreFile(file)) continue;
        
        changes.push({
          status: 'D',
          file,
          diff: `--- File deleted ---`
        });
      }

    } catch (error) {
      console.error('Failed to get working changes:', error);
    }

    return {
      changes,
      branchInfo
    };
  }

  /**
   * Get changes for a specific commit
   */
  async getCommitChanges(commitHash: string): Promise<WorkingChanges> {
    const branchInfo = await this.getCurrentBranchInfo();
    const changes: WorkingChange[] = [];

    try {
      // Get list of changed files with their status
      const diffSummary = await this.git.diffSummary([`${commitHash}^`, commitHash]);
      
      for (const file of diffSummary.files) {
        if (this.shouldIgnoreFile(file.file)) continue;

        let status: string;
        if ('insertions' in file && 'deletions' in file) {
          if (file.insertions > 0 && file.deletions === 0) {
            status = 'A'; // Added
          } else if (file.insertions === 0 && file.deletions > 0) {
            status = 'D'; // Deleted
          } else {
            status = 'M'; // Modified
          }
        } else {
          status = 'M'; // Default to modified for binary files
        }

        try {
          // Get the actual diff for the file
          const diff = await this.git.show([commitHash, '--', file.file]);
          changes.push({
            status,
            file: file.file,
            diff
          });
        } catch (error) {
          console.warn(`Failed to get diff for ${file.file}:`, error);
          changes.push({
            status,
            file: file.file
          });
        }
      }

    } catch (error) {
      console.error(`Failed to get commit changes for ${commitHash}:`, error);
    }

    return {
      changes,
      branchInfo: {
        ...branchInfo,
        commitHash
      }
    };
  }

  /**
   * Get detailed information about a commit
   */
  async getCommitInfo(commitHash: string): Promise<CommitInfo | null> {
    try {
      // Get commit details
      const log = await this.git.log({
        from: commitHash,
        to: commitHash,
        maxCount: 1
      });

      if (log.all.length === 0) {
        return null;
      }

      const commit = log.all[0];
      if (!commit) {
        return null;
      }
      
      // Get changed files
      const diffSummary = await this.git.diffSummary([`${commitHash}^`, commitHash]);
      const files = diffSummary.files.map(f => f.file);
      
      // Get full diff
      const diff = await this.git.show([commitHash]);

      return {
        hash: commit.hash,
        message: commit.message,
        author: commit.author_name,
        date: commit.date,
        files,
        diff
      };

    } catch (error) {
      console.error(`Failed to get commit info for ${commitHash}:`, error);
      return null;
    }
  }

  /**
   * Get the latest commit hash
   */
  async getLatestCommitHash(): Promise<string> {
    try {
      return await this.git.revparse(['HEAD']);
    } catch (error) {
      console.error('Failed to get latest commit hash:', error);
      return 'unknown';
    }
  }

  /**
   * Get repository name from the directory
   */
  getRepoName(): string {
    return path.basename(this.repoPath);
  }

  /**
   * Check if we should ignore a file based on ignored folders
   */
  private shouldIgnoreFile(filePath: string): boolean {
    return this.ignoredFolders.some(folder => 
      filePath.startsWith(folder + '/') || filePath === folder
    );
  }

  /**
   * Get recent commits (useful for understanding recent changes)
   */
  async getRecentCommits(count: number = 5): Promise<CommitInfo[]> {
    try {
      const log = await this.git.log({ maxCount: count });
      const commits: CommitInfo[] = [];

      for (const commit of log.all) {
        const diffSummary = await this.git.diffSummary([`${commit.hash}^`, commit.hash]);
        const files = diffSummary.files.map(f => f.file);
        const diff = await this.git.show([commit.hash]);

        commits.push({
          hash: commit.hash,
          message: commit.message,
          author: commit.author_name,
          date: commit.date,
          files,
          diff
        });
      }

      return commits;
    } catch (error) {
      console.error('Failed to get recent commits:', error);
      return [];
    }
  }

  /**
   * Validate that we're in a git repository
   */
  async validateGitRepo(): Promise<boolean> {
    try {
      await this.git.revparse(['--git-dir']);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get changes between two commits or branches
   */
  async getChangesBetween(from: string, to: string): Promise<WorkingChange[]> {
    const changes: WorkingChange[] = [];

    try {
      const diffSummary = await this.git.diffSummary([from, to]);
      
      for (const file of diffSummary.files) {
        if (this.shouldIgnoreFile(file.file)) continue;

        let status: string;
        if ('insertions' in file && 'deletions' in file) {
          if (file.insertions > 0 && file.deletions === 0) {
            status = 'A';
          } else if (file.insertions === 0 && file.deletions > 0) {
            status = 'D';
          } else {
            status = 'M';
          }
        } else {
          status = 'M'; // Default to modified for binary files
        }

        try {
          const diff = await this.git.diff([from, to, '--', file.file]);
          changes.push({
            status,
            file: file.file,
            diff
          });
        } catch (error) {
          console.warn(`Failed to get diff for ${file.file}:`, error);
          changes.push({
            status,
            file: file.file
          });
        }
      }

    } catch (error) {
      console.error(`Failed to get changes between ${from} and ${to}:`, error);
    }

    return changes;
  }
}