import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { loadCouncilConfig, resolveCouncilConfig, thinkingLevelSchema } from "../config.ts";
import { runCouncil, type CouncilEvent } from "../council.ts";
import {
  globalConfigPath,
  readGlobalConfig,
  writeGlobalConfig,
  type GlobalConfig,
} from "./global-config.ts";
import { configHelp, helpFor, mainHelp, modelsHelp, runHelp } from "./help.ts";
import {
  DEFAULT_PROPOSER_MODELS,
  DEFAULT_REVIEWER_MODELS,
  DEFAULT_THINKING_LEVEL,
  resolveModelConfiguration,
  type ModelOverrides,
} from "./model-selection.ts";
import { AgentTerminalRenderer } from "./terminal-renderer.ts";

const VERSION = "0.1.0";

type CliDependencies = {
  cwd: string;
  globalConfigFile: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  colorEnabled: boolean;
};

function dependencies(overrides: Partial<CliDependencies> = {}): CliDependencies {
  return {
    cwd: process.cwd(),
    globalConfigFile: globalConfigPath(),
    stdout: console.log,
    stderr: console.error,
    colorEnabled: Boolean(process.stderr.isTTY) && Bun.env.NO_COLOR === undefined,
    ...overrides,
  };
}

function progress(event: CouncilEvent, stderr: (message: string) => void): void {
  switch (event.type) {
    case "run_started":
      stderr(`Council run: ${event.runId}`);
      break;
    case "stage_complete":
      stderr(`  ✓ ${event.stage.replaceAll("_", " ")}`);
      break;
    case "round_complete":
      stderr(`Round ${event.round}: ${event.consensus ? "consensus" : "no consensus"}`);
      break;
    case "consensus_reached":
      stderr(`  → consensus cluster [${event.members.join(", ")}]`);
      break;
  }
}

function modelOverrides(values: {
  model?: string;
  proposer?: string[];
  reviewer?: string[];
  "thinking-level"?: string;
}): ModelOverrides {
  return {
    ...(values.model === undefined ? {} : { allModel: values.model }),
    ...(values.proposer === undefined ? {} : { proposerModels: values.proposer }),
    ...(values.reviewer === undefined ? {} : { reviewerModels: values.reviewer }),
    ...(values["thinking-level"] === undefined
      ? {}
      : { thinkingLevel: thinkingLevelSchema.parse(values["thinking-level"]) }),
  };
}

async function runPrompt(args: string[], deps: CliDependencies): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: "string", short: "c" },
      "problem-file": { type: "string" },
      "max-rounds": { type: "string" },
      consensus: { type: "string" },
      "no-persist": { type: "boolean" },
      model: { type: "string" },
      proposer: { type: "string", multiple: true },
      reviewer: { type: "string", multiple: true },
      "thinking-level": { type: "string" },
      "no-color": { type: "boolean" },
      json: { type: "boolean" },
      verbose: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    deps.stdout(runHelp);
    return 0;
  }
  if (values["problem-file"] !== undefined && positionals.length > 0) {
    throw new Error("provide either a positional text prompt or --problem-file, not both");
  }

  const problem = values["problem-file"]
    ? await Bun.file(resolve(deps.cwd, values["problem-file"])).text()
    : positionals.join(" ");
  if (problem.trim().length === 0) throw new Error("a text prompt or --problem-file is required");

  const baseConfig = values.config
    ? await loadCouncilConfig(resolve(deps.cwd, values.config))
    : undefined;
  const globalConfig = baseConfig === undefined
    ? await readGlobalConfig(deps.globalConfigFile)
    : undefined;
  const selectedConfig = resolveModelConfiguration({
    ...(baseConfig === undefined ? {} : { baseConfig }),
    ...(globalConfig === undefined ? {} : { globalConfig }),
    overrides: modelOverrides(values),
    workingDirectory: deps.cwd,
  });

  const maxRounds = values["max-rounds"]
    ? Number.parseInt(values["max-rounds"], 10)
    : selectedConfig.maxRounds;
  const consensusMode =
    values.consensus === undefined
      ? selectedConfig.consensusMode
      : values.consensus === "standard"
        ? "two_proposers_plus_all_reviewers"
        : values.consensus === "strict"
          ? "unanimous_all_five"
          : (() => {
              throw new Error("--consensus must be standard or strict");
            })();
  const config = resolveCouncilConfig({
    ...selectedConfig,
    maxRounds,
    consensusMode,
    persistentSessions: values["no-persist"] ? false : selectedConfig.persistentSessions,
  });

  const renderer = new AgentTerminalRenderer({
    writeLine: deps.stderr,
    color: deps.colorEnabled && !values["no-color"],
  });
  const result = await runCouncil(problem, config, {
    onEvent: (event) => {
      renderer.handle(event);
      if (values.verbose) progress(event, deps.stderr);
    },
  });

  if (values.json) {
    deps.stdout(JSON.stringify(result, null, 2));
  } else {
    deps.stdout(`Status: ${result.status}`);
    deps.stdout(`Rounds: ${result.rounds}`);
    if (result.consensus?.reached) {
      deps.stdout(`Consensus cluster: [${result.consensus.cluster.members.join(", ")}]`);
    }
    if (result.recommendation) {
      deps.stdout(`\n${result.recommendation.approach}`);
    } else if (result.error) {
      deps.stdout(`\n${result.error}`);
    }
    deps.stdout(`\nTranscript: ${config.runsDirectory}/${result.runId}`);
  }

  if (["participant_failure", "timeout", "cancelled"].includes(result.status)) return 1;
  return result.status === "consensus" ? 0 : 2;
}

async function listModels(args: string[], deps: CliDependencies): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      all: { type: "boolean" },
      provider: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    deps.stdout(modelsHelp);
    return 0;
  }

  const runtime = await ModelRuntime.create();
  const available = await runtime.getAvailable(values.provider);
  const models = values.all ? runtime.getModels(values.provider) : available;
  const availableKeys = new Set(available.map((model) => `${model.provider}/${model.id}`));
  const rows = models
    .map((model) => ({
      reference: `${model.provider}/${model.id}`,
      name: model.name,
      reasoning: model.reasoning,
      contextWindow: model.contextWindow,
      available: availableKeys.has(`${model.provider}/${model.id}`),
    }))
    .sort((left, right) => left.reference.localeCompare(right.reference));

  if (values.json) {
    deps.stdout(JSON.stringify(rows, null, 2));
  } else if (rows.length === 0) {
    deps.stdout("No authenticated models found. Try `council models --all` to inspect the catalog.");
  } else {
    for (const row of rows) {
      const availability = values.all ? (row.available ? "available" : "not authenticated") : "available";
      deps.stdout(`${row.reference}\t${availability}\t${row.name}`);
    }
  }
  return 0;
}

async function showConfig(args: string[], deps: CliDependencies): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      config: { type: "string", short: "c" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    deps.stdout(configHelp);
    return 0;
  }
  if (values.config) {
    const config = await loadCouncilConfig(resolve(deps.cwd, values.config));
    deps.stdout(JSON.stringify(config, null, 2));
    return 0;
  }
  const config = await readGlobalConfig(deps.globalConfigFile);
  deps.stdout(JSON.stringify({
    source: config === undefined ? "built_in_defaults" : "global_overrides",
    configFile: deps.globalConfigFile,
    proposerModels: config?.proposerModels ?? DEFAULT_PROPOSER_MODELS,
    reviewerModels: config?.reviewerModels ?? DEFAULT_REVIEWER_MODELS,
    thinkingLevel: config?.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
    ...(config === undefined ? {} : { globalOverrides: config }),
  }, null, 2));
  return 0;
}

async function setConfig(args: string[], deps: CliDependencies): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      model: { type: "string" },
      proposer: { type: "string", multiple: true },
      reviewer: { type: "string", multiple: true },
      "thinking-level": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    deps.stdout(configHelp);
    return 0;
  }
  if (
    values.model === undefined &&
    values.proposer === undefined &&
    values.reviewer === undefined &&
    values["thinking-level"] === undefined
  ) {
    throw new Error("config set requires --model, --proposer, --reviewer, or --thinking-level");
  }

  const current = (await readGlobalConfig(deps.globalConfigFile)) ?? { version: 1 };
  const next: GlobalConfig = {
    ...current,
    ...(values.model === undefined
      ? {}
      : { proposerModels: [values.model], reviewerModels: [values.model] }),
    ...(values.proposer === undefined ? {} : { proposerModels: values.proposer }),
    ...(values.reviewer === undefined ? {} : { reviewerModels: values.reviewer }),
    ...(values["thinking-level"] === undefined
      ? {}
      : { thinkingLevel: thinkingLevelSchema.parse(values["thinking-level"]) }),
  };
  await writeGlobalConfig(next, deps.globalConfigFile);
  deps.stdout(`Saved global config: ${deps.globalConfigFile}`);
  deps.stdout(JSON.stringify(next, null, 2));
  return 0;
}

async function configure(args: string[], deps: CliDependencies): Promise<number> {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      deps.stdout(configHelp);
      return 0;
    case "path":
      if (rest.length > 0) throw new Error("config path does not accept arguments");
      deps.stdout(deps.globalConfigFile);
      return 0;
    case "show":
      return showConfig(rest, deps);
    case "set":
      return setConfig(rest, deps);
    default:
      throw new Error(`Unknown config command \"${subcommand}\". Try path, show, or set.`);
  }
}

export async function main(
  args: string[],
  dependencyOverrides: Partial<CliDependencies> = {},
): Promise<number> {
  const deps = dependencies(dependencyOverrides);
  const [command, ...rest] = args;
  switch (command) {
    case undefined:
    case "help":
      deps.stdout(helpFor(rest[0]));
      return 0;
    case "--help":
    case "-h":
      deps.stdout(mainHelp);
      return 0;
    case "--version":
    case "version":
      deps.stdout(VERSION);
      return 0;
    case "models":
      return listModels(rest, deps);
    case "config":
      return configure(rest, deps);
    case "run":
      return runPrompt(rest, deps);
    default:
      return runPrompt(args, deps);
  }
}
