import type { AgentAdapter, PromptOptions } from "./agent-adapter.ts";

export type FakeResponse =
  | string
  | Error
  | ((message: string, options: PromptOptions) => string | Promise<string>);

export class FakeAgentAdapter implements AgentAdapter {
  readonly prompts: string[] = [];
  readonly sessionFile = undefined;
  disposed = false;

  constructor(
    readonly id: string,
    private readonly responses: FakeResponse[],
  ) {}

  async prompt(message: string, options: PromptOptions): Promise<string> {
    this.prompts.push(message);
    const response = this.responses.shift();
    if (response === undefined) throw new Error(`No fake response remains for ${this.id}`);
    if (response instanceof Error) throw response;
    const output = typeof response === "function" ? await response(message, options) : response;
    options.onText?.(output);
    return output;
  }

  dispose(): void {
    this.disposed = true;
  }
}
