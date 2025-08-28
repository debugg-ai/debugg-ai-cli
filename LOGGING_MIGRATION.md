# Logging System Migration Guide

This document provides a complete migration guide from the existing logging chaos to the new system-wide logging architecture.

## Quick Start

Replace this import:
```typescript
import { log } from '../util/logging';
```

With:
```typescript
import { systemLogger } from '../util/system-logger';
```

## Migration Examples

### 1. Console.* and Direct Output

**Before:**
```typescript
console.log('Creating test suite...');
console.error('Failed to connect');
console.warn('Server not ready');
```

**After:**
```typescript
systemLogger.info('Creating test suite...');
systemLogger.error('Failed to connect');  
systemLogger.warn('Server not ready');
```

### 2. Spinner Management

**Before:**
```typescript
const spinner = ora('Processing...').start();
spinner.text = 'Still processing...';
spinner.succeed('Done!');
spinner.fail('Failed!');
```

**After:**
```typescript
systemLogger.progress.start('Processing...');
systemLogger.progress.update('Still processing...');
systemLogger.progress.succeed('Done!');
systemLogger.progress.fail('Failed!');
```

### 3. Existing Log Utility

**Before:**
```typescript
log.info('API request sent', { url: '/test-suite' });
log.error('Git analysis failed', { error: 'Not a repo' });
log.success('Tests completed');
log.debug('Debug info', { data: complexObject });
```

**After:**
```typescript
systemLogger.info('API request sent', { category: 'api', details: { url: '/test-suite' } });
systemLogger.error('Git analysis failed', { category: 'git', details: { error: 'Not a repo' } });
systemLogger.success('Tests completed');
systemLogger.debug('Debug info', { details: { data: complexObject } });
```

### 4. Category-Specific Logging

#### Tunnel Operations
**Before:**
```typescript
console.log(`🌐 Creating ngrok tunnel for localhost:${port}`);
log.success(`✅ Ngrok tunnel established in ${time}ms`);
log.error(`❌ Ngrok connection failed`, { error });
```

**After:**
```typescript
systemLogger.tunnel.connecting(`localhost:${port}`, { port });
systemLogger.tunnel.connected(url, timing);
systemLogger.tunnel.failed(`localhost:${port}`, error, timing);
```

#### API Operations
**Before:**
```typescript
log.info(`API ${method.toUpperCase()} ${url}`, { method, url });
log.info('API response', { status: response.status });
log.error('API error', { error: error.message });
```

**After:**
```typescript
systemLogger.api.request(method, url);
systemLogger.api.response(response.status, url, timing);
systemLogger.api.error(method, url, error.message);
```

#### Git Operations  
**Before:**
```typescript
log.info('Analyzing git changes...');
log.info(`Found ${changes.length} changed files`);
gitLog.commitSummary(hash, fileCount, message);
```

**After:**
```typescript
systemLogger.git.analyzing('working', 'current changes');
systemLogger.git.found(changes.length, 'working');
systemLogger.git.commit(hash, message, fileCount);
```

#### Test Operations
**Before:**
```typescript
console.log('Creating test suite...');
spinner.text = `Test suite created: ${suiteId}`;
spinner.text = `Running tests... (${completed}/${total} completed)`;
```

**After:**
```typescript
systemLogger.test.creating();
systemLogger.test.created(suiteId);
systemLogger.test.running(completed, total);
```

### 5. Complex Scenarios

#### Tunnel Manager Migration
**Before:**
```typescript
log.info(`🌐 Creating ngrok tunnel for localhost:${config.port}`);
log.debug('Ngrok tunnel configuration', {
  uuid: tunnelUuid,
  subdomain,
  targetDomain: customDomain,
  port: config.port,
  hasAuthToken: !!authToken
});

const connectionTime = Date.now() - startTime;
log.success(`✅ Ngrok tunnel established in ${connectionTime}ms`);
log.info(`🌍 Public URL: ${url} -> localhost:${config.port}`);
```

**After:**
```typescript
systemLogger.tunnel.connecting(`localhost:${config.port}`, {
  port: config.port,
  uuid: tunnelUuid,
  details: { subdomain, targetDomain: customDomain, hasAuthToken: !!authToken }
});

const connectionTime = Date.now() - startTime;
systemLogger.tunnel.connected(url, connectionTime, {
  port: config.port,
  uuid: tunnelUuid
});
```

#### Test Manager Migration
**Before:**
```typescript
this.spinner = ora('Initializing DebuggAI test run...').start();
this.spinner.text = 'Validating API key...';
this.spinner.text = `Authenticated as user: ${authTest.user?.email}`;
this.spinner.text = 'Analyzing git changes...';
this.spinner.text = `Found ${changes.changes.length} changed files`;
this.spinner.succeed(`Tests completed successfully! Generated ${testFiles.length} test files`);
```

**After:**
```typescript
systemLogger.progress.start('Initializing DebuggAI test run...');
systemLogger.progress.update('Validating API key...');
systemLogger.api.auth(true, authTest.user?.email);
systemLogger.git.analyzing('working', 'current changes');
systemLogger.git.found(changes.changes.length, 'working');
systemLogger.test.completed(testFiles.length);
```

## Development vs User Mode

### Dev Mode (--dev, --verbose, or NODE_ENV=development)
- Sequential timestamped output
- Full technical details logged
- All debug messages visible
- No spinners, just clean text output
- Perfect for debugging tunnel issues, API calls, git operations

**Example Output:**
```
[2024-08-28T10:30:15.123Z] INFO [TUNNEL] Connecting to localhost:3000 {"port":3000,"uuid":"abc123"}
[2024-08-28T10:30:16.456Z] SUCCESS [TUNNEL] Tunnel established: https://abc123.ngrok.debugg.ai {"timing":"1333ms","status":"connected"}
[2024-08-28T10:30:16.789Z] INFO [API] POST /test-suite {"method":"POST","url":"/test-suite"}
[2024-08-28T10:30:17.012Z] INFO [GIT] Analyzing working changes: current changes {"changeType":"working","target":"current changes"}
```

### User Mode (Default)
- Clean spinner interface
- Minimal user-friendly messages
- Progress indicators
- Hides technical details
- Shows only results and important status

**Example Output:**
```
✅ Authenticated as: user@example.com
⏳ Creating tunnel to localhost:3000...
✅ Tunnel connected: https://abc123.ngrok.debugg.ai
⏳ Analyzing git changes...
⏳ Found 3 changed files (working)
⏳ Creating test suite...
✅ Tests completed! Generated 2 test files
```

## File-by-File Migration

### src/cli.ts
Replace all `console.log`, `console.error`, and `ora()` usage:

```typescript
// Old
console.log(chalk.blue.bold('DebuggAI Test Runner'));
console.log(chalk.gray('Repository: ${repoPath}'));
console.error(chalk.red('Error: API key is required'));

// New  
systemLogger.info('DebuggAI Test Runner');
systemLogger.info(`Repository: ${repoPath}`);
systemLogger.error('Error: API key is required');
```

### src/lib/tunnel-manager.ts
Replace all `log.*` calls:

```typescript
// Old
log.info(`🌐 Creating ngrok tunnel for localhost:${config.port}`);
log.success(`✅ Ngrok tunnel established in ${connectionTime}ms`);
log.error(`❌ Ngrok connection failed after ${failureTime}ms`, {...});

// New
systemLogger.tunnel.connecting(`localhost:${config.port}`, { port: config.port });
systemLogger.tunnel.connected(url, connectionTime);  
systemLogger.tunnel.failed(`localhost:${config.port}`, error.message, failureTime);
```

### src/lib/test-manager.ts
Replace spinner and log management:

```typescript
// Old
this.spinner = ora('Initializing DebuggAI test run...').start();
this.spinner.text = 'Analyzing git changes...';
this.spinner.succeed('Tests completed successfully!');

// New
systemLogger.progress.start('Initializing DebuggAI test run...');
systemLogger.git.analyzing('working', 'current changes');
systemLogger.test.completed(testFiles.length);
```

### src/backend/cli/client.ts and other backend files
Replace API logging:

```typescript
// Old  
log.api.request(method, url);
log.api.response(response);
log.api.error(error, context);

// New
systemLogger.api.request(method, url);
systemLogger.api.response(response.status, url, timing);
systemLogger.api.error(method, url, error.message);
```

## Environment Variables

The system logger automatically detects dev mode from:

- CLI flags: `--dev`, `--verbose`, `-v`
- Environment: `NODE_ENV=development`
- Logging level: `DEBUGGAI_LOG_LEVEL=DEBUG`
- Debug flag: `DEBUG=true`
- npm scripts: any script with 'dev' in the name

## Advanced Features

### Context-Aware Truncation
```typescript
systemLogger.api.request('POST', veryLongUrl, {
  details: { largeObject },
  truncate: 50  // Limit details to 50 chars
});
```

### Custom Categories
```typescript
systemLogger.debug('Custom operation', {
  category: 'custom',
  details: { customData }
});
```

### Programmatic Mode Control
```typescript
import { systemLogger } from './util/system-logger';

// Force dev mode for debugging
systemLogger.setDevMode(true);

// Check current mode
if (systemLogger.getDevMode()) {
  // Dev mode specific logic
}
```

## Benefits of New System

1. **Clean Separation**: Dev mode for debugging, User mode for production
2. **Consistent Interface**: Same API across all components  
3. **Smart Truncation**: Prevents log pollution from large objects
4. **Category-Specific**: Specialized logging for tunnels, APIs, git, tests
5. **Environment Aware**: Automatically detects appropriate mode
6. **TypeScript First**: Full type safety for all log functions
7. **CI/CD Friendly**: Handles non-TTY environments gracefully

## Testing the Migration

Run with dev mode to see detailed output:
```bash
npm run dev --verbose
# or
NODE_ENV=development npm start
# or  
debugg-ai test --dev
```

Run normally for clean user interface:
```bash
debugg-ai test
```