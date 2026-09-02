import { z } from "zod";
import {
  PromptAbortedError,
  PromptTimeoutError,
  type CouncilAgents,
} from "./agents/agent-adapter.ts";
import { createPiCouncilAgents } from "./agents/pi-agent-adapter.ts";
import type { CouncilConfig } from "./config.ts";
import {
  FileTranscriptWriter,
  type TranscriptWriter,
} from "./logging/transcript.ts";
import { clusterEquivalentCandidates, hasConsensus } from "./protocol/consensus.ts";
import { ParticipantError, askForStructuredResult } from "./protocol/parsing.ts";
import {
  disagreementsFrom,
  initialProposalPrompt,
  reviewPrompt,
  revisionPrompt,
  validationPrompt,
} from "./protocol/prompts.ts";
import {
  candidateIdSchema,
  finalValidationSchema,
  proposalSchema,
  reviewSchema,
  type CandidateId,
  type CouncilResult,
  type FinalValidation,
  type Proposal,
  type RoundTranscript,
} from "./protocol/schemas.ts";
import { createRunId } from "./utils/hash.ts";

const CANDIDATE_IDS = candidateIdSchema.options;

class CouncilTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CouncilTimeoutError";
  }
}

export type RunCouncilOptions = {
  agents?: CouncilAgents;
  transcript?: TranscriptWriter;
  runId?: string;
  onEvent?: (event: CouncilEvent) => void;
  signal?: AbortSignal;
};

export type CouncilEvent =
  | { type: "run_started"; runId: string }
  | {
      type: "stage_complete";
      stage: "initial_proposals" | "reviews" | "revisions" | "validations";
      round?: number;
    }
  | { type: "consensus_reached"; round: number; members: CandidateId[] }
  | { type: "round_complete"; round: number; consensus: boolean }
  | { type: "agent_message_start"; route: AgentMessageRoute }
  | { type: "agent_message_delta"; messageId: string; delta: string }
  | { type: "agent_message_end"; messageId: string };

export type AgentMessageStage = "initial_proposal" | "review" | "revision" | "validation";

export type AgentMessageRoute = {
  messageId: string;
  participantId: string;
  displayName: string;
  recipient: string;
  participantIndex: number;
  stage: AgentMessageStage;
  round?: number;
};

function candidateProposalSchema(candidateId: CandidateId) {
  return proposalSchema.refine((proposal) => proposal.candidateId === candidateId, {
    message: `candidateId must be ${candidateId}`,
    path: ["candidateId"],
  });
}

function callTimeout(config: CouncilConfig, deadline: number, signal?: AbortSignal): number {
  if (signal?.aborted) throw new PromptAbortedError();
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new CouncilTimeoutError("overall council timeout reached");
  return Math.min(config.callTimeoutMs, remaining);
}

function structuredInput<T>(input: {
  agent: CouncilAgents["proposers"][number] | CouncilAgents["reviewers"][number];
  prompt: string;
  schema: z.ZodType<T>;
  config: CouncilConfig;
  deadline: number;
  signal: AbortSignal | undefined;
  onText: ((delta: string) => void) | undefined;
}) {
  const base = {
    agent: input.agent,
    prompt: input.prompt,
    schema: input.schema,
    timeoutMs: callTimeout(input.config, input.deadline, input.signal),
    participantRetries: input.config.participantRetries,
  };
  return {
    ...base,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.onText === undefined ? {} : { onText: input.onText }),
  };
}

function agentRoute(input: {
  runId: string;
  participantId: string;
  role: "Proposer" | "Reviewer";
  roleIndex: number;
  stage: AgentMessageStage;
  recipient: string;
  round?: number;
}): AgentMessageRoute {
  const participantIndex = input.role === "Proposer" ? input.roleIndex : input.roleIndex + 3;
  const roundPart = input.round === undefined ? "initial" : `round-${input.round}`;
  return {
    messageId: `${input.runId}:${roundPart}:${input.stage}:${input.participantId}`,
    participantId: input.participantId,
    displayName: `${input.role} ${String.fromCharCode(65 + input.roleIndex)}`,
    recipient: input.recipient,
    participantIndex,
    stage: input.stage,
    ...(input.round === undefined ? {} : { round: input.round }),
  };
}

async function askCouncilAgent<T>(input: {
  agent: CouncilAgents["proposers"][number] | CouncilAgents["reviewers"][number];
  prompt: string;
  schema: z.ZodType<T>;
  config: CouncilConfig;
  deadline: number;
  signal: AbortSignal | undefined;
  route: AgentMessageRoute;
  onEvent: RunCouncilOptions["onEvent"];
}): Promise<T> {
  input.onEvent?.({ type: "agent_message_start", route: input.route });
  try {
    return await askForStructuredResult(
      structuredInput({
        agent: input.agent,
        prompt: input.prompt,
        schema: input.schema,
        config: input.config,
        deadline: input.deadline,
        signal: input.signal,
        onText: input.onEvent === undefined
          ? undefined
          : (delta) => input.onEvent?.({
              type: "agent_message_delta",
              messageId: input.route.messageId,
              delta,
            }),
      }),
    );
  } finally {
    input.onEvent?.({ type: "agent_message_end", messageId: input.route.messageId });
  }
}

function errorChainContains(error: unknown, predicate: (candidate: Error) => boolean): boolean {
  let current = error;
  while (current instanceof Error) {
    if (predicate(current)) return true;
    current = current.cause;
  }
  return false;
}

async function disposeAgents(agents: CouncilAgents | undefined): Promise<void> {
  if (agents === undefined) return;
  await Promise.allSettled(
    [...agents.proposers, ...agents.reviewers].map((agent) => agent.dispose()),
  );
}

function chooseRecommendation(
  candidates: Proposal[],
  consensus: Extract<RoundTranscript["consensus"], { reached: true }>,
): Proposal {
  const recommendation = candidates.find(({ candidateId }) =>
    consensus.cluster.members.includes(candidateId),
  );
  if (recommendation === undefined) throw new Error("consensus cluster has no candidate");
  return recommendation;
}

export async function runCouncil(
  problem: string,
  config: CouncilConfig,
  options: RunCouncilOptions = {},
): Promise<CouncilResult> {
  if (problem.trim().length === 0) throw new Error("problem must not be empty");

  const runId = options.runId ?? createRunId();
  const transcript = options.transcript ?? new FileTranscriptWriter(config.runsDirectory);
  const deadline = Date.now() + config.overallTimeoutMs;
  let agents = options.agents;
  let candidates: Proposal[] = [];
  let validations: FinalValidation[] = [];
  let completedRounds = 0;

  try {
    options.onEvent?.({ type: "run_started", runId });
    agents ??= await createPiCouncilAgents(config, runId);
    await transcript.initialize({ runId, problem, config, agents });

    candidates = await Promise.all(
      agents.proposers.map((agent, index) => {
        const candidateId = CANDIDATE_IDS[index]!;
        return askCouncilAgent({
          agent,
          prompt: initialProposalPrompt(problem, candidateId),
          schema: candidateProposalSchema(candidateId),
          config,
          deadline,
          signal: options.signal,
          route: agentRoute({
            runId,
            participantId: agent.id,
            role: "Proposer",
            roleIndex: index,
            stage: "initial_proposal",
            recipient: "Orchestrator (private)",
          }),
          onEvent: options.onEvent,
        });
      }),
    );
    options.onEvent?.({ type: "stage_complete", stage: "initial_proposals" });

    let unresolvedDisagreements: string[] = [];
    for (let round = 1; round <= config.maxRounds; round += 1) {
      const proposals = candidates;
      const sharedReviewPrompt = reviewPrompt(problem, proposals);
      const reviews = await Promise.all(
        agents.reviewers.map((agent, index) =>
          askCouncilAgent({
            agent,
            prompt: sharedReviewPrompt,
            schema: reviewSchema,
            config,
            deadline,
            signal: options.signal,
            route: agentRoute({
              runId,
              participantId: agent.id,
              role: "Reviewer",
              roleIndex: index,
              stage: "review",
              recipient: "Proposers",
              round,
            }),
            onEvent: options.onEvent,
          }),
        ),
      );
      options.onEvent?.({ type: "stage_complete", stage: "reviews", round });

      const revised = await Promise.all(
        agents.proposers.map((agent, index) => {
          const candidateId = CANDIDATE_IDS[index]!;
          return askCouncilAgent({
            agent,
            prompt: revisionPrompt({
              problem,
              round,
              candidateId,
              candidates: proposals,
              reviews,
              ownPrevious: proposals[index]!,
              unresolvedDisagreements,
            }),
            schema: candidateProposalSchema(candidateId),
            config,
            deadline,
            signal: options.signal,
            route: agentRoute({
              runId,
              participantId: agent.id,
              role: "Proposer",
              roleIndex: index,
              stage: "revision",
              recipient: "Reviewers",
              round,
            }),
            onEvent: options.onEvent,
          });
        }),
      );
      options.onEvent?.({ type: "stage_complete", stage: "revisions", round });

      const clusters = clusterEquivalentCandidates(revised);
      const sharedValidationPrompt = validationPrompt({
        problem,
        candidates: revised,
        priorReviews: reviews,
      });
      validations = await Promise.all(
        agents.reviewers.map((agent, index) =>
          askCouncilAgent({
            agent,
            prompt: sharedValidationPrompt,
            schema: finalValidationSchema,
            config,
            deadline,
            signal: options.signal,
            route: agentRoute({
              runId,
              participantId: agent.id,
              role: "Reviewer",
              roleIndex: index,
              stage: "validation",
              recipient: "Orchestrator",
              round,
            }),
            onEvent: options.onEvent,
          }),
        ),
      );
      options.onEvent?.({ type: "stage_complete", stage: "validations", round });

      const consensus = hasConsensus({
        clusters,
        validations,
        mode: config.consensusMode,
      });
      const roundTranscript: RoundTranscript = {
        round,
        proposals,
        reviews,
        revised,
        validations,
        clusters,
        consensus,
      };
      await transcript.saveRound(roundTranscript);
      options.onEvent?.({ type: "round_complete", round, consensus: consensus.reached });
      completedRounds = round;
      candidates = revised;

      if (consensus.reached) {
        options.onEvent?.({
          type: "consensus_reached",
          round,
          members: consensus.cluster.members,
        });
        const recommendation = chooseRecommendation(candidates, consensus);
        const result: CouncilResult = {
          runId,
          status: "consensus",
          rounds: round,
          recommendation,
          consensus,
          candidates,
          validations,
          minorityPositions: candidates.filter(
            ({ candidateId }) => !consensus.cluster.members.includes(candidateId),
          ),
        };
        await transcript.saveFinal(result);
        return result;
      }

      unresolvedDisagreements = disagreementsFrom(candidates, validations);
    }

    const result: CouncilResult = {
      runId,
      status: "max_rounds_exhausted",
      rounds: completedRounds,
      candidates,
      validations,
      minorityPositions: candidates,
      error: "No consensus was reached before maxRounds. The MVP does not force a winner or create an arbiter.",
    };
    await transcript.saveFinal(result);
    return result;
  } catch (error) {
    const status = errorChainContains(error, (candidate) => candidate instanceof PromptAbortedError)
      ? "cancelled"
      : error instanceof CouncilTimeoutError ||
          errorChainContains(error, (candidate) => candidate instanceof PromptTimeoutError)
        ? "timeout"
        : "participant_failure";
    const result: CouncilResult = {
      runId,
      status,
      rounds: completedRounds,
      candidates,
      validations,
      minorityPositions: candidates,
      error:
        error instanceof ParticipantError || error instanceof Error
          ? error.message
          : String(error),
    };
    try {
      await transcript.saveFinal(result);
    } catch {
      // Initialization itself may have failed; preserve the primary error in the result.
    }
    return result;
  } finally {
    await disposeAgents(agents);
  }
}
