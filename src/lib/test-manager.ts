import { CLIBackendClient } from '../backend/cli/client';
import { GitAnalyzer, WorkingChanges } from './git-analyzer';
import { TunnelManager, TunnelInfo } from './tunnel-manager';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import ora, { Ora } from 'ora';

export interface TestManagerOptions {
  apiKey: string;
  repoPath: string;
  baseUrl?: string;
  testOutputDir?: string;
  waitForServer?: boolean;
  serverTimeout?: number;
  maxTestWaitTime?: number;
  tunnelUrl?: string;
  tunnelMetadata?: Record<string, any> | undefined;
  // Commit analysis options
  commit?: string; // Specific commit hash
  commitRange?: string; // Commit range (e.g., HEAD~3..HEAD)
  since?: string; // Commits since date/time
  last?: number; // Last N commits
  // Tunnel configuration
  tunnelKey?: string; // UUID for custom endpoints (e.g., <uuid>.debugg.ai) - passed as 'key' to backend
  createTunnel?: boolean; // Whether to create an ngrok tunnel after getting tunnelKey from backend
  tunnelPort?: number; // Port to tunnel (defaults to 3000)
}

export interface TestResult {
  success: boolean;
  suiteUuid?: string;
  suite?: any; // Using any for now since we're working with backend types
  error?: string;
  testFiles?: string[];
  tunnelKey?: string; // TunnelKey returned from backend for ngrok setup
  tunnelInfo?: TunnelInfo; // Tunnel information if tunnel was created
}

/**
 * Manages the complete test lifecycle from commit analysis to result reporting
 */
export class TestManager {
  private client: CLIBackendClient;
  private gitAnalyzer: GitAnalyzer;
  private tunnelManager?: TunnelManager;
  private options: TestManagerOptions;
  private spinner: Ora | null = null;

  constructor(options: TestManagerOptions) {
    this.options = {
      testOutputDir: 'tests/debugg-ai',
      serverTimeout: 30000, // 30 seconds
      maxTestWaitTime: 600000, // 10 minutes
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

    // Initialize tunnel manager if tunnel creation is requested
    if (this.options.createTunnel) {
      this.tunnelManager = new TunnelManager({
        baseDomain: 'ngrok.debugg.ai'
      });
    }
  }

  /**
   * Create TestManager with tunnel URL support
   */
  static withTunnel(
    options: Omit<TestManagerOptions, 'tunnelUrl' | 'tunnelMetadata'>,
    tunnelUrl: string,
    tunnelMetadata?: Record<string, any>
  ): TestManager {
    return new TestManager({
      ...options,
      tunnelUrl,
      tunnelMetadata
    });
  }

  /**
   * Create TestManager that will create an ngrok tunnel after backend provides tunnelKey
   * This is the correct flow: Backend creates commit suite -> provides tunnelKey -> create tunnel
   */
  static withAutoTunnel(
    options: TestManagerOptions,
    endpointUuid: string,
    tunnelPort: number = 3000
  ): TestManager {
    return new TestManager({
      ...options,
      tunnelKey: endpointUuid,
      createTunnel: true,
      tunnelPort
    });
  }

  /**
   * Run tests for the current commit or working changes
   */
  async runCommitTests(): Promise<TestResult> {
    this.spinner = ora('Initializing DebuggAI test run...').start();

    try {
      // Step 1: Validate git repository
      const isValidRepo = await this.gitAnalyzer.validateGitRepo();
      if (!isValidRepo) {
        throw new Error('Not a valid git repository');
      }

      // Step 2: Initialize the CLI client (includes connection test)
      this.spinner.text = 'Initializing backend client...';
      await this.client.initialize();

      // Step 3: Test authentication
      this.spinner.text = 'Validating API key...';
      const authTest = await this.client.testAuthentication();
      if (!authTest.success) {
        throw new Error(`Authentication failed: ${authTest.error}`);
      }

      this.spinner.text = `Authenticated as user: ${authTest.user?.email || authTest.user?.id}`;

      // Step 4: Validate tunnel URL if provided (simplified for now)
      if (this.options.tunnelUrl) {
        this.spinner.text = 'Using tunnel URL...';
        // Note: Tunnel validation can be added later if needed
        console.log(`Using tunnel URL: ${this.options.tunnelUrl}`);
      }

      // Step 5: Analyze git changes
      this.spinner.text = 'Analyzing git changes...';
      const changes = await this.analyzeChanges();
      
      if (changes.changes.length === 0) {
        this.spinner.succeed('No changes detected - skipping test generation');
        return {
          success: true,
          testFiles: []
        };
      }

      this.spinner.text = `Found ${changes.changes.length} changed files`;

      // Step 6: Create test description with enhanced context analysis
      const testDescription = await this.createTestDescription(changes);

      // Step 7: Submit test request
      this.spinner.text = 'Creating test suite...';
      const testRequest: any = {
        repoName: this.gitAnalyzer.getRepoName(),
        repoPath: this.options.repoPath,
        branchName: changes.branchInfo.branch,
        commitHash: changes.branchInfo.commitHash,
        workingChanges: changes.changes,
        testDescription
      };

      // Add tunnel key (UUID) for custom endpoints (e.g., <uuid>.debugg.ai)
      // This tells the backend which subdomain to expect the tunnel on
      if (this.options.tunnelKey) {
        testRequest.key = this.options.tunnelKey;
      }

      if (this.options.tunnelUrl) {
        testRequest.publicUrl = this.options.tunnelUrl;
        testRequest.testEnvironment = {
          url: this.options.tunnelUrl,
          type: 'ngrok_tunnel' as const,
          metadata: this.options.tunnelMetadata
        };
      }

      const response = await this.client.createCommitTestSuite(testRequest);
      
      if (!response.success || !response.testSuiteUuid) {
        throw new Error(`Failed to create test suite: ${response.error}`);
      }

      this.spinner.text = `Test suite created: ${response.testSuiteUuid}`;

      // Step 7.5: Create tunnel if requested and backend provided tunnelKey
      let tunnelInfo: TunnelInfo | undefined;
      if (this.options.createTunnel && response.tunnelKey && this.options.tunnelKey) {
        this.spinner.text = 'Creating ngrok tunnel...';
        
        if (!this.tunnelManager) {
          throw new Error('Tunnel manager not initialized. This should not happen.');
        }

        const tunnelPort = this.options.tunnelPort || 3000;
        
        try {
          tunnelInfo = await this.tunnelManager.createTunnelWithBackendKey(
            tunnelPort,
            this.options.tunnelKey, // UUID for endpoint
            response.tunnelKey       // ngrok auth token from backend
          );
          
          this.spinner.text = `Tunnel created: ${tunnelInfo.url} -> localhost:${tunnelPort}`;
          console.log(`✓ Tunnel ready: ${tunnelInfo.url}`);
        } catch (error) {
          console.warn(`⚠ Failed to create tunnel: ${error instanceof Error ? error.message : 'Unknown error'}`);
          console.log('Tests will proceed without tunnel - ensure your server is accessible at the expected URL');
        }
      }

      // Step 8: Wait for tests to complete
      this.spinner.text = 'Waiting for tests to complete...';
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
            
            this.spinner!.text = `Running tests... (${completedTests}/${testCount} completed)`;
          }
        }
      );

      if (!completedSuite) {
        throw new Error('Test suite timed out or failed to complete');
      }

      // Step 9: Download and save test artifacts
      this.spinner.text = 'Downloading test artifacts...';
      const testFiles = await this.saveTestArtifacts(completedSuite);

      // Step 10: Report results
      this.reportResults(completedSuite);

      this.spinner.succeed(`Tests completed successfully! Generated ${testFiles.length} test files`);

      const result: TestResult = {
        success: true,
        suiteUuid: response.testSuiteUuid,
        suite: completedSuite,
        testFiles
      };

      // Add optional fields only if they have values
      if (response.tunnelKey) {
        result.tunnelKey = response.tunnelKey;
      }

      if (tunnelInfo) {
        result.tunnelInfo = tunnelInfo;
      }

      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.spinner?.fail(`Test run failed: ${errorMsg}`);
      
      return {
        success: false,
        error: errorMsg
      };
    } finally {
      // Cleanup tunnel if it was created
      if (this.tunnelManager) {
        try {
          await this.tunnelManager.disconnectAll();
          console.log('✓ Tunnels cleaned up');
        } catch (error) {
          console.warn('⚠ Failed to cleanup tunnels:', error);
        }
      }
      
      this.spinner = null;
    }
  }

  /**
   * Wait for the local development server to be ready
   */
  async waitForServer(port: number = 3000, maxWaitTime: number = 60000): Promise<boolean> {
    const startTime = Date.now();
    const pollInterval = 2000;

    this.spinner = ora(`Waiting for server on port ${port}...`).start();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Simple HTTP check to see if server is responding
        const response = await fetch(`http://localhost:${port}`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });

        if (response.ok || response.status === 404) {
          this.spinner.succeed(`Server is ready on port ${port}`);
          return true;
        }
      } catch (error) {
        // Server not ready yet, continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    this.spinner.fail(`Server on port ${port} did not start within ${maxWaitTime}ms`);
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
      return savedFiles;
    }

    // Ensure test output directory exists
    const outputDir = path.join(this.options.repoPath, this.options.testOutputDir!);
    await fs.ensureDir(outputDir);

    for (const test of suite.tests) {
      if (!test.curRun) continue;

      const testName = test.name || `test-${test.uuid?.substring(0, 8)}`;
      const testDir = path.join(outputDir, testName);
      await fs.ensureDir(testDir);

      // Save test script
      if (test.curRun.runScript) {
        try {
          const scriptBuffer = await this.client.downloadArtifact(test.curRun.runScript);
          if (scriptBuffer) {
            const scriptPath = path.join(testDir, `${testName}.spec.js`);
            await fs.writeFile(scriptPath, scriptBuffer);
            savedFiles.push(scriptPath);
            console.log(chalk.green(`✓ Saved test script: ${path.relative(this.options.repoPath, scriptPath)}`));
          }
        } catch (error) {
          console.warn(chalk.yellow(`⚠ Failed to download script for ${testName}: ${error}`));
        }
      }

      // Save test recording (GIF)
      if (test.curRun.runGif) {
        try {
          const gifBuffer = await this.client.downloadArtifact(test.curRun.runGif);
          if (gifBuffer) {
            const gifPath = path.join(testDir, `${testName}-recording.gif`);
            await fs.writeFile(gifPath, gifBuffer);
            savedFiles.push(gifPath);
            console.log(chalk.green(`✓ Saved test recording: ${path.relative(this.options.repoPath, gifPath)}`));
          }
        } catch (error) {
          console.warn(chalk.yellow(`⚠ Failed to download recording for ${testName}: ${error}`));
        }
      }

      // Save test details (JSON)
      if (test.curRun.runJson) {
        try {
          const jsonBuffer = await this.client.downloadArtifact(test.curRun.runJson);
          if (jsonBuffer) {
            const jsonPath = path.join(testDir, `${testName}-details.json`);
            await fs.writeFile(jsonPath, jsonBuffer);
            savedFiles.push(jsonPath);
            console.log(chalk.green(`✓ Saved test details: ${path.relative(this.options.repoPath, jsonPath)}`));
          }
        } catch (error) {
          console.warn(chalk.yellow(`⚠ Failed to download details for ${testName}: ${error}`));
        }
      }
    }

    return savedFiles;
  }

  /**
   * Report test results to console
   */
  private reportResults(suite: any): void {
    console.log('\n' + chalk.bold('=== Test Results ==='));
    console.log(`Suite: ${suite.name || suite.uuid}`);
    console.log(`Status: ${this.getStatusColor(suite.status || 'unknown')}`);
    console.log(`Tests: ${suite.tests?.length || 0}`);

    if (suite.tests && suite.tests.length > 0) {
      console.log('\n' + chalk.bold('Individual Tests:'));
      
      for (const test of suite.tests) {
        const status = test.curRun?.status || 'unknown';
        const statusColored = this.getStatusColor(status);
        console.log(`  • ${test.name || test.uuid}: ${statusColored}`);
      }

      // Summary
      const passed = suite.tests.filter((t: any) => t.curRun?.status === 'completed').length;
      const failed = suite.tests.filter((t: any) => t.curRun?.status === 'failed').length;
      const total = suite.tests.length;

      console.log('\n' + chalk.bold('Summary:'));
      console.log(`  ${chalk.green(`✓ Passed: ${passed}`)}`);
      console.log(`  ${chalk.red(`✗ Failed: ${failed}`)}`);
      console.log(`  ${chalk.blue(`Total: ${total}`)}`);

      if (failed > 0) {
        console.log(`\n${chalk.yellow('⚠ Some tests failed. Check the generated test files and recordings for details.')}`);
        process.exitCode = 1; // Set non-zero exit code for CI/CD
      }
    }
  }

  /**
   * Get colored status text
   */
  private getStatusColor(status: string): string {
    switch (status) {
      case 'completed':
        return chalk.green('✓ PASSED');
      case 'failed':
        return chalk.red('✗ FAILED');
      case 'running':
        return chalk.yellow('⏳ RUNNING');
      case 'pending':
        return chalk.blue('⏸ PENDING');
      default:
        return chalk.gray('❓ UNKNOWN');
    }
  }
}