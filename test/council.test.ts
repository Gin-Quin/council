import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PromptTimeoutError } from "../src/agents/agent-adapter.ts";
import { runCouncil, type CouncilEvent } from "../src/council.ts";
import { FileTranscriptWriter, MemoryTranscriptWriter } from "../src/logging/transcript.ts";
import {
  agents,
  config,
  proposal,
  resultBlock,
  review,
  validation,
  type AgentResponses,
} from "./fixtures.ts";

describe("runCouncil", () => {
  test("preserves parallel independence and reaches 3+2 consensus", async () => {
    let initialStarted = 0;
    let releaseInitial!: () => void;
    const initialGate = new Promise<void>((resolve) => {
      releaseInitial = resolve;
    });
    let reviewsStarted = 0;
    let reviewsCompleted = 0;
    let releaseReviews!: () => void;
    const reviewGate = new Promise<void>((resolve) => {
      releaseReviews = resolve;
    });
    let revisionsStarted = 0;
    let releaseRevisions!: () => void;
    const revisionGate = new Promise<void>((resolve) => {
      releaseRevisions = resolve;
    });
    let validationsStarted = 0;
    let releaseValidations!: () => void;
    const validationGate = new Promise<void>((resolve) => {
      releaseValidations = resolve;
    });

    const councilAgents = agents({
      proposers: (["A", "B", "C"] as const).map((candidateId) => [
        async (prompt: string) => {
          expect(prompt).not.toContain("<candidate>");
          initialStarted += 1;
          if (initialStarted === 3) releaseInitial();
          await initialGate;
          return resultBlock(proposal(candidateId));
        },
        async () => {
          expect(reviewsCompleted).toBe(2);
          revisionsStarted += 1;
          if (revisionsStarted === 3) releaseRevisions();
          await revisionGate;
          return resultBlock(proposal(candidateId));
        },
      ]) as unknown as NonNullable<AgentResponses["proposers"]>,
      reviewers: (["A", "B"] as const).map(() => [
        async () => {
          expect(initialStarted).toBe(3);
          reviewsStarted += 1;
          if (reviewsStarted === 2) releaseReviews();
          await reviewGate;
          reviewsCompleted += 1;
          return resultBlock(review());
        },
        async () => {
          expect(revisionsStarted).toBe(3);
          validationsStarted += 1;
          if (validationsStarted === 2) releaseValidations();
          await validationGate;
          return resultBlock(validation());
        },
      ]) as unknown as NonNullable<AgentResponses["reviewers"]>,
    });
    const transcript = new MemoryTranscriptWriter();
    const events: CouncilEvent[] = [];

    const result = await runCouncil("Choose an architecture.", config(), {
      agents: councilAgents,
      transcript,
      runId: "parallel-test",
      onEvent: (event) => events.push(event),
    });

    expect(result.status).toBe("consensus");
    expect(result.consensus?.reached && result.consensus.cluster.members).toEqual(["A", "B"]);
    expect(councilAgents.reviewers[0].prompts[0]).toBe(councilAgents.reviewers[1].prompts[0]);
    expect(councilAgents.reviewers[0].prompts[0]).not.toContain("proposer-a");
    expect(councilAgents.reviewers[0].prompts[1]).toBe(councilAgents.reviewers[1].prompts[1]);
    expect(transcript.rounds).toHaveLength(1);
    const messageStarts = events.filter((event) => event.type === "agent_message_start");
    expect(messageStarts).toHaveLength(10);
    expect(messageStarts[0]).toMatchObject({
      route: {
        displayName: "Proposer A",
        recipient: "Orchestrator (private)",
        participantIndex: 0,
      },
    });
    expect(events.some((event) => event.type === "agent_message_delta")).toBeTrue();
    expect(events.filter((event) => event.type === "agent_message_end")).toHaveLength(10);
    expect([...councilAgents.proposers, ...councilAgents.reviewers].every((agent) => agent.disposed)).toBeTrue();
  });

  test("a blocking objection prevents consensus", async () => {
    const councilAgents = agents({
      reviewers: (["A", "B"] as const).map(() => [
        resultBlock(review()),
        resultBlock(validation({ blocked: ["A"] })),
      ]) as unknown as NonNullable<AgentResponses["reviewers"]>,
    });

    const result = await runCouncil("Choose an architecture.", config(), {
      agents: councilAgents,
      transcript: new MemoryTranscriptWriter(),
    });

    expect(result.status).toBe("max_rounds_exhausted");
    expect(result.recommendation).toBeUndefined();
  });

  test("an unresolved blocking evidence request prevents consensus", async () => {
    const councilAgents = agents({
      reviewers: (["A", "B"] as const).map(() => [
        resultBlock(review()),
        resultBlock(validation({ evidenceRequests: ["Run benchmark X"] })),
      ]) as unknown as NonNullable<AgentResponses["reviewers"]>,
    });

    const result = await runCouncil("Choose an architecture.", config(), {
      agents: councilAgents,
      transcript: new MemoryTranscriptWriter(),
    });

    expect(result.status).toBe("max_rounds_exhausted");
  });

  test("repairs malformed structured output in the same session", async () => {
    const councilAgents = agents({
      proposers: [
        ["not structured", resultBlock(proposal("A")), resultBlock(proposal("A"))],
        [resultBlock(proposal("B")), resultBlock(proposal("B"))],
        [resultBlock(proposal("C")), resultBlock(proposal("C"))],
      ],
    });

    const result = await runCouncil("Choose an architecture.", config(), {
      agents: councilAgents,
      transcript: new MemoryTranscriptWriter(),
    });

    expect(result.status).toBe("consensus");
    expect(councilAgents.proposers[0].prompts[1]).toContain("Validation error");
    expect(councilAgents.proposers[0].prompts).toHaveLength(3);
  });

  test("retries once and disposes all sessions after participant failure", async () => {
    const councilAgents = agents({
      proposers: [
        [resultBlock(proposal("A")), resultBlock(proposal("A"))],
        [new Error("first failure"), new Error("second failure")],
        [resultBlock(proposal("C")), resultBlock(proposal("C"))],
      ],
    });

    const result = await runCouncil("Choose an architecture.", config(), {
      agents: councilAgents,
      transcript: new MemoryTranscriptWriter(),
    });

    expect(result.status).toBe("participant_failure");
    expect(councilAgents.proposers[1].prompts).toHaveLength(2);
    expect([...councilAgents.proposers, ...councilAgents.reviewers].every((agent) => agent.disposed)).toBeTrue();
  });

  test("runs another compact round before converging", async () => {
    const councilAgents = agents({
      proposers: [
        [
          resultBlock(proposal("A", "one")),
          resultBlock(proposal("A", "one")),
          resultBlock(proposal("A", "shared")),
        ],
        [
          resultBlock(proposal("B", "two")),
          resultBlock(proposal("B", "two")),
          resultBlock(proposal("B", "shared")),
        ],
        [
          resultBlock(proposal("C", "three")),
          resultBlock(proposal("C", "three")),
          resultBlock(proposal("C", "three")),
        ],
      ],
      reviewers: [
        [resultBlock(review()), resultBlock(validation()), resultBlock(review()), resultBlock(validation())],
        [resultBlock(review()), resultBlock(validation()), resultBlock(review()), resultBlock(validation())],
      ],
    });
    const transcript = new MemoryTranscriptWriter();

    const result = await runCouncil("Choose an architecture.", config({ maxRounds: 2 }), {
      agents: councilAgents,
      transcript,
    });

    expect(result.status).toBe("consensus");
    expect(result.rounds).toBe(2);
    expect(transcript.rounds).toHaveLength(2);
    expect(councilAgents.proposers[0].prompts[2]).toContain(
      "The candidates retain materially different decision signatures.",
    );
  });

  test("classifies timeouts and cancellation and still disposes sessions", async () => {
    const timedOutAgents = agents({
      proposers: [
        [new PromptTimeoutError(1), new PromptTimeoutError(1)],
        [resultBlock(proposal("B"))],
        [resultBlock(proposal("C"))],
      ],
    });
    const timedOut = await runCouncil("Choose an architecture.", config(), {
      agents: timedOutAgents,
      transcript: new MemoryTranscriptWriter(),
    });
    expect(timedOut.status).toBe("timeout");
    expect([...timedOutAgents.proposers, ...timedOutAgents.reviewers].every((agent) => agent.disposed)).toBeTrue();

    const cancelledAgents = agents();
    const controller = new AbortController();
    controller.abort();
    const cancelled = await runCouncil("Choose an architecture.", config(), {
      agents: cancelledAgents,
      transcript: new MemoryTranscriptWriter(),
      signal: controller.signal,
    });
    expect(cancelled.status).toBe("cancelled");
    expect([...cancelledAgents.proposers, ...cancelledAgents.reviewers].every((agent) => agent.disposed)).toBeTrue();
  });

  test("writes a complete machine-readable run transcript", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-council-test-"));
    const result = await runCouncil("Choose an architecture.", config(), {
      agents: agents(),
      transcript: new FileTranscriptWriter(directory),
      runId: "transcript-test",
    });
    const runDirectory = join(directory, result.runId);

    expect((await readdir(runDirectory)).sort()).toEqual([
      "final.md",
      "manifest.json",
      "problem.md",
      "result.json",
      "round-01",
    ]);
    expect((await readdir(join(runDirectory, "round-01"))).sort()).toEqual([
      "clusters.json",
      "consensus.json",
      "proposals.json",
      "reviews.json",
      "revised.json",
      "validation.json",
    ]);
  });
});
