import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { testEnvironment } from "@paperclipai/adapter-gemini-local/server";

async function installFakeGeminiCli(binDir: string, innerBody: string): Promise<void> {
  const cjsPath = path.join(binDir, "gemini-cli.cjs");
  await fs.writeFile(cjsPath, innerBody, "utf8");
  if (process.platform === "win32") {
    const cmdPath = path.join(binDir, "gemini.cmd");
    await fs.writeFile(cmdPath, '@echo off\r\nnode "%~dp0gemini-cli.cjs" %*\r\n', "utf8");
  } else {
    const shimPath = path.join(binDir, "gemini");
    await fs.writeFile(shimPath, `#!/usr/bin/env node\n${innerBody}`, "utf8");
    await fs.chmod(shimPath, 0o755);
  }
}

async function writeFakeGeminiCommand(binDir: string, argsCapturePath: string): Promise<void> {
  const innerBody = `const fs = require("node:fs");
const outPath = process.env.PAPERCLIP_TEST_ARGS_PATH;
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(process.argv.slice(2)), "utf8");
}
console.log(JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "output_text", text: "hello" }] },
}));
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  result: "hello",
}));
`;
  await installFakeGeminiCli(binDir, innerBody);
}

async function writeQuotaGeminiCommand(binDir: string): Promise<void> {
  const innerBody = `if (process.argv.includes("--help")) {
  process.exit(0);
}
console.error("429 RESOURCE_EXHAUSTED: You exceeded your current quota and billing details.");
process.exit(1);
`;
  await installFakeGeminiCli(binDir, innerBody);
}

describe("gemini_local environment diagnostics", () => {
  it("creates a missing working directory when cwd is absolute", async () => {
    const cwd = path.join(
      os.tmpdir(),
      `paperclip-gemini-local-cwd-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      "workspace",
    );

    await fs.rm(path.dirname(cwd), { recursive: true, force: true });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "gemini_local",
      config: {
        command: process.execPath,
        cwd,
      },
    });

    expect(result.checks.some((check) => check.code === "gemini_cwd_valid")).toBe(true);
    expect(result.checks.some((check) => check.level === "error")).toBe(false);
    const stats = await fs.stat(cwd);
    expect(stats.isDirectory()).toBe(true);
    await fs.rm(path.dirname(cwd), { recursive: true, force: true });
  });

  it("passes model and yolo flags to the hello probe", async () => {
    const root = path.join(
      os.tmpdir(),
      `paperclip-gemini-local-probe-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const binDir = path.join(root, "bin");
    const cwd = path.join(root, "workspace");
    const argsCapturePath = path.join(root, "args.json");
    await fs.mkdir(binDir, { recursive: true });
    await writeFakeGeminiCommand(binDir, argsCapturePath);

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "gemini_local",
      config: {
        command: "gemini",
        cwd,
        model: "gemini-2.5-pro",
        yolo: true,
        env: {
          GEMINI_API_KEY: "test-key",
          PAPERCLIP_TEST_ARGS_PATH: argsCapturePath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    });

    expect(result.status).not.toBe("fail");
    const args = JSON.parse(await fs.readFile(argsCapturePath, "utf8")) as string[];
    expect(args).toContain("--model");
    expect(args).toContain("gemini-2.5-pro");
    expect(args).toContain("--approval-mode");
    expect(args).toContain("yolo");
    // Windows gemini.cmd can split or quote-strip the positional prompt; require phrase in argv.
    expect(args.join(" ").replace(/"/g, "")).toMatch(/Respond\s+with\s+hello\./i);
    await fs.rm(root, { recursive: true, force: true });
  });

  it("classifies quota exhaustion as a quota warning instead of a generic failure", async () => {
    const root = path.join(
      os.tmpdir(),
      `paperclip-gemini-local-quota-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const binDir = path.join(root, "bin");
    const cwd = path.join(root, "workspace");
    await fs.mkdir(binDir, { recursive: true });
    await writeQuotaGeminiCommand(binDir);

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "gemini_local",
      config: {
        command: "gemini",
        cwd,
        env: {
          GEMINI_API_KEY: "test-key",
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    });

    expect(result.status).toBe("warn");
    expect(result.checks.some((check) => check.code === "gemini_hello_probe_quota_exhausted")).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });
});
