const defaultModels = `Built-in defaults (thinking: high):
  Proposers: openai/gpt-5.6-sol
             anthropic/claude-fable-5-1
             moonshotai/kimi-k3
  Reviewers: openai/gpt-5.6-sol
             anthropic/claude-fable-5-1`;

const modelOptions = `Model selection (provider/model):
  --model <model>             Use one model for all five participants
  --proposer <model>          Repeat once or three times
  --reviewer <model>          Repeat once or twice
  --thinking-level <level>    off|minimal|low|medium|high|xhigh|max`;

export const mainHelp = `Council — independent 3+2 deliberation

Usage:
  council [options] "text prompt"
  council run [options] "text prompt"
  council <command> [options]

Quick start:
  council "Review this architecture"
  council --model anthropic/claude-fable-5-1 "Review this architecture"
  council config set --model anthropic/claude-fable-5-1

Commands:
  help [topic]       Show help for run, config, models, install, or examples
  models             Discover models known to Pi
  config             Manage global model defaults
  run                Explicit form of the default prompt command

Run options:
  -c, --config <path>         Load a complete .ts/.js config module
  --problem-file <path>       Read the prompt from a file
  --max-rounds <1-4>          Override the round limit
  --consensus <mode>          standard|strict
  --no-persist                Use in-memory Pi sessions
  --json                      Print machine-readable output
  --no-color                  Disable per-agent ANSI colors
  -v, --verbose               Print stage progress
  -h, --help                  Show run help

${modelOptions}

${defaultModels}

Configuration precedence: prompt flags > --config file > global config > built-in defaults.
Run \`council help examples\` for copyable commands.`;

export const runHelp = `Run a council with a text prompt

Usage:
  council [options] "text prompt"
  council run [options] "text prompt"

${modelOptions}

${defaultModels}

Other options:
  -c, --config <path>         Complete council config module
  --problem-file <path>       Read the prompt from a UTF-8 file
  --max-rounds <1-4>          Default: 4
  --consensus <mode>          standard|strict
  --no-persist                Do not persist Pi sessions
  --json                      JSON result on stdout
  --no-color                  Disable per-agent ANSI colors
  -v, --verbose               Progress on stderr

One --proposer value is copied to all three proposers; three values assign
them independently. The reviewer option behaves the same way for two reviewers.`;

export const configHelp = `Manage global model defaults

Usage:
  council config path
  council config show
  council config show --config ./council.config.ts
  council config set --model <provider/model>
  council config set --proposer <model> --reviewer <model>

The set command accepts one or three --proposer values and one or two
--reviewer values. --model sets all five. --thinking-level sets the global
default. Values not mentioned by config set are preserved.

Without global configuration, Council uses its built-in 3+2 model defaults.
Set COUNCIL_CONFIG_FILE to override the global config file location.`;

export const modelsHelp = `Discover Pi models

Usage:
  council models                 Show authenticated/available models
  council models --all           Show the full local Pi catalog
  council models --provider ID   Filter by provider
  council models --json          Emit JSON

This command inspects Pi's model runtime and does not make an inference call.`;

export const installHelp = `Build and install the standalone CLI locally

  bun install
  bun run build
  bun link

The compiled executable is dist/council. After linking:

  council help

The standalone executable embeds Bun and npm dependencies.`;

export const examplesHelp = `Examples

Use the built-in diverse defaults:
  council "Design a rate limiter"

Use one model everywhere for this prompt:
  council --model openai/gpt-5.6-sol "Design a rate limiter"

Use independent role models for this prompt:
  council \\
    --proposer openai/gpt-5.6-sol \\
    --proposer anthropic/claude-fable-5-1 \\
    --proposer moonshotai/kimi-k3 \\
    --reviewer openai/gpt-5.6-sol \\
    --reviewer anthropic/claude-fable-5-1 \\
    "Choose a database architecture"

Save global defaults, then use only a prompt:
  council config set --model anthropic/claude-fable-5-1
  council "Find the likely cause of this incident"

Discover exact model IDs available in your Pi installation:
  council models`;

export function helpFor(topic: string | undefined): string {
  switch (topic) {
    case undefined:
      return mainHelp;
    case "run":
      return runHelp;
    case "config":
      return configHelp;
    case "models":
      return modelsHelp;
    case "install":
      return installHelp;
    case "examples":
      return examplesHelp;
    default:
      throw new Error(`Unknown help topic "${topic}". Try run, config, models, install, or examples.`);
  }
}
