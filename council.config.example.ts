import type { CouncilConfigInput } from "./src/config.ts";

export default {
  proposers: [
    { id: "proposer-a", role: "proposer", provider: "openai", model: "gpt-5.6-sol", thinkingLevel: "high" },
    { id: "proposer-b", role: "proposer", provider: "anthropic", model: "claude-fable-5-1", thinkingLevel: "high" },
    { id: "proposer-c", role: "proposer", provider: "moonshotai", model: "kimi-k3", thinkingLevel: "high" },
  ],
  reviewers: [
    { id: "reviewer-a", role: "reviewer", provider: "openai", model: "gpt-5.6-sol", thinkingLevel: "high" },
    { id: "reviewer-b", role: "reviewer", provider: "anthropic", model: "claude-fable-5-1", thinkingLevel: "high" },
  ],
  maxRounds: 4,
  consensusMode: "two_proposers_plus_all_reviewers",
  persistentSessions: true,
  workingDirectory: process.cwd(),
  runsDirectory: "./runs",
  sessionsDirectory: "./sessions",
  allowReadTools: true,
  allowBashDuringEvidenceChecks: false,
} satisfies CouncilConfigInput;
