# @debugg-ai/cli

CLI tool for running DebuggAI tests in CI/CD environments.

## Installation

```bash
npm install -g @debugg-ai/cli
```

## Quick Start

```bash
# Set your API key
export DEBUGGAI_API_KEY=your_api_key_here

# Run tests on current git changes
debugg-ai test

# Test last 3 commits
debugg-ai test --last 3

# Test all commits in a PR individually
debugg-ai test --pr-sequence

# Wait for local development server
debugg-ai test --wait-for-server
```

## GitHub Actions

### Basic Setup
```yaml
- name: Run DebuggAI Tests
  env:
    DEBUGGAI_API_KEY: ${{ secrets.DEBUGGAI_API_KEY }}
  run: npx @debugg-ai/cli test
```

### PR Testing - GitHub App Integration
```yaml
# Test entire PR with GitHub App (single request, backend handles analysis)
- name: Test PR via GitHub App
  env:
    DEBUGGAI_API_KEY: ${{ secrets.DEBUGGAI_API_KEY }}
  run: npx @debugg-ai/cli test --pr ${{ github.event.pull_request.number }}
```

### PR Testing - Test Each Commit
```yaml
# Test each commit individually (multiple requests, CLI handles analysis)
- name: Test PR Commits Sequentially
  env:
    DEBUGGAI_API_KEY: ${{ secrets.DEBUGGAI_API_KEY }}
  run: npx @debugg-ai/cli test --pr-sequence
```

### Test Multiple Recent Commits
```yaml
- name: Test Last 5 Commits
  env:
    DEBUGGAI_API_KEY: ${{ secrets.DEBUGGAI_API_KEY }}
  run: npx @debugg-ai/cli test --last 5
```

## Commands

### `debugg-ai test`

Generate and run E2E tests from git changes.

**Authentication:**
- `--api-key, -k` - Your DebuggAI API key (or use DEBUGGAI_API_KEY env var)

**Git Analysis Options:**
- `--last <number>` - Analyze last N commits (e.g., `--last 5`)
- `--since <date>` - Analyze commits since date/time (e.g., "2024-01-01", "2 days ago")
- `--commit <hash>` - Test a specific commit
- `--range <range>` - Test a commit range (e.g., "main..feature-branch")

**PR Testing Options:**
- `--pr <number>` - PR number for GitHub App testing (requires GitHub App integration)
- `--pr-sequence` - Test each commit in a PR individually (sequential testing)
- `--base-branch <branch>` - Base branch for PR (auto-detected in GitHub Actions)
- `--head-branch <branch>` - Head branch for PR (auto-detected in GitHub Actions)

**Local Development:**
- `--wait-for-server` - Wait for local dev server to start
- `--server-port <port>` - Port to wait for (default: 3000)
- `--server-timeout <ms>` - Timeout for server (default: 120000)
- `--tunnel-uuid <uuid>` - Create ngrok tunnel with custom UUID
- `--tunnel-port <port>` - Port to tunnel (default: 3000)

**Output Options:**
- `--output-dir, -o` - Where to save test files (default: tests/debugg-ai)
- `--download-artifacts` - Download test artifacts (scripts, recordings, results)
- `--verbose, -v` - Enable verbose logging
- `--dev` - Enable development mode (shows all technical details)
- `--no-color` - Disable colored output

### `debugg-ai status`

Check test suite status.

```bash
debugg-ai status --suite-id abc123-def456-ghi789
```

### `debugg-ai list`

List your test suites.

```bash
debugg-ai list --repo my-app --branch main
```

## How It Works

1. **Git Analysis**: Analyzes your git changes based on options:
   - Working directory changes (default)
   - Specific commits (`--commit`)
   - Last N commits (`--last`)
   - Date range (`--since`)
   - Full PR via GitHub App (`--pr`) - backend handles analysis
   - PR commits individually (`--pr-sequence`) - CLI handles analysis

2. **Test Generation**: Sends changes to DebuggAI API to generate contextual E2E tests

3. **Execution**: Tests run in cloud environment with real browser automation

4. **Results**: Downloads test files, recordings, and detailed reports

## PR Testing Modes

DebuggAI supports two modes for testing pull requests:

### 1. GitHub App Mode (`--pr`)
- **Single request** to backend with PR number
- **Requires GitHub App** integration configured
- Backend fetches all PR data directly from GitHub
- Faster and more efficient for large PRs
- Example: `debugg-ai test --pr 123`

### 2. CLI Analysis Mode (`--pr-sequence`)  
- **Multiple requests** (one per commit)
- Works **without GitHub App** integration
- CLI analyzes git locally and sends changes
- Better for finding which commit broke tests
- Example: `debugg-ai test --pr-sequence`

## Common Use Cases

### Testing a Feature Branch
```bash
# Test all changes in feature branch compared to main
debugg-ai test --range main..feature-branch
```

### Testing a Pull Request

#### With GitHub App Integration (Recommended)
```bash
# Test entire PR with a single request (requires GitHub App)
debugg-ai test --pr 123
```

#### Without GitHub App
```bash
# Test each commit in PR individually (great for finding breaking changes)
debugg-ai test --pr-sequence --base-branch main --head-branch feature-branch

# Or let GitHub Actions auto-detect the branches
debugg-ai test --pr-sequence
```

### Testing Recent Work
```bash
# Test last 3 commits
debugg-ai test --last 3

# Test commits from last 2 days
debugg-ai test --since "2 days ago"
```

### Local Development with Tunneling
```bash
# Create a tunnel to your local dev server
debugg-ai test --wait-for-server --tunnel-uuid my-test-app
```

## Output Files

- **Test Scripts**: Playwright files (`.spec.js`)
- **Recordings**: Test execution GIFs (`.gif`)
- **Results**: Detailed test data (`.json`)

Files are saved to `tests/debugg-ai/` by default.

## Environment Variables

- `DEBUGGAI_API_KEY` - Your API key
- `DEBUGGAI_BASE_URL` - Custom API endpoint (optional)

## Programmatic Usage

```typescript
import { runDebuggAITests } from '@debugg-ai/cli';

// Basic usage
const result = await runDebuggAITests({
  apiKey: 'your-api-key',
  waitForServer: true
});

// Test multiple commits
const result = await runDebuggAITests({
  apiKey: 'your-api-key',
  last: 5,  // Test last 5 commits
  downloadArtifacts: true
});

// GitHub App PR testing (single request)
const result = await runDebuggAITests({
  apiKey: 'your-api-key',
  pr: 123  // PR number
});

// PR sequence testing (multiple requests)
const result = await runDebuggAITests({
  apiKey: 'your-api-key',
  prSequence: true,
  baseBranch: 'main',
  headBranch: 'feature-branch'
});
```

## Troubleshooting

**Authentication issues?** Check your API key.
**Server not starting?** Verify the port with `curl http://localhost:3000`.
**No changes detected?** Make sure you have git changes to analyze.

## License

MIT