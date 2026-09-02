import { describe, expect, test } from "bun:test";
import { AgentTerminalRenderer } from "../src/cli/terminal-renderer.ts";
import type { AgentMessageRoute } from "../src/council.ts";

function route(index: number, name: string): AgentMessageRoute {
  return {
    messageId: `message-${index}`,
    participantId: `agent-${index}`,
    displayName: name,
    recipient: "Reviewers",
    participantIndex: index,
    stage: "revision",
    round: 1,
  };
}

describe("AgentTerminalRenderer", () => {
  test("prefixes every logical message line and identifies the route", () => {
    const lines: string[] = [];
    const renderer = new AgentTerminalRenderer({ writeLine: (line) => lines.push(line), color: false });
    const agent = route(0, "Proposer A");

    renderer.handle({ type: "agent_message_start", route: agent });
    renderer.handle({ type: "agent_message_delta", messageId: agent.messageId, delta: "first" });
    renderer.handle({ type: "agent_message_delta", messageId: agent.messageId, delta: " line\nsecond\n" });
    renderer.handle({ type: "agent_message_delta", messageId: agent.messageId, delta: "third" });
    renderer.handle({ type: "agent_message_end", messageId: agent.messageId });

    expect(lines).toEqual([
      "│ Proposer A → Reviewers · revision · round 1",
      "│ first line",
      "│ second",
      "│ third",
    ]);
    expect(lines.every((line) => line.startsWith("│"))).toBeTrue();
  });

  test("assigns a distinct ANSI color to each of the five standing agents", () => {
    const lines: string[] = [];
    const renderer = new AgentTerminalRenderer({ writeLine: (line) => lines.push(line), color: true });

    for (let index = 0; index < 5; index += 1) {
      const agent = route(index, index < 3 ? `Proposer ${index + 1}` : `Reviewer ${index - 2}`);
      renderer.handle({ type: "agent_message_start", route: agent });
      renderer.handle({ type: "agent_message_delta", messageId: agent.messageId, delta: "message\n" });
      renderer.handle({ type: "agent_message_end", messageId: agent.messageId });
    }

    const borderColors = lines
      .filter((_line, index) => index % 2 === 0)
      .map((line) => line.match(/\u001B\[(\d+)m│/u)?.[1]);
    expect(new Set(borderColors).size).toBe(5);
    expect(lines.every((line) => line.includes("\u001B[") && line.includes("│"))).toBeTrue();
  });

  test("keeps concurrent partial lines separate", () => {
    const lines: string[] = [];
    const renderer = new AgentTerminalRenderer({ writeLine: (line) => lines.push(line), color: false });
    const proposer = route(0, "Proposer A");
    const reviewer = route(3, "Reviewer A");

    renderer.handle({ type: "agent_message_start", route: proposer });
    renderer.handle({ type: "agent_message_start", route: reviewer });
    renderer.handle({ type: "agent_message_delta", messageId: proposer.messageId, delta: "partial" });
    renderer.handle({ type: "agent_message_delta", messageId: reviewer.messageId, delta: "review\n" });
    renderer.handle({ type: "agent_message_delta", messageId: proposer.messageId, delta: " proposer\n" });
    renderer.handle({ type: "agent_message_end", messageId: proposer.messageId });
    renderer.handle({ type: "agent_message_end", messageId: reviewer.messageId });

    expect(lines).toContain("│ review");
    expect(lines).toContain("│ partial proposer");
  });
});
