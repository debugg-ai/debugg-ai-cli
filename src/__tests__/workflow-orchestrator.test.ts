import { WorkflowOrchestrator } from '../lib/workflow-orchestrator';
import { TunnelManager } from '../lib/tunnel-manager';
import { ServerManager } from '../lib/server-manager';
import { TestManager } from '../lib/test-manager';

jest.mock('../lib/tunnel-manager');
jest.mock('../lib/server-manager');
jest.mock('../lib/test-manager');

const MockTunnelManager = TunnelManager as jest.MockedClass<typeof TunnelManager>;
const MockServerManager = ServerManager as jest.MockedClass<typeof ServerManager>;
const MockTestManager = TestManager as jest.MockedClass<typeof TestManager>;

describe('WorkflowOrchestrator', () => {
  let orchestrator: WorkflowOrchestrator;
  let mockTunnelManager: jest.Mocked<TunnelManager>;
  let mockServerManager: jest.Mocked<ServerManager>;
  let mockTestManager: jest.Mocked<TestManager>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockTunnelManager = {
      createTunnel: jest.fn(),
      disconnectTunnel: jest.fn().mockResolvedValue(undefined),
      disconnectAll: jest.fn().mockResolvedValue(undefined),
      getTunnelInfo: jest.fn(),
      getAllTunnels: jest.fn().mockReturnValue([]),
      generateUUID: jest.fn(),
      isValidTunnelUrl: jest.fn(),
      getTunnelStatus: jest.fn()
    } as any;

    mockServerManager = {
      startServer: jest.fn(),
      stopServer: jest.fn(),
      stopAllServers: jest.fn().mockResolvedValue(undefined),
      getServerStatus: jest.fn(),
      checkServerHealth: jest.fn(),
      getAllServerStatus: jest.fn().mockReturnValue({}),
      isServerRunning: jest.fn(),
      getServerUrl: jest.fn(),
      waitForServer: jest.fn()
    } as any;

    mockTestManager = {
      runCommitTests: jest.fn(),
      waitForServer: jest.fn()
    } as any;

    MockTunnelManager.prototype.createTunnel = mockTunnelManager.createTunnel;
    MockTunnelManager.prototype.disconnectTunnel = mockTunnelManager.disconnectTunnel;
    MockTunnelManager.prototype.disconnectAll = mockTunnelManager.disconnectAll;
    MockTunnelManager.prototype.getAllTunnels = mockTunnelManager.getAllTunnels;

    MockServerManager.prototype.startServer = mockServerManager.startServer;
    MockServerManager.prototype.stopAllServers = mockServerManager.stopAllServers;
    MockServerManager.prototype.getServerUrl = mockServerManager.getServerUrl;
    MockServerManager.prototype.waitForServer = mockServerManager.waitForServer;
    MockServerManager.prototype.getAllServerStatus = mockServerManager.getAllServerStatus;

    MockTestManager.prototype.runCommitTests = mockTestManager.runCommitTests;

    orchestrator = new WorkflowOrchestrator({
      ngrokAuthToken: 'test-token',
      baseDomain: 'test.debugg.ai',
      verbose: true
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const defaultOrchestrator = new WorkflowOrchestrator();
      expect(defaultOrchestrator).toBeInstanceOf(WorkflowOrchestrator);
    });

    it('should initialize with custom options', () => {
      expect(orchestrator).toBeInstanceOf(WorkflowOrchestrator);
    });
  });

  describe('executeWorkflow', () => {
    const mockWorkflowConfig = {
      server: {
        command: 'npm',
        args: ['start'],
        port: 3000
      },
      tunnel: {
        port: 3000,
        authtoken: 'test-token'
      },
      test: {
        apiKey: 'test-api-key',
        repoPath: '/test/repo'
      }
    };

    it('should execute complete workflow successfully', async () => {
      const mockTunnelInfo = {
        url: 'https://test-uuid.test.debugg.ai',
        port: 3000,
        subdomain: 'test-uuid',
        uuid: 'test-uuid'
      };

      const mockTestResult = {
        success: true,
        suiteUuid: 'test-suite-uuid',
        testFiles: ['test1.spec.js', 'test2.spec.js']
      };

      mockServerManager.startServer.mockResolvedValue(true);
      mockServerManager.getServerUrl.mockReturnValue('http://localhost:3000');
      mockServerManager.waitForServer.mockResolvedValue(true);
      mockTunnelManager.createTunnel.mockResolvedValue(mockTunnelInfo);
      mockTestManager.runCommitTests.mockResolvedValue(mockTestResult);

      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      const result = await orchestrator.executeWorkflow(mockWorkflowConfig);

      expect(result.success).toBe(true);
      expect(result.testResult).toEqual(mockTestResult);
      expect(result.tunnelInfo).toEqual(mockTunnelInfo);
      expect(result.serverUrl).toBe('http://localhost:3000');

      expect(mockServerManager.startServer).toHaveBeenCalledWith('main', mockWorkflowConfig.server);
      expect(mockTunnelManager.createTunnel).toHaveBeenCalledWith(mockWorkflowConfig.tunnel);
      expect(mockTestManager.runCommitTests).toHaveBeenCalled();
    });

    it('should handle server startup failure', async () => {
      mockServerManager.startServer.mockResolvedValue(false);

      const result = await orchestrator.executeWorkflow(mockWorkflowConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to start application server');
      expect(mockTunnelManager.createTunnel).not.toHaveBeenCalled();
    });

    it('should handle server readiness failure', async () => {
      mockServerManager.startServer.mockResolvedValue(true);
      mockServerManager.getServerUrl.mockReturnValue('http://localhost:3000');
      mockServerManager.waitForServer.mockResolvedValue(false);

      const result = await orchestrator.executeWorkflow(mockWorkflowConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Server failed to become ready');
      expect(mockTunnelManager.createTunnel).not.toHaveBeenCalled();
    });

    it('should handle tunnel creation failure', async () => {
      mockServerManager.startServer.mockResolvedValue(true);
      mockServerManager.getServerUrl.mockReturnValue('http://localhost:3000');
      mockServerManager.waitForServer.mockResolvedValue(true);
      mockTunnelManager.createTunnel.mockRejectedValue(new Error('Tunnel creation failed'));

      const result = await orchestrator.executeWorkflow(mockWorkflowConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tunnel creation failed');
      expect(mockTestManager.runCommitTests).not.toHaveBeenCalled();
    });

    it('should handle tunnel connectivity verification failure', async () => {
      const mockTunnelInfo = {
        url: 'https://test-uuid.test.debugg.ai',
        port: 3000,
        subdomain: 'test-uuid',
        uuid: 'test-uuid'
      };

      mockServerManager.startServer.mockResolvedValue(true);
      mockServerManager.getServerUrl.mockReturnValue('http://localhost:3000');
      mockServerManager.waitForServer.mockResolvedValue(true);
      mockTunnelManager.createTunnel.mockResolvedValue(mockTunnelInfo);

      global.fetch = jest.fn().mockRejectedValue(new Error('Connectivity failed'));

      const result = await orchestrator.executeWorkflow(mockWorkflowConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tunnel connectivity verification failed');
    });

    it('should handle test execution failure', async () => {
      const mockTunnelInfo = {
        url: 'https://test-uuid.test.debugg.ai',
        port: 3000,
        subdomain: 'test-uuid',
        uuid: 'test-uuid'
      };

      mockServerManager.startServer.mockResolvedValue(true);
      mockServerManager.getServerUrl.mockReturnValue('http://localhost:3000');
      mockServerManager.waitForServer.mockResolvedValue(true);
      mockTunnelManager.createTunnel.mockResolvedValue(mockTunnelInfo);
      mockTestManager.runCommitTests.mockRejectedValue(new Error('Test execution failed'));

      global.fetch = jest.fn().mockResolvedValue({ ok: true });

      const result = await orchestrator.executeWorkflow(mockWorkflowConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Test execution failed');
    });

    it('should handle cleanup configuration', async () => {
      const configWithCleanup = {
        ...mockWorkflowConfig,
        cleanup: {
          onSuccess: false,
          onError: true
        }
      };

      mockServerManager.startServer.mockResolvedValue(false);

      const result = await orchestrator.executeWorkflow(configWithCleanup);

      expect(result.success).toBe(false);
      // Server never started, so stopAllServers should not be called
      expect(mockServerManager.stopAllServers).not.toHaveBeenCalled();
      // But tunnels should be cleaned up (even if none were created)
      expect(mockTunnelManager.disconnectAll).toHaveBeenCalled();
    });
  });

  describe('startServer', () => {
    it('should start server successfully', async () => {
      const config = {
        command: 'npm',
        args: ['start'],
        port: 3000
      };

      mockServerManager.startServer.mockResolvedValue(true);
      mockServerManager.getServerUrl.mockReturnValue('http://localhost:3000');

      const result = await orchestrator.startServer(config);

      expect(result.success).toBe(true);
      expect(result.url).toBe('http://localhost:3000');
      expect(mockServerManager.startServer).toHaveBeenCalledWith('main', config);
    });

    it('should handle server start failure', async () => {
      const config = {
        command: 'npm',
        args: ['start'],
        port: 3000
      };

      mockServerManager.startServer.mockRejectedValue(new Error('Start failed'));

      const result = await orchestrator.startServer(config);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Start failed');
    });
  });

  describe('createTunnel', () => {
    it('should create tunnel successfully', async () => {
      const config = {
        port: 3000,
        authtoken: 'test-token'
      };

      const mockTunnelInfo = {
        url: 'https://test-uuid.test.debugg.ai',
        port: 3000,
        subdomain: 'test-uuid',
        uuid: 'test-uuid'
      };

      mockTunnelManager.createTunnel.mockResolvedValue(mockTunnelInfo);

      const result = await orchestrator.createTunnel(config);

      expect(result.success).toBe(true);
      expect(result.tunnelInfo).toEqual(mockTunnelInfo);
      expect(mockTunnelManager.createTunnel).toHaveBeenCalledWith(config);
    });

    it('should handle tunnel creation failure', async () => {
      const config = {
        port: 3000,
        authtoken: 'test-token'
      };

      mockTunnelManager.createTunnel.mockRejectedValue(new Error('Creation failed'));

      const result = await orchestrator.createTunnel(config);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Creation failed');
    });
  });

  describe('runTests', () => {
    it('should run tests successfully', async () => {
      const testConfig = {
        apiKey: 'test-api-key',
        repoPath: '/test/repo'
      };

      const mockTestResult = {
        success: true,
        suiteUuid: 'test-suite-uuid'
      };

      mockTestManager.runCommitTests.mockResolvedValue(mockTestResult);

      const result = await orchestrator.runTests('https://test.example.com', testConfig);

      expect(result.success).toBe(true);
      expect(result.result).toEqual(mockTestResult);
    });

    it('should handle test execution failure', async () => {
      const testConfig = {
        apiKey: 'test-api-key',
        repoPath: '/test/repo'
      };

      mockTestManager.runCommitTests.mockRejectedValue(new Error('Test failed'));

      const result = await orchestrator.runTests('https://test.example.com', testConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Test failed');
    });
  });

  describe('cleanup', () => {
    it('should cleanup tunnel and servers', async () => {
      mockTunnelManager.disconnectTunnel.mockResolvedValue();
      mockServerManager.stopAllServers.mockResolvedValue();

      await orchestrator.cleanup('test-uuid', true);

      expect(mockTunnelManager.disconnectTunnel).toHaveBeenCalledWith('test-uuid');
      expect(mockServerManager.stopAllServers).toHaveBeenCalled();
    });

    it('should cleanup all tunnels when no UUID provided', async () => {
      mockTunnelManager.disconnectAll.mockResolvedValue();
      mockServerManager.stopAllServers.mockResolvedValue();

      await orchestrator.cleanup(undefined, true);

      expect(mockTunnelManager.disconnectAll).toHaveBeenCalled();
      expect(mockServerManager.stopAllServers).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      mockTunnelManager.disconnectTunnel.mockRejectedValue(new Error('Disconnect failed'));
      mockServerManager.stopAllServers.mockRejectedValue(new Error('Stop failed'));

      await orchestrator.cleanup('test-uuid', true);

      expect(mockTunnelManager.disconnectTunnel).toHaveBeenCalledWith('test-uuid');
      expect(mockServerManager.stopAllServers).toHaveBeenCalled();
    });

    it('should skip server cleanup when serverStarted is false', async () => {
      mockTunnelManager.disconnectTunnel.mockResolvedValue();

      await orchestrator.cleanup('test-uuid', false);

      expect(mockTunnelManager.disconnectTunnel).toHaveBeenCalledWith('test-uuid');
      expect(mockServerManager.stopAllServers).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('should return status of servers and tunnels', async () => {
      const mockServerStatus = { 'main': { running: true, port: 3000 } };
      const mockTunnelInfo = [{
        url: 'https://test-uuid.test.debugg.ai',
        port: 3000,
        subdomain: 'test-uuid',
        uuid: 'test-uuid'
      }];

      mockServerManager.getAllServerStatus.mockReturnValue(mockServerStatus);
      mockTunnelManager.getAllTunnels.mockReturnValue(mockTunnelInfo);

      const status = await orchestrator.getStatus();

      expect(status.servers).toEqual(mockServerStatus);
      expect(status.tunnels).toEqual(mockTunnelInfo);
    });
  });

  describe('healthCheck', () => {
    it('should return health status', async () => {
      mockServerManager.getAllServerStatus.mockReturnValue({ 'main': { running: true } });
      mockTunnelManager.getAllTunnels.mockReturnValue([{ url: 'test', port: 3000, subdomain: 'test', uuid: 'test' }]);

      const health = await orchestrator.healthCheck();

      expect(health).toEqual({
        tunnelManager: true,
        serverManager: true,
        activeServers: 1,
        activeTunnels: 1
      });
    });
  });
});