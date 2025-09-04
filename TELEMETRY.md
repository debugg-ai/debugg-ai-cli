# Telemetry Documentation

The DebuggAI CLI includes telemetry powered by PostHog to help improve the product and understand usage patterns.

## What is Collected

The CLI collects anonymous usage data including:

- **Command execution metrics**: Which commands are run, their success/failure rates, and execution duration
- **Test execution metrics**: Number of files changed, tests generated, execution types (working changes, commit, PR)
- **Feature usage**: Tunnel creation, artifact downloads, PR sequence testing
- **System information**: Platform, architecture, Node.js version, CLI version
- **Error information**: Sanitized error messages (with sensitive data removed)

## Privacy & Security

- **Anonymous IDs**: A random UUID is generated for each user, stored locally in `~/.debugg-ai/telemetry.json`
- **No PII**: No personal information, file contents, or sensitive data is collected
- **Sanitization**: API keys, tokens, and secrets are automatically redacted from all telemetry
- **Immediate transmission**: Events are sent immediately and not stored locally

## Opting Out

You can disable telemetry in several ways:

### Environment Variables

```bash
# Disable telemetry for current session
export DEBUGGAI_TELEMETRY_DISABLED=true

# Or use the standard Do Not Track flag
export DO_NOT_TRACK=1
```

### Per-Command

Telemetry respects the DO_NOT_TRACK environment variable:

```bash
DO_NOT_TRACK=1 debugg-ai test
```

### Persistent Configuration

Add to your shell profile (`.bashrc`, `.zshrc`, etc.):

```bash
export DEBUGGAI_TELEMETRY_DISABLED=true
```

## Data Retention

- Telemetry data is retained for 90 days
- Data is used solely for product improvement and usage analytics
- No data is shared with third parties

## Technical Details

- **Service**: PostHog (self-hosted instance)
- **Project ID**: 212030
- **Implementation**: See `src/services/telemetry.ts`

## Events Tracked

### Command Events
- `cli_command_started`: Command execution begins
- `cli_command_completed`: Command finishes (success/failure)

### Test Events
- `test_execution_started`: Test analysis begins
- `test_execution_completed`: Tests complete with metrics

### Feature Events
- `tunnel_created`: Ngrok tunnel creation (success/failure)
- `artifacts_downloaded`: Test artifacts downloaded
- `feature_used`: Specific features utilized

### Error Events
- `api_error`: API errors with sanitized details

## Questions or Concerns

If you have questions about telemetry or data collection, please open an issue on our GitHub repository.