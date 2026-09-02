import { createHash, randomUUID } from "node:crypto";

export function hashProblem(problem: string): string {
  return createHash("sha256").update(problem).digest("hex");
}

export function createRunId(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[:.]/gu, "-");
  return `run-${timestamp}-${randomUUID().slice(0, 8)}`;
}
