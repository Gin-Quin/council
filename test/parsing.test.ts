import { describe, expect, test } from "bun:test";
import { extractResultJson } from "../src/protocol/parsing.ts";

describe("structured result parsing", () => {
  test("rejects ambiguous multiple result blocks", () => {
    expect(() => extractResultJson("<result>{}</result><result>{}</result>")).toThrow(
      "expected exactly one",
    );
  });

  test("extracts a single result block", () => {
    expect(extractResultJson("Reasoning\n<result>{\"ok\":true}</result>")).toEqual({ ok: true });
  });
});
