import { describe, expect, test } from "bun:test";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../src/cli/main.ts";
import { globalConfigPath, readGlobalConfig } from "../src/cli/global-config.ts";
import { config } from "./fixtures.ts";

function capture(directory: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    dependencies: {
      cwd: directory,
      globalConfigFile: join(directory, "config.json"),
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
  };
}

describe("CLI discovery and global configuration", () => {
  test("offers command and topic help without configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-council-cli-"));
    const output = capture(directory);

    expect(await main([], output.dependencies)).toBe(0);
    expect(output.stdout.join("\n")).toContain("council help examples");
    output.stdout.length = 0;
    expect(await main(["help", "config"], output.dependencies)).toBe(0);
    expect(output.stdout.join("\n")).toContain("council config set");
    output.stdout.length = 0;
    expect(await main(["models", "--help"], output.dependencies)).toBe(0);
    expect(output.stdout.join("\n")).toContain("does not make an inference call");
  });

  test("persists and displays global model defaults", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-council-cli-"));
    const output = capture(directory);

    expect(
      await main(
        ["config", "set", "--model", "openai/gpt-test", "--thinking-level", "high"],
        output.dependencies,
      ),
    ).toBe(0);
    expect(await readGlobalConfig(output.dependencies.globalConfigFile)).toEqual({
      version: 1,
      proposerModels: ["openai/gpt-test"],
      reviewerModels: ["openai/gpt-test"],
      thinkingLevel: "high",
    });
    expect((await stat(output.dependencies.globalConfigFile)).mode & 0o777).toBe(0o600);

    output.stdout.length = 0;
    expect(await main(["config", "show"], output.dependencies)).toBe(0);
    expect(output.stdout.join("\n")).toContain("openai/gpt-test");
  });

  test("shows effective built-in defaults when no global override exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-council-cli-"));
    const output = capture(directory);

    expect(await main(["config", "show"], output.dependencies)).toBe(0);
    const displayed = output.stdout.join("\n");
    expect(displayed).toContain('"source": "built_in_defaults"');
    expect(displayed).toContain("openai/gpt-5.6-sol");
    expect(displayed).toContain("anthropic/claude-fable-5-1");
    expect(displayed).toContain("moonshotai/kimi-k3");
  });

  test("uses the renamed council global config path", () => {
    expect(globalConfigPath({ XDG_CONFIG_HOME: "/tmp/example-config" })).toBe(
      "/tmp/example-config/council/config.json",
    );
    expect(globalConfigPath({ COUNCIL_CONFIG_FILE: "/tmp/custom-council.json" })).toBe(
      "/tmp/custom-council.json",
    );
  });

  test("loads an external TypeScript council config for inspection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-council-cli-"));
    const output = capture(directory);
    const configPath = join(directory, "custom.config.ts");
    await writeFile(configPath, `export default ${JSON.stringify(config())};\n`, "utf8");

    expect(
      await main(["config", "show", "--config", configPath], output.dependencies),
    ).toBe(0);
    expect(output.stdout.join("\n")).toContain('"proposer-a"');
  });
});
