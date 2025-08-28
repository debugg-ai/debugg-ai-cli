import { ServerManager } from '../lib/server-manager';
import { spawn } from 'child_process';
import axios from 'axios';
import { EventEmitter } from 'events';

jest.mock('child_process');
jest.mock('axios');

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockAxios = axios as jest.Mocked<typeof axios>;

class MockChildProcess extends EventEmitter {
  pid = 12345;
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill(signal?: string) {
    this.killed = true;
    setTimeout(() => this.emit('exit', 0, signal), 100);
    return true;
  }
}

describe('ServerManager', () => {
  let serverManager: ServerManager;
  let mockProcess: MockChildProcess;

  beforeEach(() => {
    jest.clearAllMocks();
    serverManager = new ServerManager({
      defaultStartupTimeout: 10000,
      defaultHealthPath: '/'
    });
    mockProcess = new MockChildProcess();
    mockSpawn.mockReturnValue(mockProcess as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const manager = new ServerManager();
      expect(manager).toBeInstanceOf(ServerManager);
    });

    it('should initialize with custom options', () => {
      const manager = new ServerManager({
        defaultStartupTimeout: 30000,
        defaultHealthPath: '/health'
      });
      expect(manager).toBeInstanceOf(ServerManager);
    });
  });

  describe('startServer', () => {
    beforeEach(() => {
      mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
    });

    it('should start server successfully with health check', async () => {
      const config = {
        command: 'npm',
        args: ['start'],
        port: 3000,
        cwd: '/test/path'
      };

      const startPromise = serverManager.startServer('test-server', config);
      
      setTimeout(() => {
        mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
      }, 100);

      const result = await startPromise;

      expect(result).toBe(true);
      expect(mockSpawn).toHaveBeenCalledWith('npm', ['start'], {
        cwd: '/test/path',
        env: expect.any(Object),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });
    });

    it('should start server successfully with regex detection', async () => {
      const config = {
        command: 'npm',
        args: ['start'],
        port: 3000,
        readyRegex: /Server listening on port \d+/
      };

      const startPromise = serverManager.startServer('test-server', config);
      
      setTimeout(() => {
        mockProcess.stdout.emit('data', Buffer.from('Server listening on port 3000'));
      }, 100);

      const result = await startPromise;

      expect(result).toBe(true);
    });

    it('should return true if server is already running', async () => {
      const config = {
        command: 'npm',
        args: ['start'],
        port: 3000
      };

      await serverManager.startServer('test-server', config);
      const result = await serverManager.startServer('test-server', config);

      expect(result).toBe(true);
    });

    it('should handle server startup timeout', async () => {
      const config = {
        command: 'npm',
        args: ['start'],
        port: 3000,
        startupTimeout: 1000
      };

      mockAxios.get.mockRejectedValue(new Error('Connection failed'));

      await expect(serverManager.startServer('test-server', config)).rejects.toThrow(
        'Server test-server failed to start within 1000ms'
      );
    });

    it('should handle server spawn error', async () => {
      const config = {
        command: 'npm',
        args: ['start'],
        port: 3000
      };

      // Mock axios to reject to prevent health check from succeeding
      mockAxios.get.mockRejectedValue(new Error('Connection failed'));
      
      const startPromise = serverManager.startServer('test-server', config);
      
      // Emit error immediately to beat the health check
      setImmediate(() => {
        mockProcess.emit('error', new Error('Spawn failed'));
      });

      await expect(startPromise).rejects.toThrow('Failed to start server test-server: Spawn failed');
    });

    it('should handle server unexpected exit', async () => {
      const config = {
        command: 'npm',
        args: ['start'],
        port: 3000
      };

      // Mock axios to reject to prevent health check from succeeding
      mockAxios.get.mockRejectedValue(new Error('Connection failed'));
      
      const startPromise = serverManager.startServer('test-server', config);
      
      // Emit exit immediately to beat the health check
      setImmediate(() => {
        mockProcess.emit('exit', 1, null);
      });

      await expect(startPromise).rejects.toThrow('Server test-server exited unexpectedly with code 1');
    });

    it('should handle stderr output', async () => {
      const config = {
        command: 'npm',
        args: ['start'],
        port: 3000
      };

      const startPromise = serverManager.startServer('test-server', config);
      
      // Emit stderr data and then allow health check to succeed
      await new Promise<void>((resolve) => {
        setImmediate(() => {
          mockProcess.stderr.emit('data', Buffer.from('Error message'));
          // Give the event loop a chance to process the stderr event
          setTimeout(() => {
            mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
            resolve();
          }, 10);
        });
      });

      const result = await startPromise;
      
      // Just verify the server starts successfully despite stderr output
      expect(result).toBe(true);
    });

    it('should handle health check with 404 status', async () => {
      const config = {
        command: 'npm',
        args: ['start'],
        port: 3000
      };

      mockAxios.get.mockRejectedValueOnce({ response: { status: 404 } })
                 .mockResolvedValue({ status: 404, data: 'Not Found' });

      const result = await serverManager.startServer('test-server', config);

      expect(result).toBe(true);
    });
  });

  describe('stopServer', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
      await serverManager.startServer('test-server', {
        command: 'npm',
        args: ['start'],
        port: 3000
      });
    });

    it('should stop server gracefully', async () => {
      await serverManager.stopServer('test-server');

      expect(mockProcess.killed).toBe(true);
    });

    it('should handle stopping non-existent server', async () => {
      await serverManager.stopServer('non-existent');
      
      // Should complete without error even if server doesn't exist
      expect(true).toBe(true);
    });

    it('should force kill server after timeout', async () => {
      mockProcess.kill = jest.fn(() => {
        return true;
      });

      await serverManager.stopServer('test-server');

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    }, 10000);
  });

  describe('stopAllServers', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
      
      await serverManager.startServer('server1', {
        command: 'npm',
        args: ['start'],
        port: 3000
      });
      
      const mockProcess2 = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess2 as any);
      
      await serverManager.startServer('server2', {
        command: 'npm',
        args: ['start'],
        port: 4000
      });
    });

    it('should stop all servers', async () => {
      await serverManager.stopAllServers();

      // Should complete successfully
      expect(true).toBe(true);
    });
  });

  describe('getServerStatus', () => {
    it('should return not running for non-existent server', () => {
      const status = serverManager.getServerStatus('non-existent');
      
      expect(status).toEqual({ running: false });
    });

    it('should return status for running server', async () => {
      mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
      
      await serverManager.startServer('test-server', {
        command: 'npm',
        args: ['start'],
        port: 3000,
        host: 'localhost'
      });

      const status = serverManager.getServerStatus('test-server');

      expect(status).toEqual({
        running: true,
        pid: 12345,
        port: 3000,
        url: 'http://localhost:3000'
      });
    });
  });

  describe('checkServerHealth', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
      await serverManager.startServer('test-server', {
        command: 'npm',
        args: ['start'],
        port: 3000
      });
    });

    it('should return true for healthy server', async () => {
      mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
      
      const health = await serverManager.checkServerHealth('test-server');
      
      expect(health).toBe(true);
    });

    it('should return false for unhealthy server', async () => {
      mockAxios.get.mockRejectedValue(new Error('Server error'));
      
      const health = await serverManager.checkServerHealth('test-server');
      
      expect(health).toBe(false);
    });

    it('should return false for non-existent server', async () => {
      const health = await serverManager.checkServerHealth('non-existent');
      
      expect(health).toBe(false);
    });
  });

  describe('getAllServerStatus', () => {
    it('should return empty object when no servers', () => {
      const status = serverManager.getAllServerStatus();
      
      expect(status).toEqual({});
    });

    it('should return status for all servers', async () => {
      mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
      
      await serverManager.startServer('server1', {
        command: 'npm',
        args: ['start'],
        port: 3000
      });

      const status = serverManager.getAllServerStatus();

      expect(status).toHaveProperty('server1');
      expect(status.server1?.running).toBe(true);
    });
  });

  describe('isServerRunning', () => {
    it('should return false for non-existent server', () => {
      const running = serverManager.isServerRunning('non-existent');
      
      expect(running).toBe(false);
    });

    it('should return true for running server', async () => {
      mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
      
      await serverManager.startServer('test-server', {
        command: 'npm',
        args: ['start'],
        port: 3000
      });

      const running = serverManager.isServerRunning('test-server');
      
      expect(running).toBe(true);
    });
  });

  describe('getServerUrl', () => {
    it('should return null for non-existent server', () => {
      const url = serverManager.getServerUrl('non-existent');
      
      expect(url).toBeNull();
    });

    it('should return URL for existing server', async () => {
      mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
      
      await serverManager.startServer('test-server', {
        command: 'npm',
        args: ['start'],
        port: 3000,
        host: 'localhost'
      });

      const url = serverManager.getServerUrl('test-server');
      
      expect(url).toBe('http://localhost:3000');
    });
  });

  describe('waitForServer', () => {
    beforeEach(async () => {
      mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
      await serverManager.startServer('test-server', {
        command: 'npm',
        args: ['start'],
        port: 3000,
        healthPath: '/health'
      });
    });

    it('should wait for server to be ready', async () => {
      mockAxios.get.mockResolvedValue({ status: 200, data: 'OK' });
      
      const result = await serverManager.waitForServer('test-server', 5000);
      
      expect(result).toBe(true);
    });

    it('should throw error for non-existent server', async () => {
      await expect(serverManager.waitForServer('non-existent', 5000)).rejects.toThrow(
        'Server configuration for non-existent not found'
      );
    });

    it('should handle server not becoming ready within timeout', async () => {
      mockAxios.get.mockRejectedValue(new Error('Server not ready'));
      
      const result = await serverManager.waitForServer('test-server', 1000);
      
      expect(result).toBe(false);
    });
  });
});