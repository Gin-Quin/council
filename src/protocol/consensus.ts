import type {
  CandidateCluster,
  CandidateId,
  ConsensusResult,
  FinalValidation,
  Proposal,
} from "./schemas.ts";

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function decisionSignatureKey(proposal: Proposal): string {
  const choices = Object.fromEntries(
    Object.entries(proposal.decisionSignature.mandatoryChoices)
      .map(([key, value]) => [normalizeText(key), normalizeText(value)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return JSON.stringify({
    architecture: proposal.decisionSignature.architecture.map(normalizeText).sort(),
    mandatoryChoices: choices,
    rejectedAlternatives: proposal.decisionSignature.rejectedAlternatives.map(normalizeText).sort(),
  });
}

export function clusterEquivalentCandidates(candidates: Proposal[]): CandidateCluster[] {
  const groups = new Map<string, CandidateId[]>();
  for (const candidate of candidates) {
    const key = decisionSignatureKey(candidate);
    groups.set(key, [...(groups.get(key) ?? []), candidate.candidateId]);
  }
  return [...groups.values()].map((members, index) => ({
    id: `cluster-${index + 1}`,
    members,
  }));
}

function reviewerAcceptsCluster(validation: FinalValidation, cluster: CandidateCluster): boolean {
  return cluster.members.every((candidateId) => {
    const evaluation = validation.candidateEvaluations.find(
      (candidate) => candidate.candidateId === candidateId,
    );
    return (
      evaluation?.status === "accept" &&
      evaluation.blockingObjections.length === 0
    );
  });
}

export function hasConsensus(input: {
  clusters: CandidateCluster[];
  validations: FinalValidation[];
  mode: "two_proposers_plus_all_reviewers" | "unanimous_all_five";
}): ConsensusResult {
  if (input.validations.length !== 2) {
    return { reached: false, reasons: ["exactly two reviewer validations are required"] };
  }
  if (input.validations.some(({ remainingEvidenceRequests }) => remainingEvidenceRequests.length > 0)) {
    return { reached: false, reasons: ["blocking evidence remains unresolved"] };
  }

  const requiredMembers = input.mode === "unanimous_all_five" ? 3 : 2;
  const cluster = input.clusters.find(
    (candidateCluster) =>
      candidateCluster.members.length >= requiredMembers &&
      input.validations.every((validation) => reviewerAcceptsCluster(validation, candidateCluster)),
  );

  if (cluster !== undefined) return { reached: true, cluster };

  return {
    reached: false,
    reasons: [
      input.mode === "unanimous_all_five"
        ? "all three proposers have not converged on a reviewer-approved signature"
        : "fewer than two proposers share a signature accepted by both reviewers",
    ],
  };
}
