import { describe, expect, test } from "bun:test";
import { clusterEquivalentCandidates, hasConsensus } from "../src/protocol/consensus.ts";
import { proposal, validation } from "./fixtures.ts";

describe("consensus", () => {
  test("clusters signatures independent of casing, whitespace, and list order", () => {
    const a = proposal("A", "shared");
    const b = proposal("B", "shared");
    b.decisionSignature.architecture = ["  SHARED   ARCHITECTURE "];
    b.decisionSignature.mandatoryChoices = { STRATEGY: "SHARED" };

    expect(clusterEquivalentCandidates([a, b, proposal("C")])[0]?.members).toEqual(["A", "B"]);
  });

  test("requires both reviewer validations", () => {
    const clusters = clusterEquivalentCandidates([
      proposal("A"),
      proposal("B"),
      proposal("C"),
    ]);
    expect(
      hasConsensus({
        clusters,
        validations: [validation()],
        mode: "two_proposers_plus_all_reviewers",
      }),
    ).toEqual({ reached: false, reasons: ["exactly two reviewer validations are required"] });
  });

  test("strict mode requires all three proposers to converge", () => {
    const clusters = clusterEquivalentCandidates([
      proposal("A"),
      proposal("B"),
      proposal("C"),
    ]);
    expect(
      hasConsensus({
        clusters,
        validations: [validation(), validation()],
        mode: "unanimous_all_five",
      }).reached,
    ).toBeFalse();
  });
});
