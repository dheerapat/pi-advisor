# pi-advisor

Delegate hard problems to a more capable advisor model while working with a cheaper, faster model day-to-day.

## How it works

1. **Configure** an advisor model (e.g., Claude Opus, GPT-5) via `/advisor config`
2. **Work** normally with your preferred fast/cheap model
3. **When stuck**, either:
   - Type `/advise` and describe your problem, or
   - The LLM itself calls `ask_advisor` when it recognizes it's stuck

The advisor model receives the full conversation context and provides expert guidance. It is **read-only** — it has no tools, cannot read files, and cannot make changes. It's a pure consultant.

The advisor's response is injected into the conversation so your working model can continue with the advice in context.

## Installation

```bash
pi install git:github.com/dheeto/pi-advisor
```

## Configuration

Run the interactive setup:

```
/advisor config
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

| File | Scope |
|------|-------|
| `~/.pi/agent/advisor.json` | Global (all projects) |
| `.pi/advisor.json` | Project-local (overrides global) |

### Options

| Key | Required | Description |
|-----|----------|-------------|
| `provider` | Yes | Provider ID (e.g., `anthropic`, `openai`) |
| `model` | Yes | Model ID (e.g., `claude-sonnet-4-5`) |
| `thinkingLevel` | No | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `systemPrompt` | No | Custom system prompt for the advisor |

## Usage

### `/advise [question]`

Ask the advisor a question directly.

```
/advise I'm stuck trying to implement the auth middleware, any suggestions?
```

With no arguments, you'll be prompted to enter your question.

### `ask_advisor` tool

The LLM can call this tool when it recognizes it's stuck. It formulates its own question and the advisor responds with guidance.

### `/advisor status`

Show the current advisor configuration.

### `/advisor config`

Re-run the interactive setup.

## License

MIT
