import { CLIBackendClient } from '../backend/cli/client';
import { GitAnalyzer, WorkingChanges } from './git-analyzer';
import { TunnelManager, TunnelInfo } from './tunnel-manager';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import { systemLogger } from '../util/system-logger';

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

      // Step 4: Validate tunnel URL if provided (simplified for now)
      if (this.options.tunnelUrl) {
        systemLogger.info('Using tunnel URL', { category: 'tunnel' });
        // Note: Tunnel validation can be added later if needed
        systemLogger.info(`Using tunnel URL: ${this.options.tunnelUrl}`);
      }

      // Step 5: Analyze git changes
      systemLogger.info('Analyzing git changes', { category: 'git' });
      const changes = await this.analyzeChanges();
      
      if (changes.changes.length === 0) {
        systemLogger.success('No changes detected - skipping test generation');
        return {
          success: true,
          testFiles: []
        };
        return {
          success: true,
          testFiles: []
        };
      }

      systemLogger.info(`Found ${changes.changes.length} changed files`, { category: 'git' });

      // Step 7: Submit test request
      systemLogger.info('Creating test suite', { category: 'test' });
      const testRequest: any = {
        repoName: this.gitAnalyzer.getRepoName(),
        repoPath: this.options.repoPath,
        branchName: changes.branchInfo.branch,
        commitHash: changes.branchInfo.commitHash,
        workingChanges: changes.changes
      };

      // Add tunnel key (UUID) for custom endpoints (e.g., <uuid>.debugg.ai)
      // This tells the backend which subdomain to expect the tunnel on
      if (this.options.tunnelKey) {
        testRequest.key = this.options.tunnelKey;
        systemLogger.debug('Sending tunnel key to backend', { 
          category: 'tunnel',
          details: { key: this.options.tunnelKey.substring(0, 8) + '...' } 
        });
      }

      // if (this.options.tunnelUrl) {
      //   testRequest.publicUrl = this.options.tunnelUrl;
      //   testRequest.testEnvironment = {
      //     url: this.options.tunnelUrl,
      //     type: 'ngrok_tunnel' as const,
      //     metadata: this.options.tunnelMetadata
      //   };
      // }

      const response = await this.client.createCommitTestSuite(testRequest);
      
      if (!response.success || !response.testSuiteUuid) {
        throw new Error(`Failed to create test suite: ${response.error}`);
      }

      systemLogger.info(`Test suite created: ${response.testSuiteUuid}`, { category: 'test' });

      // Step 7.5: Create tunnel if requested and backend provided tunnelKey
      let tunnelInfo: TunnelInfo | undefined;
      systemLogger.debug('Tunnel setup', { 
        category: 'tunnel',
        details: { 
          createTunnel: this.options.createTunnel,
          tunnelKey: this.options.tunnelKey,
          backendTunnelKey: response.tunnelKey
        } 
      });
      if (response.tunnelKey && this.options.tunnelKey) {
        systemLogger.info('Setting up ngrok tunnel', { category: 'tunnel' });
        systemLogger.info('TUNNEL SETUP');
        systemLogger.info(`Endpoint UUID: ${this.options.tunnelKey}`);
        systemLogger.info(`Expected URL: https://${this.options.tunnelKey}.ngrok.debugg.ai`);
        systemLogger.info(`Local port: ${this.options.tunnelPort || 3000}`);
        systemLogger.info(`Backend provided tunnelKey: ${response.tunnelKey ? '✓ YES' : '✗ NO'}`);
        
        if (!this.tunnelManager) {
          throw new Error('Tunnel manager not initialized. This should not happen.');
        }

        const tunnelPort = this.options.tunnelPort || 3000;
        
        try {
          systemLogger.info('Starting ngrok tunnel');
          tunnelInfo = await this.tunnelManager.createTunnelWithBackendKey(
            tunnelPort,
            this.options.tunnelKey, // UUID for endpoint
            response.tunnelKey       // ngrok auth token from backend
          );
          
          systemLogger.tunnel.connected(tunnelInfo.url);
          systemLogger.success(`TUNNEL ACTIVE: ${tunnelInfo.url} -> localhost:${tunnelPort}`);
        } catch (error) {
          systemLogger.error(`TUNNEL FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`);
          systemLogger.warn('Tests will proceed without tunnel - ensure your server is accessible at the expected URL');
          systemLogger.warn(`Expected backend URL: https://${this.options.tunnelKey}.ngrok.debugg.ai`);
        }
      } else {
        // Log why tunnel wasn't created
        if (this.options.createTunnel) {
          systemLogger.info('TUNNEL SETUP SKIPPED');
          systemLogger.debug(`createTunnel: ${this.options.createTunnel ? '✓' : '✗'}`);
          systemLogger.debug(`tunnelKey provided: ${this.options.tunnelKey ? '✓' : '✗'}`);
          systemLogger.debug(`backend tunnelKey: ${response.tunnelKey ? '✓' : '✗'}`);

        }
      }

      // Step 8: Wait for tests to complete
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

      // Step 9: Download and save test artifacts
      systemLogger.info('Downloading test artifacts', { category: 'test' });
      const testFiles = await this.saveTestArtifacts(completedSuite);

      // Step 10: Report results
      this.reportResults(completedSuite);

      systemLogger.success(`Tests completed successfully! Generated ${testFiles.length} test files`);

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
      systemLogger.error(`Test run failed: ${errorMsg}`);
      
      return {
        success: false,
        error: errorMsg
      };
    } finally {
      // Cleanup tunnel if it was created
      if (this.tunnelManager) {
        try {
          await this.tunnelManager.disconnectAll();
          systemLogger.info('✓ Tunnels cleaned up');
        } catch (error) {
          systemLogger.warn('⚠ Failed to cleanup tunnels: ' + error);
        }
      }
      
    }
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
          // For scripts, we need to replace tunnel URLs with localhost - use originalBaseUrl like recordingHandler
          // Fallback to port 3000 if tunnelPort is not set
          const port = this.options.tunnelPort || 3000;
          const originalBaseUrl = `http://localhost:${port}`;
          
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

    // Set exit code for CI/CD
    if (suite.tests && suite.tests.length > 0) {
      const failed = suite.tests.filter((t: any) => t.curRun?.status === 'failed').length;
      if (failed > 0) {
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