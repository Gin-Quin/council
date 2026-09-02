import { z } from "zod";
import {
  resolveCouncilConfig,
  type CouncilConfig,
  type ParticipantConfig,
  type ThinkingLevel,
} from "../config.ts";
import type { GlobalConfig } from "./global-config.ts";

export const modelReferenceSchema = z.string().trim().min(3).refine(
  (reference) => {
    const separator = reference.indexOf("/");
    return separator > 0 && separator < reference.length - 1;
  },
  { message: "model must use provider/model format" },
);

export type ModelReference = {
  provider: string;
  model: string;
};

export type ModelOverrides = {
  allModel?: string;
  proposerModels?: string[];
  reviewerModels?: string[];
  thinkingLevel?: ThinkingLevel;
};

export const DEFAULT_PROPOSER_MODELS = [
  "openai/gpt-5.6-sol",
  "anthropic/claude-fable-5-1",
  "moonshotai/kimi-k3",
] as const;

export const DEFAULT_REVIEWER_MODELS = [
  "openai/gpt-5.6-sol",
  "anthropic/claude-fable-5-1",
] as const;

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "high";

export function parseModelReference(reference: string): ModelReference {
  const validated = modelReferenceSchema.parse(reference);
  const separator = validated.indexOf("/");
  return {
    provider: validated.slice(0, separator),
    model: validated.slice(separator + 1),
  };
}

function expandModels(references: string[], count: number, role: string): ModelReference[] {
  if (references.length !== 1 && references.length !== count) {
    throw new Error(`provide one ${role} model or exactly ${count} ${role} models`);
  }
  const expanded = references.length === 1 ? Array.from({ length: count }, () => references[0]!) : references;
  return expanded.map(parseModelReference);
}

function replaceParticipantModels(
  participants: ParticipantConfig[],
  references: string[] | undefined,
  role: "proposer" | "reviewer",
  thinkingLevel: ThinkingLevel | undefined,
): ParticipantConfig[] {
  const selected = references ? expandModels(references, participants.length, role) : undefined;
  return participants.map((participant, index) => ({
    ...participant,
    ...(selected === undefined ? {} : selected[index]),
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  }));
}

function generatedParticipants(
  role: "proposer" | "reviewer",
  references: string[],
  thinkingLevel: ThinkingLevel,
): ParticipantConfig[] {
  const count = role === "proposer" ? 3 : 2;
  return expandModels(references, count, role).map((selection, index) => ({
    id: `${role}-${String.fromCharCode(97 + index)}`,
    role,
    provider: selection.provider,
    model: selection.model,
    thinkingLevel,
  }));
}

export function resolveModelConfiguration(input: {
  baseConfig?: CouncilConfig;
  globalConfig?: GlobalConfig;
  overrides: ModelOverrides;
  workingDirectory: string;
}): CouncilConfig {
  const proposerOverride = input.overrides.proposerModels ??
    (input.overrides.allModel ? [input.overrides.allModel] : undefined);
  const reviewerOverride = input.overrides.reviewerModels ??
    (input.overrides.allModel ? [input.overrides.allModel] : undefined);

  if (input.baseConfig !== undefined) {
    return resolveCouncilConfig({
      ...input.baseConfig,
      proposers: replaceParticipantModels(
        input.baseConfig.proposers,
        proposerOverride,
        "proposer",
        input.overrides.thinkingLevel,
      ),
      reviewers: replaceParticipantModels(
        input.baseConfig.reviewers,
        reviewerOverride,
        "reviewer",
        input.overrides.thinkingLevel,
      ),
    });
  }

  const proposerModels = proposerOverride ??
    input.globalConfig?.proposerModels ??
    [...DEFAULT_PROPOSER_MODELS];
  const reviewerModels = reviewerOverride ??
    input.globalConfig?.reviewerModels ??
    [...DEFAULT_REVIEWER_MODELS];
  const thinkingLevel = input.overrides.thinkingLevel ??
    input.globalConfig?.thinkingLevel ??
    DEFAULT_THINKING_LEVEL;

  return resolveCouncilConfig({
    proposers: generatedParticipants("proposer", proposerModels, thinkingLevel),
    reviewers: generatedParticipants("reviewer", reviewerModels, thinkingLevel),
    maxRounds: 4,
    consensusMode: "two_proposers_plus_all_reviewers",
    persistentSessions: true,
    workingDirectory: input.workingDirectory,
    runsDirectory: "./runs",
    sessionsDirectory: "./sessions",
    allowReadTools: true,
    allowBashDuringEvidenceChecks: false,
  });
}
