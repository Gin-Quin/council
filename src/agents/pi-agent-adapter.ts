import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { CouncilConfig, ParticipantConfig } from "../config.ts";
import { PROPOSER_SYSTEM_PROMPT, REVIEWER_SYSTEM_PROMPT } from "../protocol/prompts.ts";
import {
  PromptAbortedError,
  PromptTimeoutError,
  type AgentAdapter,
  type CouncilAgents,
  type PromptOptions,
} from "./agent-adapter.ts";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];

export class PiAgentAdapter implements AgentAdapter {
  constructor(
    readonly id: string,
    private readonly session: AgentSession,
  ) {}

  get sessionFile(): string | undefined {
    return this.session.sessionFile;
  }

  async prompt(message: string, options: PromptOptions): Promise<string> {
    if (options.signal?.aborted) throw new PromptAbortedError();
    let output = "";
    const unsubscribe = this.session.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        output += event.assistantMessageEvent.delta;
        options.onText?.(event.assistantMessageEvent.delta);
      }
    });

    let timeoutTriggered = false;
    let abortTriggered = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timeoutTriggered = true;
        void this.session
          .abort()
          .catch(() => undefined)
          .finally(() => reject(new PromptTimeoutError(options.timeoutMs)));
      }, options.timeoutMs);
    });
    let abortListener: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      abortListener = () => {
        abortTriggered = true;
        void this.session
          .abort()
          .catch(() => undefined)
          .finally(() => reject(new PromptAbortedError()));
      };
      options.signal?.addEventListener("abort", abortListener, { once: true });
    });

    try {
      await Promise.race([this.session.prompt(message), timeoutPromise, abortPromise]);
      if (abortTriggered) throw new PromptAbortedError();
      if (timeoutTriggered) throw new PromptTimeoutError(options.timeoutMs);
      return output;
    } catch (error) {
      if (abortTriggered) throw new PromptAbortedError();
      if (timeoutTriggered) throw new PromptTimeoutError(options.timeoutMs);
      throw error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (abortListener !== undefined) options.signal?.removeEventListener("abort", abortListener);
      unsubscribe();
    }
  }

  dispose(): void {
    this.session.dispose();
  }
}

function systemPromptFor(participant: ParticipantConfig): string {
  if (participant.role === "proposer") return PROPOSER_SYSTEM_PROMPT;
  if (participant.role === "reviewer") return REVIEWER_SYSTEM_PROMPT;
  throw new Error(`Standing participant ${participant.id} cannot have role=${participant.role}`);
}

async function createPiAgent(input: {
  participant: ParticipantConfig;
  config: CouncilConfig;
  modelRuntime: ModelRuntime;
  runId: string;
}): Promise<PiAgentAdapter> {
  const { participant, config, modelRuntime, runId } = input;
  const model = modelRuntime.getModel(participant.provider, participant.model);
  if (model === undefined) {
    throw new Error(`Model not found: ${participant.provider}/${participant.model}`);
  }

  const participantSessionDirectory = join(config.sessionsDirectory, runId, participant.id);
  if (config.persistentSessions) {
    await mkdir(participantSessionDirectory, { recursive: true });
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd: config.workingDirectory,
    agentDir: getAgentDir(),
    systemPromptOverride: () => systemPromptFor(participant),
  });
  await resourceLoader.reload();

  const sessionManager = config.persistentSessions
    ? SessionManager.create(config.workingDirectory, participantSessionDirectory)
    : SessionManager.inMemory(config.workingDirectory);

  const { session } = await createAgentSession({
    cwd: config.workingDirectory,
    modelRuntime,
    model,
    thinkingLevel: participant.thinkingLevel ?? "high",
    sessionManager,
    resourceLoader,
    tools: config.allowReadTools ? READ_ONLY_TOOLS : [],
  });

  return new PiAgentAdapter(participant.id, session);
}

export async function createPiCouncilAgents(
  config: CouncilConfig,
  runId: string,
): Promise<CouncilAgents> {
  const modelRuntime = await ModelRuntime.create();
  const participants = [...config.proposers, ...config.reviewers];
  const settled = await Promise.allSettled(
    participants.map((participant) =>
      createPiAgent({ participant, config, modelRuntime, runId }),
    ),
  );

  const agents = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const failure = settled.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") {
    await Promise.allSettled(agents.map((agent) => agent.dispose()));
    throw failure.reason;
  }

  return {
    proposers: [agents[0]!, agents[1]!, agents[2]!],
    reviewers: [agents[3]!, agents[4]!],
  };
}
