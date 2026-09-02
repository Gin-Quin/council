import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CouncilAgents } from "../agents/agent-adapter.ts";
import type { CouncilConfig } from "../config.ts";
import type { CouncilResult, RoundTranscript } from "../protocol/schemas.ts";
import { hashProblem } from "../utils/hash.ts";

export type TranscriptInitialization = {
  runId: string;
  problem: string;
  config: CouncilConfig;
  agents: CouncilAgents;
};

export interface TranscriptWriter {
  initialize(input: TranscriptInitialization): Promise<void>;
  saveRound(round: RoundTranscript): Promise<void>;
  saveFinal(result: CouncilResult): Promise<void>;
}

function roundDirectoryName(round: number): string {
  return `round-${String(round).padStart(2, "0")}`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export class FileTranscriptWriter implements TranscriptWriter {
  private runDirectory: string | undefined;

  constructor(private readonly runsDirectory: string) {}

  async initialize(input: TranscriptInitialization): Promise<void> {
    this.runDirectory = join(this.runsDirectory, input.runId);
    await mkdir(this.runDirectory, { recursive: true });
    await Promise.all([
      writeFile(join(this.runDirectory, "problem.md"), `${input.problem.trim()}\n`, "utf8"),
      writeJson(join(this.runDirectory, "manifest.json"), {
        runId: input.runId,
        createdAt: new Date().toISOString(),
        problemHash: hashProblem(input.problem),
        consensusMode: input.config.consensusMode,
        maxRounds: input.config.maxRounds,
        persistentSessions: input.config.persistentSessions,
        participants: Object.fromEntries(
          [...input.config.proposers, ...input.config.reviewers].map((participant, index) => {
            const agents = [...input.agents.proposers, ...input.agents.reviewers];
            return [
              participant.id,
              {
                role: participant.role,
                provider: participant.provider,
                model: participant.model,
                thinkingLevel: participant.thinkingLevel ?? "high",
                sessionFile: agents[index]?.sessionFile,
              },
            ];
          }),
        ),
      }),
    ]);
  }

  async saveRound(round: RoundTranscript): Promise<void> {
    const runDirectory = this.requireRunDirectory();
    const directory = join(runDirectory, roundDirectoryName(round.round));
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeJson(join(directory, "proposals.json"), round.proposals),
      writeJson(join(directory, "reviews.json"), round.reviews),
      writeJson(join(directory, "revised.json"), round.revised),
      writeJson(join(directory, "validation.json"), round.validations),
      writeJson(join(directory, "clusters.json"), round.clusters),
      writeJson(join(directory, "consensus.json"), round.consensus),
    ]);
  }

  async saveFinal(result: CouncilResult): Promise<void> {
    const runDirectory = this.requireRunDirectory();
    await Promise.all([
      writeJson(join(runDirectory, "result.json"), result),
      writeFile(join(runDirectory, "final.md"), renderFinalMarkdown(result), "utf8"),
    ]);
  }

  private requireRunDirectory(): string {
    if (this.runDirectory === undefined) throw new Error("transcript has not been initialized");
    return this.runDirectory;
  }
}

export class MemoryTranscriptWriter implements TranscriptWriter {
  initialization: TranscriptInitialization | undefined;
  readonly rounds: RoundTranscript[] = [];
  final: CouncilResult | undefined;

  async initialize(input: TranscriptInitialization): Promise<void> {
    this.initialization = input;
  }

  async saveRound(round: RoundTranscript): Promise<void> {
    this.rounds.push(round);
  }

  async saveFinal(result: CouncilResult): Promise<void> {
    this.final = result;
  }
}

export function renderFinalMarkdown(result: CouncilResult): string {
  const status = result.status === "consensus" ? "Consensus" : result.status;
  const recommendation = result.recommendation?.approach ?? "No candidate reached consensus.";
  const why = result.consensus?.reached
    ? `Both reviewers accepted the equivalent candidate cluster ${result.consensus.cluster.members.join(", ")}.`
    : result.error ?? "The configured consensus threshold was not reached.";
  const tradeoffs = result.recommendation?.risks.length
    ? result.recommendation.risks.map((risk) => `- ${risk}`).join("\n")
    : "- None recorded.";
  const minority = result.minorityPositions.length
    ? result.minorityPositions
        .map((candidate) => `### Candidate ${candidate.candidateId}\n\n${candidate.summary}`)
        .join("\n\n")
    : "No materially distinct minority position was retained.";

  return `# Council decision

## Status

${status}

## Final recommendation

${recommendation}

## Why

${why}

## Important tradeoffs

${tradeoffs}

## Minority position

${minority}
`;
}
