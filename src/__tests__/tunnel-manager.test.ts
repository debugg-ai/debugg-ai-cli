import { TunnelManager } from '../lib/tunnel-manager';
import ngrok from 'ngrok';

jest.mock('ngrok');
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234')
}));

const mockNgrok = ngrok as jest.Mocked<typeof ngrok>;

import { v4 as uuidv4 } from 'uuid';
const mockUuid = uuidv4 as jest.MockedFunction<() => string>;

describe('TunnelManager', () => {
  let tunnelManager: TunnelManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUuid.mockReturnValue('test-uuid-1234');
    tunnelManager = new TunnelManager({
      authtoken: 'test-token',
      baseDomain: 'test.debugg.ai'
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const manager = new TunnelManager();
      expect(manager).toBeInstanceOf(TunnelManager);
    });

    it('should use environment variable for auth token', () => {
      process.env.NGROK_AUTH_TOKEN = 'env-token';
      const manager = new TunnelManager();
      expect(manager).toBeInstanceOf(TunnelManager);
      delete process.env.NGROK_AUTH_TOKEN;
    });
  });

  describe('createTunnel', () => {
    it('should create a tunnel successfully', async () => {
      const mockUrl = 'https://test-uuid-1234.test.debugg.ai';
      mockNgrok.connect.mockResolvedValue(mockUrl);

      const config = {
        port: 3000,
        authtoken: 'custom-token'
      };

      const result = await tunnelManager.createTunnel(config);

      expect(mockNgrok.connect).toHaveBeenCalledWith({
        proto: 'http',
        addr: 3000,
        hostname: 'test-uuid-1234.test.debugg.ai',
        authtoken: 'custom-token'
      });

      expect(result).toEqual({
        url: mockUrl,
        port: 3000,
        subdomain: 'test-uuid-1234',
        uuid: 'test-uuid-1234'
      });
    });

    it('should use custom subdomain when provided', async () => {
      const mockUrl = 'https://custom-subdomain.test.debugg.ai';
      mockNgrok.connect.mockResolvedValue(mockUrl);

      const config = {
        port: 3000,
        subdomain: 'custom-subdomain'
      };

      const result = await tunnelManager.createTunnel(config);

      expect(mockNgrok.connect).toHaveBeenCalledWith({
        proto: 'http',
        addr: 3000,
        hostname: 'custom-subdomain.test.debugg.ai',
        authtoken: 'test-token'
      });

      expect(result.subdomain).toBe('custom-subdomain');
    });

    it('should use custom domain when provided', async () => {
      const mockUrl = 'https://example.com';
      mockNgrok.connect.mockResolvedValue(mockUrl);

      const config = {
        port: 3000,
        customDomain: 'example.com'
      };

      const result = await tunnelManager.createTunnel(config);

      expect(mockNgrok.connect).toHaveBeenCalledWith({
        proto: 'http',
        addr: 3000,
        hostname: 'example.com',
        authtoken: 'test-token'
      });
    });

    it('should throw error when no auth token is provided', async () => {
      const manager = new TunnelManager();
      
      const config = { port: 3000 };

      await expect(manager.createTunnel(config)).rejects.toThrow(
        'Ngrok auth token or tunnelKey is required'
      );
    });

    it('should handle ngrok connection errors', async () => {
      mockNgrok.connect.mockRejectedValue(new Error('Connection failed'));

      const config = { port: 3000 };

      await expect(tunnelManager.createTunnel(config)).rejects.toThrow(
        'Failed to create ngrok tunnel: Connection failed'
      );
    });
  });

  describe('disconnectTunnel', () => {
    beforeEach(async () => {
      const mockUrl = 'https://test-uuid-1234.test.debugg.ai';
      mockNgrok.connect.mockResolvedValue(mockUrl);
      
      await tunnelManager.createTunnel({ port: 3000 });
    });

    it('should disconnect tunnel successfully', async () => {
      mockNgrok.disconnect.mockResolvedValue();

      await tunnelManager.disconnectTunnel('test-uuid-1234');

      expect(mockNgrok.disconnect).toHaveBeenCalledWith('https://test-uuid-1234.test.debugg.ai');
    });

    it('should handle non-existent tunnel gracefully', async () => {
      console.warn = jest.fn();
      
      await tunnelManager.disconnectTunnel('non-existent');

      // Note: The warning is now logged via the logging utility, not console.warn directly
      expect(mockNgrok.disconnect).not.toHaveBeenCalled();
    });

    it('should handle disconnect errors', async () => {
      mockNgrok.disconnect.mockRejectedValue(new Error('Disconnect failed'));

      await expect(tunnelManager.disconnectTunnel('test-uuid-1234')).rejects.toThrow(
        'Failed to disconnect tunnel test-uuid-1234: Disconnect failed'
      );
    });
  });

  describe('disconnectAll', () => {
    beforeEach(async () => {
      const mockUrl1 = 'https://tunnel1.test.debugg.ai';
      const mockUrl2 = 'https://tunnel2.test.debugg.ai';
      
      mockNgrok.connect.mockResolvedValueOnce(mockUrl1).mockResolvedValueOnce(mockUrl2);
      mockUuid.mockReturnValueOnce('tunnel1-uuid').mockReturnValueOnce('tunnel2-uuid');
      
      await tunnelManager.createTunnel({ port: 3000 });
      await tunnelManager.createTunnel({ port: 4000 });
    });

    it('should disconnect all tunnels and kill ngrok', async () => {
      mockNgrok.disconnect.mockResolvedValue();
      mockNgrok.kill.mockResolvedValue();

      await tunnelManager.disconnectAll();

      expect(mockNgrok.disconnect).toHaveBeenCalledTimes(2);
      expect(mockNgrok.kill).toHaveBeenCalled();
    });

    it('should handle disconnect errors gracefully and still kill ngrok', async () => {
      console.warn = jest.fn();
      mockNgrok.disconnect.mockRejectedValue(new Error('Disconnect failed'));
      mockNgrok.kill.mockResolvedValue();

      await tunnelManager.disconnectAll();

      expect(console.warn).toHaveBeenCalledTimes(2);
      expect(mockNgrok.kill).toHaveBeenCalled();
    });
  });

  describe('getTunnelInfo', () => {
    it('should return tunnel info for existing tunnel', async () => {
      const mockUrl = 'https://test-uuid-1234.test.debugg.ai';
      mockNgrok.connect.mockResolvedValue(mockUrl);
      
      await tunnelManager.createTunnel({ port: 3000 });
      
      const info = tunnelManager.getTunnelInfo('test-uuid-1234');
      
      expect(info).toEqual({
        url: mockUrl,
        port: 3000,
        subdomain: 'test-uuid-1234',
        uuid: 'test-uuid-1234'
      });
    });

    it('should return undefined for non-existent tunnel', () => {
      const info = tunnelManager.getTunnelInfo('non-existent');
      expect(info).toBeUndefined();
    });
  });

  describe('getAllTunnels', () => {
    it('should return empty array when no tunnels exist', () => {
      const tunnels = tunnelManager.getAllTunnels();
      expect(tunnels).toEqual([]);
    });

    it('should return all active tunnels', async () => {
      const mockUrl1 = 'https://tunnel1.test.debugg.ai';
      const mockUrl2 = 'https://tunnel2.test.debugg.ai';
      
      mockNgrok.connect.mockResolvedValueOnce(mockUrl1).mockResolvedValueOnce(mockUrl2);
      mockUuid.mockReturnValueOnce('tunnel1-uuid').mockReturnValueOnce('tunnel2-uuid');
      
      await tunnelManager.createTunnel({ port: 3000 });
      await tunnelManager.createTunnel({ port: 4000 });

      const tunnels = tunnelManager.getAllTunnels();
      
      expect(tunnels).toHaveLength(2);
      expect(tunnels[0]?.port).toBe(3000);
      expect(tunnels[1]?.port).toBe(4000);
    });
  });

  describe('generateUUID', () => {
    it('should generate a UUID', () => {
      const uuid = tunnelManager.generateUUID();
      expect(uuid).toBe('test-uuid-1234');
    });
  });

  describe('isValidTunnelUrl', () => {
    it('should validate correct tunnel URL', () => {
      const isValid = tunnelManager.isValidTunnelUrl('https://test-uuid.test.debugg.ai');
      expect(isValid).toBe(true);
    });

    it('should reject non-HTTPS URLs', () => {
      const isValid = tunnelManager.isValidTunnelUrl('http://test-uuid.test.debugg.ai');
      expect(isValid).toBe(false);
    });

    it('should reject URLs with wrong domain', () => {
      const isValid = tunnelManager.isValidTunnelUrl('https://test-uuid.example.com');
      expect(isValid).toBe(false);
    });

    it('should handle invalid URLs', () => {
      const isValid = tunnelManager.isValidTunnelUrl('invalid-url');
      expect(isValid).toBe(false);
    });
  });

  describe('getTunnelStatus', () => {
    it('should return inactive status for non-existent tunnel', async () => {
      const status = await tunnelManager.getTunnelStatus('non-existent');
      expect(status).toEqual({ active: false });
    });

    it('should check tunnel health for existing tunnel', async () => {
      const mockUrl = 'https://test-uuid-1234.test.debugg.ai';
      mockNgrok.connect.mockResolvedValue(mockUrl);
      
      global.fetch = jest.fn().mockResolvedValue({
        ok: true
      });

      await tunnelManager.createTunnel({ port: 3000 });
      
      const status = await tunnelManager.getTunnelStatus('test-uuid-1234');
      
      expect(status).toEqual({
        active: true,
        url: mockUrl,
        port: 3000
      });
    });

    it('should handle tunnel health check failures', async () => {
      const mockUrl = 'https://test-uuid-1234.test.debugg.ai';
      mockNgrok.connect.mockResolvedValue(mockUrl);
      
      global.fetch = jest.fn().mockRejectedValue(new Error('Health check failed'));

      await tunnelManager.createTunnel({ port: 3000 });
      
      const status = await tunnelManager.getTunnelStatus('test-uuid-1234');
      
      expect(status).toEqual({
        active: false,
        url: mockUrl,
        port: 3000
      });
    });
  });
});