# Pi Council

A local Bun/TypeScript deliberation harness built on Pi. Three independent proposers generate solutions, two independent reviewers assess them, and the proposers revise before final validation. The orchestrator preserves isolation and stops only when the configured consensus rule is satisfied.

This is the council-core MVP. It deliberately does not execute evidence tasks or create a deadlock arbiter yet; reaching the round limit returns `max_rounds_exhausted` instead of inventing agreement.

## Install the CLI

Build a standalone executable containing Bun, Pi, and the other runtime dependencies:

```bash
bun install
bun run build
```

The executable is now available at `dist/council`. Link it onto your command path:

```bash
bun link
council help
```

You can alternatively copy `dist/council` to a directory on your `PATH`. The executable is platform-specific; build it on the target machine or use Bun's cross-compilation targets.

## Run with a text prompt

Run immediately with the built-in models:

```bash
council \
  "Should this application use ShareDB or migrate to a CRDT architecture?"
```

The built-in proposer models are `openai/gpt-5.6-sol`, `anthropic/claude-fable-5-1`, and `moonshotai/kimi-k3`. The reviewer models are `openai/gpt-5.6-sol` and `anthropic/claude-fable-5-1`. All five use `high` thinking.

One model can be replicated across each role, or each standing participant can have its own model:

```bash
council \
  --proposer openai/gpt-5.6-sol \
  --proposer anthropic/claude-fable-5-1 \
  --proposer moonshotai/kimi-k3 \
  --reviewer openai/gpt-5.6-sol \
  --reviewer anthropic/claude-fable-5-1 \
  "Choose the safest migration architecture"
```

Use one `--proposer` value to assign the same model to all three proposers, or repeat it exactly three times. `--reviewer` similarly accepts one or exactly two values. Provider gateway model IDs can contain additional slashes.

## Live terminal conversation

Agent messages stream to stderr as the council runs. Every message shows the speaker and recipient, and every logical line has a left border in that agent's stable color:

```text
│ Proposer A → Orchestrator (private) · initial proposal
│ I recommend separating the protocol from the provider adapter...
│
│ Reviewer B → Proposers · review · round 1
│ Candidate A is viable, but its persistence assumption needs work...
```

Proposers A/B/C and Reviewers A/B each have a distinct color. Concurrent partial output is buffered independently so lines from two agents are never merged. Use `--no-color` or the standard `NO_COLOR` environment variable to disable ANSI colors. Live messages remain on stderr, so `--json` keeps stdout machine-readable.

## Global model defaults

Save defaults once, then invoke the CLI with only a prompt:

```bash
council config set --model anthropic/claude-fable-5-1
council "Review this design"
```

Or preserve model diversity globally:

```bash
council config set \
  --proposer openai/gpt-5.6-sol \
  --proposer anthropic/claude-fable-5-1 \
  --proposer moonshotai/kimi-k3 \
  --reviewer openai/gpt-5.6-sol \
  --reviewer anthropic/claude-fable-5-1 \
  --thinking-level high
```

Inspect the effective global storage location and current values with:

```bash
council config path
council config show
```

The default is `$XDG_CONFIG_HOME/council/config.json`, falling back to `~/.config/council/config.json`. `COUNCIL_CONFIG_FILE` overrides the full path. The file is written atomically with user-only permissions.

Complete TypeScript configuration modules remain supported through `--config council.config.ts`. Model flags on an individual prompt override the file's participant models. Precedence is:

```text
prompt flags > --config file > global config > built-in defaults
```

## Discover the CLI and models

The installed binary is self-documenting:

```bash
council help
council help run
council help config
council help models
council help install
council help examples
```

List authenticated models, or inspect Pi's complete local catalog:

```bash
council models
council models --all
council models --provider anthropic
council models --json
```

Model discovery reads Pi's model runtime and does not make an inference call. Pi resolves credentials through its normal auth store or provider environment variables.

## Other run options

```text
--problem-file <path>
--max-rounds <1-4>
--consensus standard|strict
--thinking-level <level>
--no-persist
--no-color
--json
--verbose
```

Each run writes `manifest.json`, `problem.md`, per-round JSON artifacts, `result.json`, and `final.md` beneath `runs/<run-id>/`. Persistent Pi sessions are isolated under `sessions/<run-id>/<participant-id>/`.

## Develop and verify

Run from TypeScript without compiling:

```bash
bun run src/index.ts help
```

Run the complete check, including building the standalone binary:

```bash
bun run check
```

Tests use deterministic fake agents, so verification does not make paid model calls.
