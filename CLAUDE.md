# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is `@debugg-ai/cli` - a CLI tool for running DebuggAI tests in CI/CD environments like GitHub Actions. The tool analyzes git changes and generates automated E2E tests using the DebuggAI API.

## Common Development Commands

```bash
# Build the project
npm run build

# Development mode with file watching
npm run dev

# Run tests
npm run test

# Lint TypeScript files
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Prepare for publishing (builds automatically)
npm run prepublishOnly
```

## Architecture Overview

The CLI follows a modular architecture with three main components in `src/lib/`:

1. **ApiClient** (`api-client.ts`) - Handles all DebuggAI API interactions including authentication, test suite creation, status polling, and artifact downloads
2. **GitAnalyzer** (`git-analyzer.ts`) - Analyzes git repositories for changes, handles both working directory changes and specific commit analysis, with support for CI/CD environments
3. **TestManager** (`test-manager.ts`) - Orchestrates the complete test lifecycle from change analysis to result reporting, manages server readiness checks and artifact storage

The main entry points are:
- `cli.ts` - Command-line interface with three commands: `test`, `status`, and `list`
- `index.ts` - Programmatic API exports and `runDebuggAITests()` function

## Key Technical Details

- **TypeScript Configuration**: Strict mode enabled with ES2020 target, outputs to `dist/` directory
- **Testing**: Uses Jest with ts-jest preset for TypeScript support
- **Git Integration**: Uses `simple-git` library for repository analysis
- **CI/CD Environment Variables**: Automatically detects GitHub Actions environment via `GITHUB_SHA`, `GITHUB_REF_NAME`, `GITHUB_HEAD_REF`
- **API Authentication**: Uses Bearer token authentication with `DEBUGGAI_API_KEY` environment variable
- **Output Directory**: Default test artifacts saved to `tests/debugg-ai/`

## Development Notes

- The tool is designed for Node.js 18+ environments
- File changes in common build/ignore directories are automatically filtered out (`node_modules`, `dist`, `build`, `.git`, etc.)
- Server readiness detection uses HTTP polling for local development server integration
- Test artifacts include Playwright scripts (`.spec.js`), recordings (`.gif`), and detailed results (`.json`)
- Exit codes: 0 for success, 1 for errors (important for CI/CD integration)

## CLI Usage Patterns

The tool supports three main usage patterns:
1. **Local development**: `debugg-ai test --wait-for-server` (analyzes working changes)
2. **CI/CD**: `debugg-ai test` (analyzes commit from environment variables)
3. **Programmatic**: Import and use `runDebuggAITests()` function