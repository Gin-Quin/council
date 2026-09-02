#!/usr/bin/env bun

import { main } from "./cli/main.ts";

process.exitCode = await main(Bun.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Run `council help` for usage.");
  return 1;
});
