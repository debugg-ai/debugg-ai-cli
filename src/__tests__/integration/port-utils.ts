import * as net from 'net';

/**
 * Find an available port starting from a given port number
 */
export async function findAvailablePort(startPort: number = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        // Port is in use, try next one
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
    
    server.listen(startPort, () => {
      const port = (server.address() as net.AddressInfo)?.port;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

/**
 * Find multiple available ports
 */
export async function findAvailablePorts(count: number, startPort: number = 3000): Promise<number[]> {
  const ports: number[] = [];
  let currentPort = startPort;
  
  for (let i = 0; i < count; i++) {
    const availablePort = await findAvailablePort(currentPort);
    ports.push(availablePort);
    currentPort = availablePort + 1;
  }
  
  return ports;
}

/**
 * Wait for a port to be released
 */
export async function waitForPortRelease(port: number, maxAttempts: number = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await findAvailablePort(port);
      if (await isPortAvailable(port)) {
        return;
      }
    } catch (error) {
      // Port still in use, wait and retry
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Port ${port} is still in use after ${maxAttempts} attempts`);
}

/**
 * Check if a specific port is available
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.on('error', () => {
      resolve(false);
    });
    
    server.listen(port, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}