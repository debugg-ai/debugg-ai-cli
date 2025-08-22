# @debugg-ai/cli

CLI tool for running DebuggAI tests in CI/CD environments like GitHub Actions.

## Installation

```bash
npm install -g @debugg-ai/cli
```

Or use with npx:

```bash
npx @debugg-ai/cli test --api-key YOUR_API_KEY
```

## Usage

### Basic Test Run

```bash
debugg-ai test --api-key YOUR_API_KEY
```

### Environment Variables

Set your API key as an environment variable:

```bash
export DEBUGGAI_API_KEY=your_api_key_here
debugg-ai test
```

### GitHub Actions Example

```yaml
name: DebuggAI Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm install
        
      - name: Start development server
        run: npm run dev &
        
      - name: Run DebuggAI Tests
        env:
          DEBUGGAI_API_KEY: ${{ secrets.DEBUGGAI_API_KEY }}
        run: |
          npx @debugg-ai/cli test --wait-for-server
```

## Commands

### `test`

Run E2E tests based on git changes.

**Options:**
- `-k, --api-key <key>` - DebuggAI API key (or use DEBUGGAI_API_KEY env var)
- `-u, --base-url <url>` - API base URL (default: https://api.debugg.ai)
- `-r, --repo-path <path>` - Repository path (default: current directory)
- `-o, --output-dir <dir>` - Test output directory (default: tests/debugg-ai)
- `--wait-for-server` - Wait for local development server to be ready
- `--server-port <port>` - Local server port to wait for (default: 3000)
- `--server-timeout <ms>` - Server wait timeout in milliseconds (default: 60000)
- `--max-test-time <ms>` - Maximum test wait time in milliseconds (default: 600000)
- `--no-color` - Disable colored output

**Examples:**

```bash
# Basic usage
debugg-ai test --api-key YOUR_API_KEY

# Wait for development server on port 3000
debugg-ai test --wait-for-server

# Custom server port and output directory  
debugg-ai test --wait-for-server --server-port 8080 --output-dir custom-tests

# Specify repository path
debugg-ai test --repo-path /path/to/your/repo
```

### `status`

Check the status of a test suite.

**Options:**
- `-s, --suite-id <id>` - Test suite UUID (required)
- `-k, --api-key <key>` - DebuggAI API key
- `-u, --base-url <url>` - API base URL
- `--no-color` - Disable colored output

**Example:**

```bash
debugg-ai status --suite-id abc123-def456-ghi789
```

### `list`

List test suites for a repository.

**Options:**
- `-k, --api-key <key>` - DebuggAI API key
- `-u, --base-url <url>` - API base URL
- `-r, --repo <name>` - Repository name filter
- `-b, --branch <name>` - Branch name filter
- `-l, --limit <number>` - Limit number of results (default: 20)
- `-p, --page <number>` - Page number (default: 1)
- `--no-color` - Disable colored output

**Example:**

```bash
# List all test suites
debugg-ai list

# Filter by repository and branch
debugg-ai list --repo my-app --branch main

# Paginate results
debugg-ai list --limit 10 --page 2
```

## How It Works

1. **Git Analysis**: The CLI analyzes your git changes (commit diff or working changes)
2. **Test Generation**: Sends the changes to DebuggAI API to generate appropriate E2E tests
3. **Test Execution**: Waits for tests to complete and downloads results
4. **Artifact Storage**: Saves test files, recordings, and reports to your local directory

## Output

The CLI generates several types of output:

- **Test Scripts**: Playwright test files (`.spec.js`)
- **Recordings**: GIF recordings of test execution (`.gif`)
- **Test Details**: JSON files with detailed test results (`.json`)

All outputs are saved to the configured output directory (default: `tests/debugg-ai/`).

## Exit Codes

- `0` - Success
- `1` - Error (API failure, authentication, etc.)

## Environment Variables

- `DEBUGGAI_API_KEY` - Your DebuggAI API key
- `DEBUGGAI_BASE_URL` - Custom API base URL
- `GITHUB_SHA` - Git commit hash (automatically detected in GitHub Actions)
- `GITHUB_REF_NAME` - Git branch name (automatically detected in GitHub Actions)
- `GITHUB_HEAD_REF` - Git branch name for pull requests (automatically detected in GitHub Actions)

## Programmatic Usage

You can also use this package programmatically:

```typescript
import { runDebuggAITests } from '@debugg-ai/cli';

const result = await runDebuggAITests({
  apiKey: 'your-api-key',
  repoPath: '/path/to/repo',
  waitForServer: true,
  serverPort: 3000
});

if (result.success) {
  console.log(`Tests passed! Suite ID: ${result.suiteUuid}`);
  console.log(`Generated files:`, result.testFiles);
} else {
  console.error(`Tests failed: ${result.error}`);
}
```

## Troubleshooting

### Authentication Issues

Make sure your API key is valid and has the necessary permissions:

```bash
debugg-ai test --api-key YOUR_API_KEY
# Look for "Authenticated as user: ..." message
```

### Server Not Starting

If using `--wait-for-server`, ensure your development server is configured to start on the expected port:

```bash
# Check if server is running
curl http://localhost:3000

# Use custom port if needed
debugg-ai test --wait-for-server --server-port 8080
```

### No Changes Detected

The CLI analyzes git changes. Make sure you have:
- Uncommitted changes (working directory), or
- Recent commits to analyze

### Debug Mode

Enable debug output:

```bash
DEBUG=1 debugg-ai test --api-key YOUR_API_KEY
```

## Contributing

## License

MIT