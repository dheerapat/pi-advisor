# pi-advisor

Delegate hard problems to a more capable advisor model while working with a cheaper, faster model day-to-day.

## How it works

1. **Configure** an advisor model via `/advisor:config`
2. **Work** normally with your preferred fast/cheap model
3. **When stuck**, either:
   - Type `/advisor:ask` and describe your problem, or
   - Type `/advisor:describe` for a fresh set of eyes on the conversation, or
   - The LLM itself calls `ask_advisor` when it recognizes it's stuck

The advisor model receives the full conversation context and provides expert guidance. It is **read-only** — it has no tools, cannot read files, and cannot make changes. It's a pure consultant.

The advisor's response is injected into the conversation so your working model can continue with the advice in context.

## Installation

```bash
pi install git:github.com/dheerapat/pi-advisor
```

## Configuration

Run the interactive setup:

```
/advisor:config
```

This will prompt you to select:

- Provider (e.g., `anthropic`, `openai`)
- Model (e.g., `claude-sonnet-4-5`)
- Thinking level (optional)
- Scope (global `~/.pi/agent/advisor.json` or project `.pi/advisor.json`)

Or create the config file manually:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "thinkingLevel": "high"
}
```

### Config files

| File                       | Scope                            |
| -------------------------- | -------------------------------- |
| `~/.pi/agent/advisor.json` | Global (all projects)            |
| `.pi/advisor.json`         | Project-local (overrides global) |

### Options

| Key                  | Required | Description                                        |
| -------------------- | -------- | -------------------------------------------------- |
| `provider`           | Yes      | Provider ID (e.g., `anthropic`, `openai`)          |
| `model`              | Yes      | Model ID (e.g., `claude-sonnet-4-5`)               |
| `thinkingLevel`      | No       | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `systemPrompt`       | No       | Custom system prompt for the advisor               |
| `maxContextMessages` | No       | Max conversation messages to send (default: 50)    |

Config files are validated on load — malformed entries are logged with clear error messages and ignored, preventing silent failures.

## Available Commands

All commands follow the `/advisor:<action>` format.

### `/advisor`

Show a help listing of all available advisor commands.

### `/advisor:ask [question]`

Ask the advisor a question directly.

```
/advisor:ask I'm stuck trying to implement the auth middleware, any suggestions?
```

With no arguments, you'll be prompted to enter your question.

### `/advisor:describe`

Get a fresh pair of eyes on the entire conversation. Sends a generic review prompt asking the advisor to analyze what you're trying to accomplish, the current state, and any issues or improvements it can spot — useful when you're not sure what to ask.

```
/advisor:describe
```

### `/advisor:status`

Show the current advisor configuration (provider, model, thinking level).

```
/advisor:status
```

### `/advisor:config`

Run the interactive setup to configure or reconfigure the advisor model.

```
/advisor:config
```

### `ask_advisor` tool

The LLM can call this tool when it recognizes it's stuck. It formulates its own question and the advisor responds with guidance. The tool result renders inline in the TUI with expand/collapse and usage stats.

## Reliability

- **Retry with backoff:** Transient failures (rate limits, server errors, network drops) are automatically retried up to 2 times with exponential backoff (1s, 2s).
- **Conversation size guard:** By default, only the most recent 50 messages are sent to the advisor. Configure with `maxContextMessages`.
- **Config validation:** Config files are validated with Typebox schemas at load time. Bad values are logged and ignored rather than causing cryptic runtime errors.

## Status bar

When configured, the status bar shows `advisor:<provider>/<model>` in the accent color.

## License

MIT
