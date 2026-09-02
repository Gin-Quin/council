import type { CouncilAgents } from "../src/agents/agent-adapter.ts";
import { FakeAgentAdapter, type FakeResponse } from "../src/agents/fake-agent-adapter.ts";
import { resolveCouncilConfig, type CouncilConfig } from "../src/config.ts";
import type {
  CandidateId,
  FinalValidation,
  Proposal,
  Review,
} from "../src/protocol/schemas.ts";

export function resultBlock(value: unknown): string {
  return `<result>${JSON.stringify(value)}</result>`;
}

export function proposal(
  candidateId: CandidateId,
  signature = candidateId === "C" ? "alternative" : "shared",
): Proposal {
  return {
    candidateId,
    summary: `Candidate ${candidateId} summary`,
    approach: `Candidate ${candidateId} complete approach`,
    keyDecisions: [`use ${signature}`],
    assumptions: ["the stated constraints hold"],
    risks: ["a documented risk"],
    evidenceNeeded: [],
    confidence: 0.8,
    decisionSignature: {
      architecture: [`${signature} architecture`],
      mandatoryChoices: { strategy: signature },
      rejectedAlternatives: [`not ${signature}`],
    },
  };
}

export function review(status: "approve" | "approve_with_reservations" | "reject" = "approve"): Review {
  return {
    reviews: (["A", "B", "C"] as const).map((candidateId) => ({
      candidateId,
      strengths: ["clear"],
      materialProblems: status === "reject" ? ["material problem"] : [],
      unresolvedQuestions: [],
      evidenceRequests: [],
      status,
    })),
    preferredCandidate: "A",
    preferredRationale: "It is practical.",
    crossCuttingConcerns: [],
  };
}

export function validation(input: {
  blocked?: CandidateId[];
  evidenceRequests?: string[];
} = {}): FinalValidation {
  const blocked = new Set(input.blocked ?? []);
  return {
    candidateEvaluations: (["A", "B", "C"] as const).map((candidateId) => ({
      candidateId,
      status: blocked.has(candidateId) ? "block" : "accept",
      blockingObjections: blocked.has(candidateId) ? ["blocking defect"] : [],
      nonBlockingReservations: [],
    })),
    preferredCandidate: "equivalent_set",
    equivalentCandidates: ["A", "B"],
    remainingEvidenceRequests: input.evidenceRequests ?? [],
  };
}

export function config(overrides: Partial<CouncilConfig> = {}): CouncilConfig {
  return resolveCouncilConfig({
    proposers: (["a", "b", "c"] as const).map((suffix) => ({
      id: `proposer-${suffix}`,
      role: "proposer" as const,
      provider: "fake",
      model: `model-${suffix}`,
    })),
    reviewers: (["a", "b"] as const).map((suffix) => ({
      id: `reviewer-${suffix}`,
      role: "reviewer" as const,
      provider: "fake",
      model: `model-${suffix}`,
    })),
    maxRounds: 1,
    consensusMode: "two_proposers_plus_all_reviewers",
    persistentSessions: false,
    workingDirectory: process.cwd(),
    runsDirectory: "./runs",
    sessionsDirectory: "./sessions",
    callTimeoutMs: 5_000,
    overallTimeoutMs: 30_000,
    participantRetries: 1,
    ...overrides,
  });
}

export type AgentResponses = {
  proposers?: [FakeResponse[], FakeResponse[], FakeResponse[]];
  reviewers?: [FakeResponse[], FakeResponse[]];
};

export function agents(input: AgentResponses = {}): CouncilAgents & {
  proposers: [FakeAgentAdapter, FakeAgentAdapter, FakeAgentAdapter];
  reviewers: [FakeAgentAdapter, FakeAgentAdapter];
} {
  const defaultProposers = (["A", "B", "C"] as const).map((candidateId) => [
    resultBlock(proposal(candidateId)),
    resultBlock(proposal(candidateId)),
  ]) as [FakeResponse[], FakeResponse[], FakeResponse[]];
  const defaultReviewers = (["A", "B"] as const).map(() => [
    resultBlock(review()),
    resultBlock(validation()),
  ]) as [FakeResponse[], FakeResponse[]];

  const proposerResponses = input.proposers ?? defaultProposers;
  const reviewerResponses = input.reviewers ?? defaultReviewers;
  return {
    proposers: [
      new FakeAgentAdapter("proposer-a", proposerResponses[0]),
      new FakeAgentAdapter("proposer-b", proposerResponses[1]),
      new FakeAgentAdapter("proposer-c", proposerResponses[2]),
    ],
    reviewers: [
      new FakeAgentAdapter("reviewer-a", reviewerResponses[0]),
      new FakeAgentAdapter("reviewer-b", reviewerResponses[1]),
    ],
  };
}
