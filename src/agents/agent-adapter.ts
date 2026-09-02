export type PromptOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
};

export class PromptTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`agent prompt timed out after ${timeoutMs}ms`);
    this.name = "PromptTimeoutError";
  }
}

export class PromptAbortedError extends Error {
  constructor() {
    super("agent prompt was cancelled");
    this.name = "PromptAbortedError";
  }
}

export interface AgentAdapter {
  readonly id: string;
  readonly sessionFile: string | undefined;
  prompt(message: string, options: PromptOptions): Promise<string>;
  dispose(): Promise<void> | void;
}

export type CouncilAgents = {
  proposers: [AgentAdapter, AgentAdapter, AgentAdapter];
  reviewers: [AgentAdapter, AgentAdapter];
};
