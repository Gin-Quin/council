import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export const thinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ThinkingLevel = z.infer<typeof thinkingLevelSchema>;

const participantSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(["proposer", "reviewer", "arbiter"]),
    provider: z.string().min(1),
    model: z.string().min(1),
    thinkingLevel: thinkingLevelSchema.optional(),
  })
  .strict();

export type ParticipantConfig = z.infer<typeof participantSchema>;

export const councilConfigSchema = z
  .object({
    proposers: z.array(participantSchema).length(3),
    reviewers: z.array(participantSchema).length(2),
    maxRounds: z.number().int().min(1).max(4).default(4),
    consensusMode: z
      .enum(["two_proposers_plus_all_reviewers", "unanimous_all_five"])
      .default("two_proposers_plus_all_reviewers"),
    persistentSessions: z.boolean().default(true),
    workingDirectory: z.string().min(1).default(process.cwd()),
    runsDirectory: z.string().min(1).default("./runs"),
    sessionsDirectory: z.string().min(1).default("./sessions"),
    allowReadTools: z.boolean().default(true),
    allowBashDuringEvidenceChecks: z.boolean().default(false),
    callTimeoutMs: z.number().int().positive().default(300_000),
    overallTimeoutMs: z.number().int().positive().default(1_800_000),
    participantRetries: z.number().int().min(0).max(1).default(1),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.proposers.some(({ role }) => role !== "proposer")) {
      context.addIssue({
        code: "custom",
        message: "every proposer entry must have role=proposer",
        path: ["proposers"],
      });
    }
    if (config.reviewers.some(({ role }) => role !== "reviewer")) {
      context.addIssue({
        code: "custom",
        message: "every reviewer entry must have role=reviewer",
        path: ["reviewers"],
      });
    }
    const ids = [...config.proposers, ...config.reviewers].map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "participant ids must be unique",
        path: ["proposers"],
      });
    }
  });

export type CouncilConfig = z.infer<typeof councilConfigSchema>;
export type CouncilConfigInput = z.input<typeof councilConfigSchema>;

export function resolveCouncilConfig(input: unknown): CouncilConfig {
  const parsed = councilConfigSchema.parse(input);
  const workingDirectory = resolve(parsed.workingDirectory);
  const resolveFromWorkingDirectory = (path: string): string =>
    isAbsolute(path) ? path : resolve(workingDirectory, path);

  return {
    ...parsed,
    workingDirectory,
    runsDirectory: resolveFromWorkingDirectory(parsed.runsDirectory),
    sessionsDirectory: resolveFromWorkingDirectory(parsed.sessionsDirectory),
  };
}

export async function loadCouncilConfig(path: string): Promise<CouncilConfig> {
  const absolutePath = resolve(path);
  const imported = (await import(pathToFileURL(absolutePath).href)) as {
    default?: unknown;
    config?: unknown;
  };
  const input = imported.default ?? imported.config;
  if (input === undefined) {
    throw new Error(`Config ${absolutePath} must export default or a named \"config\" value`);
  }
  return resolveCouncilConfig(input);
}
