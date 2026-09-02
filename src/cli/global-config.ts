import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { thinkingLevelSchema } from "../config.ts";
import { modelReferenceSchema } from "./model-selection.ts";

const proposerModelsSchema = z
  .array(modelReferenceSchema)
  .refine((models) => models.length === 1 || models.length === 3, {
    message: "configure either one proposer model or exactly three proposer models",
  });

const reviewerModelsSchema = z
  .array(modelReferenceSchema)
  .refine((models) => models.length === 1 || models.length === 2, {
    message: "configure either one reviewer model or exactly two reviewer models",
  });

export const globalConfigSchema = z
  .object({
    version: z.literal(1),
    proposerModels: proposerModelsSchema.optional(),
    reviewerModels: reviewerModelsSchema.optional(),
    thinkingLevel: thinkingLevelSchema.optional(),
  })
  .strict();

export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export function globalConfigPath(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.COUNCIL_CONFIG_FILE) return environment.COUNCIL_CONFIG_FILE;
  const configRoot = environment.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(configRoot, "council", "config.json");
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: string }).code === "ENOENT"
  );
}

export async function readGlobalConfig(path = globalConfigPath()): Promise<GlobalConfig | undefined> {
  try {
    const contents = await readFile(path, "utf8");
    return globalConfigSchema.parse(JSON.parse(contents));
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw new Error(`Could not read global config ${path}: ${String(error)}`, { cause: error });
  }
}

export async function writeGlobalConfig(
  config: GlobalConfig,
  path = globalConfigPath(),
): Promise<void> {
  const validated = globalConfigSchema.parse(config);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.config-${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}
