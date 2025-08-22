// fs-extra mock utilities for testing file operations

export const mockFsExtra = {
  pathExists: jest.fn(),
  ensureDir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  copy: jest.fn(),
  remove: jest.fn(),
  mkdir: jest.fn(),
  stat: jest.fn(),
  readdir: jest.fn(),
  createReadStream: jest.fn(),
  createWriteStream: jest.fn()
};

export const setupMockFileSystem = (mockFiles: Record<string, string | boolean> = {}) => {
  // Mock fs-extra methods using jest.mocked
  const pathExists = jest.mocked(require('fs-extra').pathExists);
  const readFile = jest.mocked(require('fs-extra').readFile);
  const ensureDir = jest.mocked(require('fs-extra').ensureDir);
  const writeFile = jest.mocked(require('fs-extra').writeFile);

  pathExists.mockImplementation((path: string) => {
    const pathStr = String(path);
    if (pathStr in mockFiles) {
      return Promise.resolve(Boolean(mockFiles[pathStr]));
    }
    // Default behavior for common paths
    if (pathStr.includes('.git')) return Promise.resolve(true);
    if (pathStr.includes('node_modules')) return Promise.resolve(true);
    return Promise.resolve(false);
  });

  readFile.mockImplementation((path: string, encoding?: string) => {
    const pathStr = String(path);
    if (pathStr in mockFiles && typeof mockFiles[pathStr] === 'string') {
      return Promise.resolve(mockFiles[pathStr]);
    }
    return Promise.reject(new Error(`ENOENT: no such file or directory, open '${path}'`));
  });

  ensureDir.mockResolvedValue(undefined);
  writeFile.mockResolvedValue(undefined);
};