import { SimpleGit, simpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs-extra';
import { execSync } from 'child_process';
import { log } from '../util/logging';
import { ContextExtractor } from '../repo-handlers/analyzers/ContextExtractor';
import { CodebaseContext } from '../repo-handlers/types/codebaseContext';

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
  private contextExtractor: ContextExtractor;

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
    
    // Initialize context extractor for enhanced analysis
    this.contextExtractor = new ContextExtractor({
      maxFileSize: 100000,
      maxParentFiles: 3,
      maxRoutingFiles: 3,
      maxConfigFiles: 2,
      timeoutMs: 10000
    });
  }

  /**
   * Enhanced file filtering - excludes non-code project files
   * Only includes files that actually affect the UI/application behavior
   */
  private isUIRelevantFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    const extension = path.extname(filePath).toLowerCase();
    const fullPathLower = filePath.toLowerCase();
    
    // Exclude lock files
    if (fileName.includes('lock') || fileName.endsWith('.lock')) {
      return false;
    }
    
    // Exclude git-related files
    if (fileName.startsWith('.git')) {
      return false;
    }
    
    // Exclude linting and formatting configuration files
    const lintingConfigFiles = [
      '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
      '.prettierrc', '.prettierrc.js', '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml',
      '.stylelintrc', '.stylelintrc.js', '.stylelintrc.json', '.stylelintrc.yml',
      '.jshintrc', '.jscsrc', 'tslint.json', '.editorconfig'
    ];
    
    if (lintingConfigFiles.includes(fileName)) {
      return false;
    }
    
    // Exclude testing configuration files (not the actual tests)
    const testConfigFiles = [
      'jest.config.js', 'jest.config.json', 'jest.config.ts',
      'cypress.config.js', 'cypress.config.ts', 'cypress.json',
      'playwright.config.js', 'playwright.config.ts',
      'karma.conf.js', 'protractor.conf.js', 'webdriver.conf.js'
    ];
    
    if (testConfigFiles.includes(fileName)) {
      return false;
    }
    
    // Check if it's a configuration file that DOES affect the application first
    const relevantConfigFiles = [
      'package.json', // Contains dependencies and scripts
      'tsconfig.json', 'jsconfig.json', // TypeScript/JavaScript config affects compilation
      'next.config.js', 'nuxt.config.js', 'nuxt.config.ts', // Framework configs
      'svelte.config.js', 'vite.config.js', 'vite.config.ts' // Framework configs
    ];
    
    if (relevantConfigFiles.includes(fileName)) {
      return true; // Return early for relevant configs
    }
    
    // Exclude build tool configuration files (after checking for relevant ones)
    const buildConfigFiles = [
      'webpack.config.js', 'webpack.config.ts', 'webpack.dev.js', 'webpack.prod.js',
      'rollup.config.js', 'rollup.config.ts',
      'gulpfile.js', 'gruntfile.js',
      'babel.config.js', 'babel.config.json', '.babelrc', '.babelrc.js', '.babelrc.json',
      'postcss.config.js', 'tailwind.config.js', 'tailwind.config.ts'
    ];
    
    if (buildConfigFiles.includes(fileName)) {
      return false;
    }
    
    // Exclude package manager and environment files
    const packageConfigFiles = [
      '.npmrc', '.yarnrc', '.yarnrc.yml', 'yarn.lock', 'package-lock.json', 'pnpm-lock.yaml',
      '.nvmrc', '.node-version', '.ruby-version', '.python-version',
      '.env.example', '.env.local', '.env.development', '.env.production', '.env.test'
    ];
    
    if (packageConfigFiles.includes(fileName)) {
      return false;
    }
    
    // Exclude documentation and meta files
    const docFiles = [
      'readme.md', 'license', 'license.md', 'license.txt',
      'changelog.md', 'changelog.txt', 'history.md',
      'contributing.md', 'code_of_conduct.md', 'security.md',
      'authors.md', 'contributors.md', 'maintainers.md'
    ];
    
    if (docFiles.includes(fileName)) {
      return false;
    }
    
    // Exclude Docker and deployment files
    const deploymentFiles = [
      'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
      '.dockerignore', 'docker-compose.dev.yml', 'docker-compose.prod.yml',
      'vercel.json', 'netlify.toml', 'now.json'
    ];
    
    if (deploymentFiles.includes(fileName)) {
      return false;
    }
    
    // Exclude CI/CD configuration files
    const ciConfigPatterns = [
      '.travis.yml', '.circleci', '.github/workflows', '.github/actions',
      'appveyor.yml', 'azure-pipelines', 'jenkins', 'codeship', 'wercker.yml',
      '.gitlab-ci.yml', 'bitbucket-pipelines.yml'
    ];
    
    if (ciConfigPatterns.some(pattern => fullPathLower.includes(pattern))) {
      return false;
    }
    
    // Exclude IDE and editor configuration files
    const ideConfigPatterns = [
      '.vscode', '.idea', '.sublime', '*.sublime-project', '*.sublime-workspace',
      '.vs', '.vscode-test'
    ];
    
    if (ideConfigPatterns.some(pattern => fullPathLower.includes(pattern))) {
      return false;
    }
    
    // Exclude binary and non-text files that aren't UI assets
    const excludedBinaryExtensions = [
      '.exe', '.dll', '.so', '.dylib', '.a', '.lib', '.jar', '.war', 
      '.zip', '.tar', '.gz', '.rar', '.7z'
    ];
    
    if (excludedBinaryExtensions.includes(extension)) {
      return false;
    }
    
    // Include only actual code and UI-relevant files
    const codeExtensions = [
      '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
      '.html', '.htm', '.css', '.scss', '.sass', '.less', '.styl',
      '.json', '.xml', '.yaml', '.yml', '.toml',
      '.py', '.rb', '.java', '.cs', '.php', '.go', '.rs', '.cpp', '.c', '.h',
      '.sql', '.graphql', '.gql',
      '.md' // Only include .md files that aren't docs (like component docs)
    ];
    
    const uiAssetExtensions = [
      '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
      '.woff', '.woff2', '.ttf', '.eot',
      '.mp4', '.webm', '.ogg', '.mp3', '.wav'
    ];
    
    // Check if it's a code file or UI asset
    if (codeExtensions.includes(extension) || uiAssetExtensions.includes(extension)) {
      // Exclude markdown files that are clearly documentation
      if (extension === '.md') {
        const docMarkdownPatterns = [
          'readme', 'license', 'changelog', 'contributing', 'code_of_conduct',
          'security', 'authors', 'contributors', 'maintainers', 'history'
        ];
        const baseNameWithoutExt = path.basename(filePath, extension).toLowerCase();
        
        if (docMarkdownPatterns.some(pattern => baseNameWithoutExt.includes(pattern))) {
          return false;
        }
      }
      
      return true;
    }
    
    
    // If we get here, it's likely a project file we don't need for UI testing
    return false;
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
      log.git.debug('Failed to get branch info, using defaults', { error: String(error) });
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
          log.git.debug(`Failed to get diff for ${file}`, { error: String(error) });
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
          log.git.debug(`Failed to get staged diff for ${file}`, { error: String(error) });
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
          log.git.debug(`Failed to read new file ${file}`, { error: String(error) });
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
      log.error('Failed to get working changes', { error: String(error) });
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
          log.git.debug(`Failed to get diff for ${file.file}`, { error: String(error) });
          changes.push({
            status,
            file: file.file
          });
        }
      }

    } catch (error) {
      log.error(`Failed to get commit changes for ${commitHash}`, { error: String(error) });
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
   * Get list of commits from a range specification
   */
  async getCommitsFromRange(range: string): Promise<string[]> {
    try {
      const log = await this.git.log(['--max-count=50', range]);
      return log.all.map(commit => commit.hash);
    } catch (error) {
      log.error(`Failed to get commits from range ${range}`, { error: String(error) });
      return [];
    }
  }

  /**
   * Get commits since a specific date
   */
  async getCommitsSince(since: string): Promise<string[]> {
    try {
      const log = await this.git.log({
        since,
        maxCount: 50 // Reasonable limit
      });
      
      return log.all.map(commit => commit.hash);
    } catch (error) {
      log.error(`Failed to get commits since ${since}`, { error: String(error) });
      return [];
    }
  }

  /**
   * Get last N commits
   */
  async getLastCommits(count: number): Promise<string[]> {
    try {
      const log = await this.git.log({
        maxCount: Math.min(count, 50) // Cap at 50 to prevent abuse
      });
      
      return log.all.map(commit => commit.hash);
    } catch (error) {
      log.error(`Failed to get last ${count} commits`, { error: String(error) });
      return [];
    }
  }

  /**
   * Combine changes from multiple commits
   */
  async getCombinedCommitChanges(commitHashes: string[]): Promise<WorkingChanges> {
    if (commitHashes.length === 0) {
      return {
        changes: [],
        branchInfo: await this.getCurrentBranchInfo()
      };
    }

    if (commitHashes.length === 1 && commitHashes[0]) {
      return this.getCommitChanges(commitHashes[0]);
    }

    const branchInfo = await this.getCurrentBranchInfo();
    const combinedChanges = new Map<string, WorkingChange>();

    // Process commits from oldest to newest to get final state
    const sortedCommits = [...commitHashes].reverse();

    for (const commitHash of sortedCommits) {
      const commitChanges = await this.getCommitChanges(commitHash);
      
      // Combine changes, with later commits taking precedence
      for (const change of commitChanges.changes) {
        const existingChange = combinedChanges.get(change.file);
        
        if (!existingChange) {
          combinedChanges.set(change.file, { ...change });
        } else {
          // Merge the changes - combine diffs if both exist
          const combinedDiff = existingChange.diff && change.diff 
            ? `${existingChange.diff}\n\n--- Later changes ---\n${change.diff}`
            : change.diff || existingChange.diff;
            
          combinedChanges.set(change.file, {
            status: change.status, // Use latest status
            file: change.file,
            ...(combinedDiff && { diff: combinedDiff })
          });
        }
      }
    }

    return {
      changes: Array.from(combinedChanges.values()),
      branchInfo: {
        ...branchInfo,
        commitHash: commitHashes[0] || branchInfo.commitHash // Use most recent commit hash or fallback
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
      log.error(`Failed to get commit info for ${commitHash}`, { error: String(error) });
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
      log.error('Failed to get latest commit hash', { error: String(error) });
      return 'unknown';
    }
  }

  /**
   * Get repository name in GitHub format (owner/repo)
   * Falls back to directory name if remote is not available
   */
  getRepoName(): string {
    try {
      // Try to get the repo name from git remotes
      const remoteUrl = this.getRemoteUrl();
      if (remoteUrl) {
        const repoName = this.extractRepoNameFromUrl(remoteUrl);
        if (repoName) {
          return repoName;
        }
      }
    } catch (error) {
      log.git.debug('Failed to get repo name from git remote', { error: String(error) });
    }
    
    // Fallback to directory name
    return path.basename(this.repoPath);
  }

  /**
   * Get the remote URL for origin
   */
  private getRemoteUrl(): string | null {
    try {
      // Use git config to get remote origin URL
      const result = execSync(
        'git config --get remote.origin.url',
        { cwd: this.repoPath, encoding: 'utf8' }
      );
      return result.toString().trim();
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract owner/repo from various git URL formats
   */
  private extractRepoNameFromUrl(url: string): string | null {
    try {
      // Remove .git suffix if present
      const cleanUrl = url.replace(/\.git$/, '');
      
      // Handle GitHub HTTPS URLs: https://github.com/owner/repo
      const httpsMatch = cleanUrl.match(/https:\/\/github\.com\/([^/]+\/[^/]+)/);
      if (httpsMatch && httpsMatch[1]) {
        return httpsMatch[1];
      }
      
      // Handle GitHub SSH URLs: git@github.com:owner/repo
      const sshMatch = cleanUrl.match(/git@github\.com:([^/]+\/[^/]+)/);
      if (sshMatch && sshMatch[1]) {
        return sshMatch[1];
      }
      
      // Handle other SSH formats: ssh://git@github.com/owner/repo
      const sshAltMatch = cleanUrl.match(/ssh:\/\/git@github\.com\/([^/]+\/[^/]+)/);
      if (sshAltMatch && sshAltMatch[1]) {
        return sshAltMatch[1];
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if we should ignore a file based on ignored folders and UI relevance
   */
  private shouldIgnoreFile(filePath: string): boolean {
    // Check ignored folders
    const isInIgnoredFolder = this.ignoredFolders.some(folder => 
      filePath.startsWith(folder + '/') || filePath === folder
    );
    
    if (isInIgnoredFolder) {
      return true;
    }
    
    // Check if file is UI relevant (excludes .lock, .gitignore, etc.)
    return !this.isUIRelevantFile(filePath);
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
      log.error('Failed to get recent commits', { error: String(error) });
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
   * Get enhanced codebase context for better test generation
   * Integrates the proven repo-handlers workflow
   */
  async getEnhancedContext(workingChanges: WorkingChanges): Promise<CodebaseContext | null> {
    try {
      const repoName = this.getRepoName();
      
      // Use the context extractor to get comprehensive analysis
      const context = await this.contextExtractor.extractCodebaseContext(
        this.repoPath,
        repoName,
        workingChanges,
        workingChanges.branchInfo
      );
      
      return context;
    } catch (error) {
      log.error('Failed to extract enhanced context', { error: String(error) });
      return null;
    }
  }

  /**
   * Get minimal context for performance-critical scenarios
   */
  async getMinimalContext(workingChanges: WorkingChanges): Promise<CodebaseContext | null> {
    try {
      const repoName = this.getRepoName();
      
      // Use the minimal context extraction for faster results
      const context = await this.contextExtractor.extractMinimalContext(
        this.repoPath,
        repoName,
        workingChanges,
        workingChanges.branchInfo
      );
      
      return context;
    } catch (error) {
      log.error('Failed to extract minimal context', { error: String(error) });
      return null;
    }
  }

  /**
   * Get context extraction statistics
   */
  getContextStats(context: CodebaseContext | null) {
    return this.contextExtractor.getExtractionStats(context);
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
          log.git.debug(`Failed to get diff for ${file.file}`, { error: String(error) });
          changes.push({
            status,
            file: file.file
          });
        }
      }

    } catch (error) {
      log.error(`Failed to get changes between ${from} and ${to}`, { error: String(error) });
    }

    return changes;
  }

  /**
   * Enhanced context analysis inspired by CodebaseAnalyzer patterns
   * Analyzes changes to provide better insights for test generation
   */
  async analyzeChangesWithContext(changes: WorkingChange[]): Promise<{
    totalFiles: number;
    fileTypes: Record<string, number>;
    componentChanges: string[];
    routingChanges: string[];
    configChanges: string[];
    testChanges: string[];
    affectedLanguages: string[];
    changeComplexity: 'low' | 'medium' | 'high';
    suggestedFocusAreas: string[];
  }> {
    const analysis = {
      totalFiles: changes.length,
      fileTypes: {} as Record<string, number>,
      componentChanges: [] as string[],
      routingChanges: [] as string[],
      configChanges: [] as string[],
      testChanges: [] as string[],
      affectedLanguages: [] as string[],
      changeComplexity: 'low' as 'low' | 'medium' | 'high',
      suggestedFocusAreas: [] as string[]
    };

    const languageExtensions = new Set<string>();

    // Analyze each changed file
    for (const change of changes) {
      const filePath = change.file.toLowerCase();
      const extension = path.extname(change.file).toLowerCase();
      
      // Track file types
      analysis.fileTypes[extension] = (analysis.fileTypes[extension] || 0) + 1;
      
      // Track languages
      if (extension) {
        languageExtensions.add(extension);
      }

      // Categorize files by purpose (similar to CodebaseAnalyzer patterns)
      if (this.isComponentFile(filePath)) {
        analysis.componentChanges.push(change.file);
      }
      
      if (this.isRoutingFile(filePath)) {
        analysis.routingChanges.push(change.file);
      }
      
      if (this.isConfigFile(filePath)) {
        analysis.configChanges.push(change.file);
      }
      
      if (this.isTestFile(filePath)) {
        analysis.testChanges.push(change.file);
      }
    }

    // Convert extensions to language names
    analysis.affectedLanguages = Array.from(languageExtensions).map(ext => 
      this.getLanguageFromExtension(ext)
    ).filter(Boolean);

    // Determine complexity based on number and types of changes
    if (changes.length > 10 || analysis.configChanges.length > 0) {
      analysis.changeComplexity = 'high';
    } else if (changes.length > 5 || analysis.componentChanges.length > 3) {
      analysis.changeComplexity = 'medium';
    }

    // Suggest focus areas based on changes
    if (analysis.componentChanges.length > 0) {
      analysis.suggestedFocusAreas.push('Component rendering and interaction');
    }
    if (analysis.routingChanges.length > 0) {
      analysis.suggestedFocusAreas.push('Navigation and routing behavior');
    }
    if (analysis.configChanges.length > 0) {
      analysis.suggestedFocusAreas.push('Configuration and build processes');
    }
    if (analysis.testChanges.length > 0) {
      analysis.suggestedFocusAreas.push('Test coverage and validation');
    }

    return analysis;
  }

  /**
   * Check if file is a component (similar to CodebaseAnalyzer patterns)
   */
  private isComponentFile(filePath: string): boolean {
    const componentPatterns = [
      'component', 'components', 'ui', 'views', 'pages', 'widgets'
    ];
    return componentPatterns.some(pattern => filePath.includes(pattern)) ||
           filePath.endsWith('.tsx') || filePath.endsWith('.jsx') || filePath.endsWith('.vue');
  }

  /**
   * Check if file is related to routing
   */
  private isRoutingFile(filePath: string): boolean {
    const routingPatterns = [
      'router', 'routes', 'routing', 'navigation', 'menu', 'layout', '_app'
    ];
    return routingPatterns.some(pattern => filePath.includes(pattern));
  }

  /**
   * Check if file is a configuration file
   */
  private isConfigFile(filePath: string): boolean {
    const configPatterns = [
      'package.json', 'tsconfig', 'webpack', 'vite', 'next.config', 
      'tailwind', '.env', 'babel', 'eslint', 'prettier'
    ];
    return configPatterns.some(pattern => filePath.includes(pattern));
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(filePath: string): boolean {
    const testPatterns = [
      'test', 'tests', 'spec', '__tests__', 'cypress', 'playwright', '.test.', '.spec.'
    ];
    return testPatterns.some(pattern => filePath.includes(pattern));
  }

  /**
   * Get language name from file extension
   */
  private getLanguageFromExtension(extension: string): string {
    const languageMap: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript React', 
      '.js': 'JavaScript',
      '.jsx': 'JavaScript React',
      '.vue': 'Vue',
      '.py': 'Python',
      '.rb': 'Ruby',
      '.java': 'Java',
      '.cs': 'C#',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.html': 'HTML',
      '.json': 'JSON',
      '.md': 'Markdown'
    };
    return languageMap[extension] || extension.replace('.', '').toUpperCase();
  }
}