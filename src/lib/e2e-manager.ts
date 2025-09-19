import { randomUUID } from 'crypto';
import { CLIBackendClient } from '../backend/cli/client';
import { GitAnalyzer, WorkingChanges } from './git-analyzer';
import { tunnelManager, TunnelInfo as TunnelManagerInfo } from '../services/ngrok/tunnelManager';
import * as fs from 'fs-extra';
import * as path from 'path';
import { systemLogger } from '../util/system-logger';
import { telemetry } from '../services/telemetry';

export interface E2EManagerOptions {
  apiKey: string;
  repoPath: string;
  baseUrl?: string;
  testOutputDir?: string;
  waitForServer?: boolean;
  serverPort?: number; // Server port to test and tunnel
  serverTimeout?: number;
  maxTestWaitTime?: number;
  ngrokAuthToken?: string; // Ngrok auth token (will use NGROK_AUTH_TOKEN env if not provided)
  downloadArtifacts?: boolean; // Whether to download test artifacts (scripts, recordings, etc.) - defaults to false
  // Commit analysis options
  commit?: string; // Specific commit hash
  commitRange?: string; // Commit range (e.g., HEAD~3..HEAD)
  since?: string; // Commits since date/time
  last?: number; // Last N commits
  // PR testing options
  pr?: number; // PR number for GitHub App-based testing (sends single request, backend handles analysis)
  prSequence?: boolean; // Enable PR commit sequence testing (sends individual test requests per commit)
  baseBranch?: string | undefined; // Base branch for PR testing (auto-detected from GitHub env if not provided)
  headBranch?: string | undefined; // Head branch for PR testing (auto-detected from GitHub env if not provided)
}

export interface E2EResult {
  success: boolean;
  suiteUuid?: string | undefined;
  suite?: any; // Using any for now since we're working with backend types
  error?: string;
  testFiles?: string[];
  // PR sequence testing results
  prSequenceResults?: PRSequenceResult[];
  totalCommitsTested?: number;
}

export interface PRSequenceResult {
  commitHash: string;
  commitMessage: string;
  commitOrder: number;
  suiteUuid: string;
  success: boolean;
  error?: string;
  testFiles?: string[];
}

/**
 * Manages the complete E2E test execution lifecycle from commit analysis to result reporting
 * ALWAYS handles tunnel creation internally - this is our core responsibility
 */
export class E2EManager {
  private client: CLIBackendClient;
  private gitAnalyzer: GitAnalyzer;
  private activeTunnelId: string | null = null;
  private activeTunnel: TunnelManagerInfo | null = null;
  private urlUuidSubdomain: string | null = null;  // Stores the UUID for the tunnel subdomain
  private options: E2EManagerOptions;

  constructor(options: E2EManagerOptions) {
    this.options = {
      testOutputDir: 'tests/debugg-ai',
      serverTimeout: 30000, // 30 seconds
      maxTestWaitTime: 600000, // 10 minutes
      downloadArtifacts: false, // Default to NOT downloading artifacts for CI/CD environments
      ...options
    };

    this.client = new CLIBackendClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl || 'https://api.debugg.ai',
      repoPath: options.repoPath,
      timeout: this.options.serverTimeout || 30000
    });

    this.gitAnalyzer = new GitAnalyzer({
      repoPath: options.repoPath
    });
  }

  /**
   * Create tunnel internally for test suite
   * This is our core responsibility - we ALWAYS handle tunnels internally!
   */
  private async createInternalTunnel(suiteUuid: string, tunnelKey: string | null): Promise<void> {
    if (!this.options.serverPort) {
      throw new Error('Server port is required for test execution. Tests cannot run without a tunnel!');
    }

    systemLogger.info(`Creating ngrok tunnel on port ${this.options.serverPort}`, { category: 'tunnel' });

    // Check if we have a tunnel key from the backend
    if (!tunnelKey) {
      systemLogger.error('No tunnel key provided by backend', { category: 'tunnel' });
      systemLogger.error('The backend did not return a tunnel authentication token', { category: 'tunnel' });
      systemLogger.error('This might indicate:', { category: 'tunnel' });
      systemLogger.error('  1. The backend API version is outdated', { category: 'tunnel' });
      systemLogger.error('  2. Your account does not have tunnel permissions', { category: 'tunnel' });
      systemLogger.error('  3. The test suite was created without tunnel support', { category: 'tunnel' });
      throw new Error('No tunnel key provided by backend. Cannot create tunnel without authentication token.');
    }

    // Use the UUID subdomain that we sent to the backend
    // This ensures the tunnel URL matches what the backend expects
    const tunnelId = this.urlUuidSubdomain || `${suiteUuid.substring(0, 8)}`;

    systemLogger.info(`Creating tunnel with subdomain: ${tunnelId}`, { category: 'tunnel' });
    systemLogger.info(`Tunnel will forward to local port: ${this.options.serverPort}`, { category: 'tunnel' });

    // Create the localhost URL that we want to tunnel
    const localhostUrl = `http://localhost:${this.options.serverPort}`;

    // Use tunnelManager to process the URL and create tunnel
    const tunnelResult = await tunnelManager.processUrl(localhostUrl, tunnelKey, tunnelId);

    if (!tunnelResult.isLocalhost || !tunnelResult.tunnelId) {
      throw new Error('Failed to create tunnel: processUrl did not return a tunnel');
    }

    // Store tunnel information
    this.activeTunnelId = tunnelResult.tunnelId;
    this.activeTunnel = tunnelManager.getTunnelInfo(tunnelResult.tunnelId) || null;

    systemLogger.info(`Tunnel successfully created: ${tunnelResult.url}`, { category: 'tunnel' });
    systemLogger.info(`Expected URL format: https://${tunnelId}.ngrok.debugg.ai`, { category: 'tunnel' });

  }

  /**
   * Cleanup resources (tunnel, etc.)
   */
  async cleanup(): Promise<void> {
    if (this.activeTunnelId) {
      try {
        await tunnelManager.stopTunnel(this.activeTunnelId);
        systemLogger.debug('Tunnel cleaned up', { category: 'tunnel' });
      } catch (error) {
        systemLogger.warn(`Failed to cleanup tunnel: ${error}`, { category: 'tunnel' });
      }
      this.activeTunnelId = null;
      this.activeTunnel = null;
    }
  }

  /**
   * Run E2E tests for the current commit or working changes
   */
  async runCommitTests(): Promise<E2EResult> {
    const testStartTime = Date.now();
    systemLogger.info('Starting test analysis and generation', { category: 'test' });

    try {
      // Step 1: Validate git repository
      const isValidRepo = await this.gitAnalyzer.validateGitRepo();
      if (!isValidRepo) {
        throw new Error('Not a valid git repository');
      }

      // Step 2: Initialize the CLI client (includes connection test)
      systemLogger.info('Initializing backend client', { category: 'test' });
      await this.client.initialize();

      // Step 3: Test authentication
      systemLogger.info('Validating API key', { category: 'api' });
      const authTest = await this.client.testAuthentication();
      if (!authTest.success) {
        throw new Error(`Authentication failed: ${authTest.error}`);
      }

      systemLogger.api.auth(true, authTest.user?.email || authTest.user?.id);

      // Step 3.4: Check if GitHub App PR testing is enabled
      if (this.options.pr) {
        systemLogger.info(`GitHub App PR testing enabled - PR #${this.options.pr}`, { category: 'test' });
        return await this.runGitHubAppPRTest();
      }

      // Step 3.5: Check if PR sequence testing is enabled
      if (this.options.prSequence) {
        systemLogger.info('PR sequence testing enabled - analyzing commit sequence', { category: 'test' });
        return await this.runPRCommitSequenceTests();
      }

      // Step 4: Analyze git changes
      systemLogger.info('Analyzing git changes', { category: 'git' });
      const changes = await this.analyzeChanges();
      
      if (changes.changes.length === 0) {
        systemLogger.success('No changes detected - skipping test generation');
        return {
          success: true,
          testFiles: []
        };
      }

      systemLogger.info(`Found ${changes.changes.length} changed files`, { category: 'git' });
      
      // Track test execution start
      const executionType = this.options.pr ? 'pr' : 
                          this.options.prSequence ? 'pr-sequence' :
                          this.options.commit ? 'commit' : 'working';
      telemetry.trackTestStart(executionType, {
        filesChanged: changes.changes.length,
        branch: changes.branchInfo.branch,
        hasCommit: !!this.options.commit,
        hasCommitRange: !!this.options.commitRange,
        hasSince: !!this.options.since,
        hasLast: !!this.options.last
      });

      // Step 5: Create commit test suite first to get the suite UUID
      systemLogger.info('Creating test suite', { category: 'test' });

      // Create test description for the changes
      const testDescription = await this.createTestDescription(changes);

      // Get PR number if available
      const prNumber = this.gitAnalyzer.getPRNumber();

      // Generate UUID for the tunnel subdomain
      // This will be used to create the URL: <uuid>.ngrok.debugg.ai
      const urlUuidSubdomain = randomUUID();
      systemLogger.info(`Generated URL UUID subdomain: ${urlUuidSubdomain}`, { category: 'tunnel' });

      const testRequest: any = {
        repoName: this.gitAnalyzer.getRepoName(),
        repoPath: this.options.repoPath,
        branchName: changes.branchInfo.branch,
        commitHash: changes.branchInfo.commitHash,
        workingChanges: changes.changes,
        testDescription,
        key: urlUuidSubdomain,  // This tells backend which subdomain to use
        ...(prNumber && { prNumber })
      };

      const response = await this.client.createCommitTestSuite(testRequest);
      
      if (!response.success || !response.testSuiteUuid) {
        throw new Error(`Failed to create test suite: ${response.error}`);
      }

      systemLogger.info(`Test suite created: ${response.testSuiteUuid}`, { category: 'test' });
      if (response.tunnelKey) {
        systemLogger.info(`Tunnel key received from backend`, { category: 'tunnel' });
      }

      // Step 6: Create tunnel internally (this is our core responsibility!)
      if (this.options.serverPort) {
        // Store the URL UUID subdomain for tunnel creation
        this.urlUuidSubdomain = urlUuidSubdomain;
        await this.createInternalTunnel(response.testSuiteUuid, response.tunnelKey || null);
      } else {
        systemLogger.warn('No server port specified - tests will run without tunnel', { category: 'tunnel' });
        systemLogger.warn('This may cause tests to fail if they require external access', { category: 'tunnel' });
      }

      // Step 7: Wait for tests to complete
      systemLogger.info('Waiting for tests to complete', { category: 'test' });
      const completedSuite = await this.client.waitForCommitTestSuiteCompletion(
        response.testSuiteUuid,
        {
          maxWaitTime: this.options.maxTestWaitTime || 600000,
          pollInterval: 5000,
          onProgress: (suite) => {
            const testCount = suite.tests?.length || 0;
            const completedTests = suite.tests?.filter((t: any) => 
              t.curRun?.status === 'completed' || t.curRun?.status === 'failed'
            ).length || 0;
            
            systemLogger.info(`Running tests... (${completedTests}/${testCount} completed)`, { category: 'test' });
          }
        }
      );

      if (!completedSuite) {
        throw new Error('Test suite timed out or failed to complete');
      }

      // Step 9: Download and save test artifacts (only if enabled)
      let testFiles: string[] = [];
      if (this.options.downloadArtifacts) {
        systemLogger.info('Downloading test artifacts', { category: 'test' });
        testFiles = await this.saveTestArtifacts(completedSuite);
      } else {
        systemLogger.debug('Skipping artifact download - downloadArtifacts is disabled', { category: 'test' });
      }

      // Step 10: Report results
      this.reportResults(completedSuite);

      if (this.options.downloadArtifacts) {
        telemetry.trackArtifactDownload('test_files', true, testFiles.length);
      }
      
      // Track test completion
      const testsGenerated = completedSuite.tests?.length || 0;
      const testExecutionType = this.options.pr ? 'pr' : 
                          this.options.prSequence ? 'pr-sequence' :
                          this.options.commit ? 'commit' : 'working';
      telemetry.trackTestComplete({
        suiteUuid: response.testSuiteUuid,
        duration: Date.now() - testStartTime,
        filesChanged: changes.changes.length,
        testsGenerated,
        success: true,
        executionType: testExecutionType
      });

      const result: E2EResult = {
        success: true,
        suiteUuid: response.testSuiteUuid,
        suite: completedSuite,
        testFiles
      };

      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      systemLogger.error(`Test run failed: ${errorMsg}`);

      // Track test failure
      const failureExecutionType = this.options.pr ? 'pr' :
                          this.options.prSequence ? 'pr-sequence' :
                          this.options.commit ? 'commit' : 'working';
      telemetry.trackTestComplete({
        suiteUuid: '',
        duration: Date.now() - testStartTime,
        filesChanged: 0,
        testsGenerated: 0,
        success: false,
        error: errorMsg,
        executionType: failureExecutionType
      });

      // Cleanup tunnel on error
      await this.cleanup();

      return {
        success: false,
        error: errorMsg
      };
    } finally {
      // Always cleanup tunnel when done
      await this.cleanup();
    }
  }

  /**
   * Run GitHub App-based PR test - sends single request with PR number
   * Backend handles all git analysis via GitHub App integration
   */
  async runGitHubAppPRTest(): Promise<E2EResult> {
    try {
      // Get current branch name
      const branchInfo = await this.gitAnalyzer.getCurrentBranchInfo();
      
      systemLogger.info(`Submitting PR #${this.options.pr} for GitHub App-based testing`, { category: 'test' });
      systemLogger.info(`Branch: ${branchInfo.branch}`, { category: 'git' });
      
      // Generate UUID for the tunnel subdomain
      const urlUuidSubdomain = randomUUID();
      systemLogger.info(`Generated URL UUID subdomain: ${urlUuidSubdomain}`, { category: 'tunnel' });

      // Create test request for GitHub App PR testing
      const testRequest: any = {
        type: 'pull_request',
        repoName: this.gitAnalyzer.getRepoName(),
        repoPath: this.options.repoPath,
        branch: branchInfo.branch,
        pr_number: this.options.pr,
        commitHash: branchInfo.commitHash,
        testDescription: `Automated E2E tests for PR #${this.options.pr}`,
        key: urlUuidSubdomain  // This tells backend which subdomain to use
      };

      // Submit test request
      systemLogger.info('Submitting PR test request to backend', { category: 'api' });
      const createResult = await this.client.createCommitTestSuite(testRequest);
      
      if (!createResult.success || !createResult.testSuiteUuid) {
        throw new Error(createResult.error || 'Failed to create test suite');
      }

      const suiteUuid = createResult.testSuiteUuid;
      systemLogger.info(`Test suite created: ${suiteUuid}`, { category: 'test' });

      // Create tunnel internally if port specified
      if (this.options.serverPort) {
        // Store the URL UUID subdomain for tunnel creation
        this.urlUuidSubdomain = urlUuidSubdomain;
        await this.createInternalTunnel(suiteUuid, createResult.tunnelKey || null);
      }

      // Wait for test completion
      systemLogger.info('Waiting for test execution', { category: 'test' });
      const suite = await this.client.waitForCommitTestSuiteCompletion(suiteUuid, {
        maxWaitTime: this.options.maxTestWaitTime || 600000,
        pollInterval: 5000
      });
      
      if (!suite) {
        throw new Error('Test suite failed or timed out');
      }

      // Download artifacts if requested
      let downloadedFiles: string[] = [];
      if (this.options.downloadArtifacts && suite.status === 'completed') {
        systemLogger.info('Downloading test artifacts', { category: 'test' });
        downloadedFiles = await this.saveTestArtifacts(suite);
      }

      systemLogger.success(`GitHub App PR test completed for PR #${this.options.pr}`);
      
      const result: E2EResult = {
        success: true,
        suiteUuid,
        suite,
        testFiles: downloadedFiles
      };
      
      return result;
      
    } catch (error: any) {
      const errorMsg = error.message || 'Unknown error occurred';
      systemLogger.error(`GitHub App PR test failed: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg
      };
    }
  }

  /**
   * Run PR commit sequence tests - sends individual test requests for each commit
   */
  async runPRCommitSequenceTests(): Promise<E2EResult> {
    try {
      // Step 1: Analyze PR commit sequence
      const prSequence = await this.gitAnalyzer.analyzePRCommitSequence(
        this.options.baseBranch,
        this.options.headBranch
      );

      if (!prSequence || prSequence.commits.length === 0) {
        systemLogger.warn('No PR commits found to test');
        return {
          success: true,
          testFiles: [],
          prSequenceResults: [],
          totalCommitsTested: 0
        };
      }

      systemLogger.info(`Found ${prSequence.totalCommits} commits to test sequentially`, { category: 'test' });
      systemLogger.info(`PR: ${prSequence.baseBranch} <- ${prSequence.headBranch}`, { category: 'git' });

      const sequenceResults: PRSequenceResult[] = [];
      const allTestFiles: string[] = [];
      let anyFailed = false;

      // Process each commit individually
      for (const commit of prSequence.commits) {
        systemLogger.info(`\n--- Testing Commit ${commit.order}/${prSequence.totalCommits} ---`, { category: 'test' });
        systemLogger.info(`Commit: ${commit.hash.substring(0, 8)} - ${commit.message}`, { category: 'git' });
        systemLogger.info(`Author: ${commit.author}`, { category: 'git' });
        systemLogger.info(`Changes: ${commit.changes.length} files`, { category: 'git' });

        try {
          // Create test request for this specific commit
          const result = await this.createCommitTestSuite(commit, prSequence);
          
          if (result.success && result.suiteUuid) {
            // Wait for completion
            const completedSuite = await this.client.waitForCommitTestSuiteCompletion(
              result.suiteUuid,
              {
                maxWaitTime: this.options.maxTestWaitTime || 600000
              }
            );

            if (completedSuite) {
              // Download artifacts if enabled
              let testFiles: string[] = [];
              if (this.options.downloadArtifacts) {
                testFiles = await this.saveTestArtifacts(completedSuite);
                allTestFiles.push(...testFiles);
              }

              sequenceResults.push({
                commitHash: commit.hash,
                commitMessage: commit.message,
                commitOrder: commit.order,
                suiteUuid: result.suiteUuid,
                success: true,
                testFiles
              });

              systemLogger.success(`✓ Commit ${commit.order} tests completed`);
            } else {
              // Test suite timed out
              sequenceResults.push({
                commitHash: commit.hash,
                commitMessage: commit.message,
                commitOrder: commit.order,
                suiteUuid: result.suiteUuid,
                success: false,
                error: 'Test suite timed out'
              });
              anyFailed = true;
              systemLogger.error(`✗ Commit ${commit.order} tests timed out`);
            }
          } else {
            // Test suite creation failed
            sequenceResults.push({
              commitHash: commit.hash,
              commitMessage: commit.message,
              commitOrder: commit.order,
              suiteUuid: '',
              success: false,
              error: result.error || 'Failed to create test suite'
            });
            anyFailed = true;
            systemLogger.error(`✗ Commit ${commit.order} test creation failed: ${result.error}`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          sequenceResults.push({
            commitHash: commit.hash,
            commitMessage: commit.message,
            commitOrder: commit.order,
            suiteUuid: '',
            success: false,
            error: errorMsg
          });
          anyFailed = true;
          systemLogger.error(`✗ Commit ${commit.order} failed: ${errorMsg}`);
        }
      }

      // Report overall results
      const successCount = sequenceResults.filter(r => r.success).length;
      systemLogger.info(`\n=== PR Commit Sequence Results ===`, { category: 'test' });
      systemLogger.info(`Total commits tested: ${prSequence.totalCommits}`, { category: 'test' });
      systemLogger.info(`Successful: ${successCount}`, { category: 'test' });
      systemLogger.info(`Failed: ${prSequence.totalCommits - successCount}`, { category: 'test' });

      if (this.options.downloadArtifacts && allTestFiles.length > 0) {
        systemLogger.success(`Generated ${allTestFiles.length} total test files across all commits`);
      }

      const firstSuiteUuid = sequenceResults.length > 0 && sequenceResults[0] ? sequenceResults[0].suiteUuid : undefined;
      
      return {
        success: !anyFailed,
        testFiles: allTestFiles,
        prSequenceResults: sequenceResults,
        totalCommitsTested: prSequence.totalCommits,
        suiteUuid: firstSuiteUuid
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      systemLogger.error(`PR sequence testing failed: ${errorMsg}`);
      
      return {
        success: false,
        error: errorMsg,
        prSequenceResults: [],
        totalCommitsTested: 0
      };
    }
  }

  /**
   * Create a test suite for a specific commit in a PR sequence
   */
  private async createCommitTestSuite(commit: any, prSequence: any): Promise<any> {
    // Get repository information
    const repoName = this.gitAnalyzer.getRepoName();
    
    // Create test description specific to this commit
    const testDescription = await this.createCommitTestDescription(commit, prSequence);

    const testRequest: any = {
      repoName,
      repoPath: this.options.repoPath,
      branchName: prSequence.headBranch,
      commitHash: commit.hash,
      workingChanges: commit.changes.map((change: any) => ({
        status: change.status,
        file: change.file,
        diff: change.diff
      })),
      testDescription,
      ...(prSequence.prNumber && { prNumber: prSequence.prNumber }),
      // Add PR context metadata
      prContext: {
        baseBranch: prSequence.baseBranch,
        headBranch: prSequence.headBranch,
        commitOrder: commit.order,
        totalCommits: prSequence.totalCommits,
        isSequentialTest: true
      }
    };

    // Create test suite first
    const result = await this.client.createCommitTestSuite(testRequest);

    // Note: For PR sequence tests, we don't create tunnels per commit
    // The main test run should have already set up the tunnel

    return result;
  }


  /**
   * Create a test description for a specific commit in a PR sequence
   */
  private async createCommitTestDescription(commit: any, prSequence: any): Promise<string> {
    const changeTypes = this.analyzeFileTypes(commit.changes);
    
    // Count changes by type
    const componentCount = changeTypes.filter(t => t.type === 'component').reduce((sum, t) => sum + t.count, 0);
    const routingCount = changeTypes.filter(t => t.type === 'routing').reduce((sum, t) => sum + t.count, 0);
    const configCount = changeTypes.filter(t => t.type === 'configuration').reduce((sum, t) => sum + t.count, 0);
    const stylingCount = changeTypes.filter(t => t.type === 'styling').reduce((sum, t) => sum + t.count, 0);
    const otherCount = changeTypes.filter(t => !['component', 'routing', 'configuration', 'styling'].includes(t.type)).reduce((sum, t) => sum + t.count, 0);
    
    return `Sequential PR Test - Commit ${commit.order}/${prSequence.totalCommits}

Commit: ${commit.hash.substring(0, 8)} - ${commit.message}
Author: ${commit.author}
Branch: ${prSequence.baseBranch} <- ${prSequence.headBranch}

Changes in this commit:
${commit.changes.map((c: any) => `- [${c.status}] ${c.file}`).join('\n')}

Change Summary:
- ${commit.changes.length} file${commit.changes.length !== 1 ? 's' : ''} modified
- Components: ${componentCount}
- Routing: ${routingCount}
- Configuration: ${configCount}
- Styling: ${stylingCount}
- Other: ${otherCount}

Focus: Test the specific functionality changes introduced by this individual commit in the sequence.`;
  }

  /**
   * Wait for the local development server to be ready
   */
  async waitForServer(port: number = 3000, maxWaitTime: number = 60000): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 2000;

    systemLogger.info(`Waiting for server on port ${port}`, { category: 'server' });

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Simple HTTP check to see if server is responding
        const response = await fetch(`http://localhost:${port}`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok || response.status === 404) {
          systemLogger.success(`Server is ready on port ${port}`);
          return true;
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    systemLogger.error(`Server on port ${port} did not start within ${maxWaitTime}ms`);
    return false;
  }

  /**
   * Analyze git changes (working changes, specific commit, or commit range)
   */
  private async analyzeChanges(): Promise<WorkingChanges> {
    // Priority order: explicit options > environment variables > working changes
    
    // 1. Check for explicit commit hash option
    if (this.options.commit) {
      return await this.gitAnalyzer.getCommitChanges(this.options.commit);
    }
    
    // 2. Check for commit range option
    if (this.options.commitRange) {
      const commitHashes = await this.gitAnalyzer.getCommitsFromRange(this.options.commitRange);
      return await this.gitAnalyzer.getCombinedCommitChanges(commitHashes);
    }
    
    // 3. Check for since date option
    if (this.options.since) {
      const commitHashes = await this.gitAnalyzer.getCommitsSince(this.options.since);
      return await this.gitAnalyzer.getCombinedCommitChanges(commitHashes);
    }
    
    // 4. Check for last N commits option
    if (this.options.last) {
      const commitHashes = await this.gitAnalyzer.getLastCommits(this.options.last);
      return await this.gitAnalyzer.getCombinedCommitChanges(commitHashes);
    }
    
    // 5. In CI/CD, check for environment variable (GitHub Actions)
    const envCommitHash = process.env.GITHUB_SHA;
    if (envCommitHash) {
      // Analyze specific commit (typical for push events)
      return await this.gitAnalyzer.getCommitChanges(envCommitHash);
    }
    
    // 6. Default: analyze working changes (for local development)
    return await this.gitAnalyzer.getWorkingChanges();
  }

  /**
   * Create a comprehensive test description based on changes
   */
  private async createTestDescription(changes: WorkingChanges): Promise<string> {
    const commitHash = changes.branchInfo.commitHash;
    const branch = changes.branchInfo.branch;
    const fileCount = changes.changes.length;

    // Use enhanced context analysis inspired by backend architecture
    const contextAnalysis = await this.gitAnalyzer.analyzeChangesWithContext(changes.changes);

    // Determine the source of changes for better description
    let sourceDescription: string;
    if (this.options.commit) {
      sourceDescription = `specific commit ${this.options.commit.substring(0, 8)}`;
    } else if (this.options.commitRange) {
      sourceDescription = `commit range ${this.options.commitRange}`;
    } else if (this.options.since) {
      sourceDescription = `commits since ${this.options.since}`;
    } else if (this.options.last) {
      sourceDescription = `last ${this.options.last} commit${this.options.last > 1 ? 's' : ''}`;
    } else if (process.env.GITHUB_SHA) {
      sourceDescription = `CI commit ${commitHash.substring(0, 8)}`;
    } else {
      sourceDescription = `working changes`;
    }

    // Build focused description based on analysis
    let description = `Generate comprehensive E2E tests for the ${sourceDescription} on branch ${branch}.

Change Analysis:
- Total Files: ${fileCount}
- Complexity: ${contextAnalysis.changeComplexity.toUpperCase()}
- Languages: ${contextAnalysis.affectedLanguages.join(', ')}`;

    // Add specific areas of focus based on changes
    if (contextAnalysis.suggestedFocusAreas.length > 0) {
      description += `

Focus Areas:
${contextAnalysis.suggestedFocusAreas.map(area => `- ${area}`).join('\n')}`;
    }

    // Add component-specific context
    if (contextAnalysis.componentChanges.length > 0) {
      description += `

Components Changed:
${contextAnalysis.componentChanges.slice(0, 5).map(file => `- ${file}`).join('\n')}${contextAnalysis.componentChanges.length > 5 ? '\n- ...' : ''}`;
    }

    // Add routing context
    if (contextAnalysis.routingChanges.length > 0) {
      description += `

Routing Changes:
${contextAnalysis.routingChanges.map(file => `- ${file}`).join('\n')}`;
    }

    // Add configuration context
    if (contextAnalysis.configChanges.length > 0) {
      description += `

Configuration Changes:
${contextAnalysis.configChanges.map(file => `- ${file}`).join('\n')}`;
    }

    description += `

Test Requirements:
1. Generate Playwright tests focused on the identified change areas
2. Test both positive and negative scenarios for modified functionality
3. Include edge cases and error handling for ${contextAnalysis.changeComplexity} complexity changes
4. Focus testing on: ${contextAnalysis.suggestedFocusAreas.slice(0, 3).join(', ')}
5. Ensure tests cover the interaction between changed ${contextAnalysis.affectedLanguages.join(' and ')} components`;

    return description;
  }

  /**
   * Analyze file types in the changes
   */
  private analyzeFileTypes(files: string[]): Array<{type: string; count: number; files: string[]}> {
    const typeMap = new Map<string, string[]>();

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      let type: string;

      switch (ext) {
        case '.ts':
        case '.tsx':
          type = 'TypeScript';
          break;
        case '.js':
        case '.jsx':
          type = 'JavaScript';
          break;
        case '.py':
          type = 'Python';
          break;
        case '.java':
          type = 'Java';
          break;
        case '.css':
        case '.scss':
        case '.sass':
          type = 'Stylesheets';
          break;
        case '.html':
          type = 'HTML';
          break;
        case '.json':
          type = 'Configuration';
          break;
        case '.md':
          type = 'Documentation';
          break;
        default:
          if (file.includes('test') || file.includes('spec')) {
            type = 'Tests';
          } else if (file.includes('config') || file.includes('package')) {
            type = 'Configuration';
          } else {
            type = 'Other';
          }
      }

      if (!typeMap.has(type)) {
        typeMap.set(type, []);
      }
      typeMap.get(type)!.push(file);
    }

    return Array.from(typeMap.entries()).map(([type, files]) => ({
      type,
      count: files.length,
      files
    }));
  }

  /**
   * Save test artifacts (scripts, recordings, etc.) to local directory
   */
  private async saveTestArtifacts(suite: any): Promise<string[]> {
    const savedFiles: string[] = [];
    
    if (!suite.tests || suite.tests.length === 0) {
      systemLogger.debug('No tests found in suite for artifact saving', { category: 'artifact' });
      return savedFiles;
    }

    systemLogger.debug(`Starting to save artifacts for ${suite.tests.length} tests`, { category: 'artifact' });

    // Ensure test output directory exists
    if (!this.options.testOutputDir) {
      throw new Error('testOutputDir is undefined. This should not happen - please file a bug report.');
    }
    
    const outputDir = path.join(this.options.repoPath, this.options.testOutputDir);
    await fs.ensureDir(outputDir);

    for (const test of suite.tests) {
      if (!test.curRun) {
        systemLogger.debug(`Skipping test ${test.name || test.uuid} - no curRun data`, { category: 'artifact' });
        continue;
      }

      const testName = test.name || `test-${test.uuid?.substring(0, 8)}`;
      const testDir = path.join(outputDir, testName);
      await fs.ensureDir(testDir);
      
      systemLogger.debug(`Processing test: ${testName}`, { 
        category: 'artifact',
        details: {
          hasScript: !!test.curRun.runScript,
          hasGif: !!test.curRun.runGif,
          hasJson: !!test.curRun.runJson,
          testDir: path.relative(this.options.repoPath, testDir)
        }
      });

      // Save test script
      if (test.curRun.runScript) {
        try {
          const scriptPath = path.join(testDir, `${testName}.spec.js`);
          // For scripts, we need to replace tunnel URLs with localhost
          const originalBaseUrl = `http://localhost:3000`;
          
          systemLogger.debug(`Downloading script for ${testName}`, { 
            category: 'artifact',
            details: {
              url: test.curRun.runScript,
              targetPath: path.relative(this.options.repoPath, scriptPath),
              originalBaseUrl
            }
          });
          
          const success = await this.client.downloadArtifactToFile(test.curRun.runScript, scriptPath, originalBaseUrl);
          systemLogger.debug(`Script download result for ${testName}: ${success}`, { category: 'artifact' });
          
          if (success) {
            savedFiles.push(scriptPath);
            systemLogger.info(`✓ Saved test script: ${path.relative(this.options.repoPath, scriptPath)}`);
          } else {
            systemLogger.warn(`⚠ Script download failed for ${testName} - no file saved`);
          }
        } catch (error) {
          systemLogger.warn(`⚠ Failed to download script for ${testName}: ${error}`);
        }
      }

      // Save test recording (GIF)
      if (test.curRun.runGif) {
        try {
          const gifPath = path.join(testDir, `${testName}-recording.gif`);
          systemLogger.debug(`Downloading GIF for ${testName}`, { 
            category: 'artifact',
            details: {
              url: test.curRun.runGif,
              targetPath: path.relative(this.options.repoPath, gifPath)
            }
          });
          
          const success = await this.client.downloadArtifactToFile(test.curRun.runGif, gifPath);
          systemLogger.debug(`GIF download result for ${testName}: ${success}`, { category: 'artifact' });
          
          if (success) {
            savedFiles.push(gifPath);
            systemLogger.info(`✓ Saved test recording: ${path.relative(this.options.repoPath, gifPath)}`);
          } else {
            systemLogger.warn(`⚠ GIF download failed for ${testName} - no file saved`);
          }
        } catch (error) {
          systemLogger.warn(`⚠ Failed to download recording for ${testName}: ${error}`);
        }
      }

      // Save test details (JSON)
      if (test.curRun.runJson) {
        try {
          const jsonPath = path.join(testDir, `${testName}-details.json`);
          systemLogger.debug(`Downloading JSON for ${testName}`, { 
            category: 'artifact',
            details: {
              url: test.curRun.runJson,
              targetPath: path.relative(this.options.repoPath, jsonPath)
            }
          });
          
          const success = await this.client.downloadArtifactToFile(test.curRun.runJson, jsonPath);
          systemLogger.debug(`JSON download result for ${testName}: ${success}`, { category: 'artifact' });
          
          if (success) {
            savedFiles.push(jsonPath);
            systemLogger.info(`✓ Saved test details: ${path.relative(this.options.repoPath, jsonPath)}`);
          } else {
            systemLogger.warn(`⚠ JSON download failed for ${testName} - no file saved`);
          }
        } catch (error) {
          systemLogger.warn(`⚠ Failed to download details for ${testName}: ${error}`);
        }
      }
    }

    systemLogger.debug(`Artifact saving completed. Total files saved: ${savedFiles.length}`, { 
      category: 'artifact',
      details: {
        savedFiles: savedFiles.map(f => path.relative(this.options.repoPath, f))
      }
    });
    
    return savedFiles;
  }

  /**
   * Report test results to console
   */
  private reportResults(suite: any): void {
    // Use systemLogger's displayResults which handles both dev and user modes
    systemLogger.displayResults(suite);

    // Set exit code for CI/CD based on test outcomes
    if (suite.tests && suite.tests.length > 0) {
      const failed = suite.tests.filter((t: any) => t.curRun?.outcome === 'fail').length;
      if (failed > 0) {
        process.exitCode = 1; // Set non-zero exit code for CI/CD
      }
    }
  }
}