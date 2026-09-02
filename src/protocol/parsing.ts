import type { z } from "zod";
import {
  PromptAbortedError,
  type AgentAdapter,
} from "../agents/agent-adapter.ts";
import { repairPrompt } from "./prompts.ts";

export class ParticipantError extends Error {
  constructor(
    readonly participantId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ParticipantError";
  }
}

export function extractResultJson(output: string): unknown {
  const matches = [...output.matchAll(/<result>\s*([\s\S]*?)\s*<\/result>/giu)];
  if (matches.length !== 1) {
    throw new Error(`expected exactly one <result> block, received ${matches.length}`);
  }
  const body = matches[0]?.[1];
  if (body === undefined) throw new Error("result block was empty");
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`result block is not valid JSON: ${String(error)}`, { cause: error });
  }
}

function parseOutput<T>(output: string, schema: z.ZodType<T>): T {
  return schema.parse(extractResultJson(output));
}

async function promptWithRetry(
  agent: AgentAdapter,
  prompt: string,
  timeoutMs: number,
  participantRetries: number,
  signal?: AbortSignal,
  onText?: (delta: string) => void,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= participantRetries; attempt += 1) {
    try {
      return await agent.prompt(prompt, {
        timeoutMs,
        ...(signal === undefined ? {} : { signal }),
        ...(onText === undefined ? {} : { onText }),
      });
    } catch (error) {
      if (error instanceof PromptAbortedError) {
        throw new ParticipantError(agent.id, "participant call was cancelled", { cause: error });
      }
      lastError = error;
    }
  }
  throw new ParticipantError(agent.id, `participant failed after ${participantRetries + 1} attempt(s)`, {
    cause: lastError,
  });
}

export async function askForStructuredResult<T>(input: {
  agent: AgentAdapter;
  prompt: string;
  schema: z.ZodType<T>;
  timeoutMs: number;
  participantRetries: number;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
}): Promise<T> {
  const output = await promptWithRetry(
    input.agent,
    input.prompt,
    input.timeoutMs,
    input.participantRetries,
    input.signal,
    input.onText,
  );

  try {
    return parseOutput(output, input.schema);
  } catch (firstError) {
    const repaired = await promptWithRetry(
      input.agent,
      repairPrompt(firstError instanceof Error ? firstError.message : String(firstError)),
      input.timeoutMs,
      input.participantRetries,
      input.signal,
      input.onText,
    );
    try {
      return parseOutput(repaired, input.schema);
    } catch (repairError) {
      throw new ParticipantError(input.agent.id, "structured output remained invalid after repair", {
        cause: repairError,
      });
    }
  }
}
