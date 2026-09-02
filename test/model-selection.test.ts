import { describe, expect, test } from "bun:test";
import { resolveModelConfiguration } from "../src/cli/model-selection.ts";
import { config } from "./fixtures.ts";

describe("CLI model configuration", () => {
  test("uses the requested diverse 3+2 defaults at high thinking", () => {
    const resolved = resolveModelConfiguration({
      overrides: {},
      workingDirectory: process.cwd(),
    });

    expect(resolved.proposers.map(({ provider, model }) => `${provider}/${model}`)).toEqual([
      "openai/gpt-5.6-sol",
      "anthropic/claude-fable-5-1",
      "moonshotai/kimi-k3",
    ]);
    expect(resolved.reviewers.map(({ provider, model }) => `${provider}/${model}`)).toEqual([
      "openai/gpt-5.6-sol",
      "anthropic/claude-fable-5-1",
    ]);
    expect([...resolved.proposers, ...resolved.reviewers].every(
      ({ thinkingLevel }) => thinkingLevel === "high",
    )).toBeTrue();
  });

  test("expands a one-off --model selection to all five participants", () => {
    const resolved = resolveModelConfiguration({
      overrides: { allModel: "openrouter/anthropic/claude-sonnet" },
      workingDirectory: process.cwd(),
    });

    expect([...resolved.proposers, ...resolved.reviewers]).toHaveLength(5);
    expect([...resolved.proposers, ...resolved.reviewers].every((participant) =>
      participant.provider === "openrouter" && participant.model === "anthropic/claude-sonnet"
    )).toBeTrue();
  });

  test("uses one or independently configured role models from global config", () => {
    const resolved = resolveModelConfiguration({
      globalConfig: {
        version: 1,
        proposerModels: ["openai/a", "anthropic/b", "google/c"],
        reviewerModels: ["anthropic/d", "openai/e"],
        thinkingLevel: "medium",
      },
      overrides: {},
      workingDirectory: process.cwd(),
    });

    expect(resolved.proposers.map(({ provider, model }) => `${provider}/${model}`)).toEqual([
      "openai/a",
      "anthropic/b",
      "google/c",
    ]);
    expect(resolved.reviewers.map(({ provider, model }) => `${provider}/${model}`)).toEqual([
      "anthropic/d",
      "openai/e",
    ]);
    expect([...resolved.proposers, ...resolved.reviewers].every(
      ({ thinkingLevel }) => thinkingLevel === "medium",
    )).toBeTrue();
  });

  test("prompt flags override file participants without changing their identities", () => {
    const resolved = resolveModelConfiguration({
      baseConfig: config(),
      overrides: {
        proposerModels: ["openai/one"],
        reviewerModels: ["anthropic/left", "openai/right"],
        thinkingLevel: "xhigh",
      },
      workingDirectory: process.cwd(),
    });

    expect(resolved.proposers.map(({ id }) => id)).toEqual([
      "proposer-a",
      "proposer-b",
      "proposer-c",
    ]);
    expect(resolved.proposers.every(({ model }) => model === "one")).toBeTrue();
    expect(resolved.reviewers.map(({ model }) => model)).toEqual(["left", "right"]);
    expect([...resolved.proposers, ...resolved.reviewers].every(
      ({ thinkingLevel }) => thinkingLevel === "xhigh",
    )).toBeTrue();
  });

  test("fills an unspecified role from defaults and rejects incorrectly sized selections", () => {
    const partiallyOverridden = resolveModelConfiguration({
      overrides: { proposerModels: ["openai/a"] },
      workingDirectory: process.cwd(),
    });
    expect(partiallyOverridden.reviewers.map(({ provider, model }) => `${provider}/${model}`)).toEqual([
      "openai/gpt-5.6-sol",
      "anthropic/claude-fable-5-1",
    ]);
    expect(() =>
      resolveModelConfiguration({
        overrides: {
          proposerModels: ["openai/a", "openai/b"],
          reviewerModels: ["openai/c"],
        },
        workingDirectory: process.cwd(),
      }),
    ).toThrow("provide one proposer model or exactly 3");
  });
});
