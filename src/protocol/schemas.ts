import { z } from "zod";

export const candidateIdSchema = z.enum(["A", "B", "C"]);
export type CandidateId = z.infer<typeof candidateIdSchema>;

export const decisionSignatureSchema = z
  .object({
    architecture: z.array(z.string().min(1)),
    mandatoryChoices: z.record(z.string(), z.string().min(1)),
    rejectedAlternatives: z.array(z.string().min(1)),
  })
  .strict();

export const proposalSchema = z
  .object({
    candidateId: candidateIdSchema,
    summary: z.string().min(1),
    approach: z.string().min(1),
    keyDecisions: z.array(z.string().min(1)),
    assumptions: z.array(z.string().min(1)),
    risks: z.array(z.string().min(1)),
    evidenceNeeded: z.array(z.string().min(1)),
    confidence: z.number().min(0).max(1),
    decisionSignature: decisionSignatureSchema,
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;

export const candidateReviewSchema = z
  .object({
    candidateId: candidateIdSchema,
    strengths: z.array(z.string()),
    materialProblems: z.array(z.string()),
    unresolvedQuestions: z.array(z.string()),
    evidenceRequests: z.array(z.string()),
    status: z.enum(["approve", "approve_with_reservations", "reject"]),
  })
  .strict();

function containsEveryCandidateId(values: Array<{ candidateId: CandidateId }>): boolean {
  return new Set(values.map(({ candidateId }) => candidateId)).size === 3;
}

export const reviewSchema = z
  .object({
    reviews: z.array(candidateReviewSchema).length(3),
    preferredCandidate: z.enum(["A", "B", "C", "hybrid", "none"]),
    preferredRationale: z.string().min(1),
    proposedHybrid: z.string().min(1).optional(),
    crossCuttingConcerns: z.array(z.string()),
  })
  .strict()
  .refine(({ reviews }) => containsEveryCandidateId(reviews), {
    message: "reviews must contain Candidate A, B, and C exactly once",
    path: ["reviews"],
  });
export type Review = z.infer<typeof reviewSchema>;

export const candidateEvaluationSchema = z
  .object({
    candidateId: candidateIdSchema,
    status: z.enum(["accept", "block"]),
    blockingObjections: z.array(z.string()),
    nonBlockingReservations: z.array(z.string()),
  })
  .strict()
  .superRefine((evaluation, context) => {
    if (evaluation.status === "accept" && evaluation.blockingObjections.length > 0) {
      context.addIssue({
        code: "custom",
        message: "an accepted candidate cannot have blocking objections",
        path: ["blockingObjections"],
      });
    }
  });

export const finalValidationSchema = z
  .object({
    candidateEvaluations: z.array(candidateEvaluationSchema).length(3),
    preferredCandidate: z.union([candidateIdSchema, z.enum(["equivalent_set", "none"])]),
    equivalentCandidates: z.array(candidateIdSchema),
    remainingEvidenceRequests: z.array(z.string()),
  })
  .strict()
  .refine(({ candidateEvaluations }) => containsEveryCandidateId(candidateEvaluations), {
    message: "candidateEvaluations must contain Candidate A, B, and C exactly once",
    path: ["candidateEvaluations"],
  });
export type FinalValidation = z.infer<typeof finalValidationSchema>;

export const candidateClusterSchema = z
  .object({
    id: z.string().min(1),
    members: z.array(candidateIdSchema).min(1),
  })
  .strict();
export type CandidateCluster = z.infer<typeof candidateClusterSchema>;

export const consensusResultSchema = z.discriminatedUnion("reached", [
  z
    .object({
      reached: z.literal(true),
      cluster: candidateClusterSchema,
    })
    .strict(),
  z
    .object({
      reached: z.literal(false),
      reasons: z.array(z.string()),
    })
    .strict(),
]);
export type ConsensusResult = z.infer<typeof consensusResultSchema>;

export type RoundTranscript = {
  round: number;
  proposals: Proposal[];
  reviews: Review[];
  revised: Proposal[];
  validations: FinalValidation[];
  clusters: CandidateCluster[];
  consensus: ConsensusResult;
};

export type CouncilResult = {
  runId: string;
  status:
    | "consensus"
    | "max_rounds_exhausted"
    | "participant_failure"
    | "timeout"
    | "cancelled";
  rounds: number;
  recommendation?: Proposal;
  consensus?: ConsensusResult;
  candidates: Proposal[];
  validations: FinalValidation[];
  minorityPositions: Proposal[];
  error?: string;
};
