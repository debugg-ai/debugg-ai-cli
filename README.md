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

# Wait for local development server
debugg-ai test --wait-for-server
```

## GitHub Actions

```yaml
- name: Run DebuggAI Tests
  env:
    DEBUGGAI_API_KEY: ${{ secrets.DEBUGGAI_API_KEY }}
  run: npx @debugg-ai/cli test
```

## Commands

### `debugg-ai test`

Generate and run E2E tests from git changes.

**Key Options:**
- `--api-key, -k` - Your DebuggAI API key
- `--wait-for-server` - Wait for local dev server to start
- `--server-port` - Port to wait for (default: 3000)
- `--output-dir, -o` - Where to save test files (default: tests/debugg-ai)

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

1. Analyzes your git changes
2. Sends changes to DebuggAI API to generate E2E tests
3. Waits for test execution and downloads results
4. Saves test files, recordings, and reports locally

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

const result = await runDebuggAITests({
  apiKey: 'your-api-key',
  waitForServer: true
});
```

## Troubleshooting

**Authentication issues?** Check your API key.
**Server not starting?** Verify the port with `curl http://localhost:3000`.
**No changes detected?** Make sure you have git changes to analyze.

## License

MIT