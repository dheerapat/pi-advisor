import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const AdvisorConfigSchema = Type.Object({
  provider: Type.String({ minLength: 1 }),
  model: Type.String({ minLength: 1 }),
  thinkingLevel: Type.Optional(
    Type.Union([
      Type.Literal("off"),
      Type.Literal("minimal"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
      Type.Literal("xhigh"),
    ]),
  ),
  systemPrompt: Type.Optional(Type.String()),
  maxContextMessages: Type.Optional(Type.Number({ minimum: 1 })),
});

export type AdvisorConfig = Static<typeof AdvisorConfigSchema>;

const DEFAULT_SYSTEM_PROMPT = `You are an expert programming advisor. You are consulted when a developer is stuck on a hard problem.

Your role:
- Analyze the conversation history to understand what the developer is trying to achieve
- Provide clear, actionable guidance based on the context
- Identify potential issues, edge cases, and alternative approaches
- Suggest next steps and trade-offs

Guidelines:
- Be concise but thorough — the developer needs specific, practical advice
- Reference relevant files, code patterns, or decisions from the conversation
- When the context is insufficient, state what additional information would help
- You are advisory only — you cannot make changes. Tell the developer what to do, not do it for them.
- If you see a fundamentally better approach, explain why and how to get there`;

/**
 * Validate a raw config object against the schema.
 * Logs a clear error if validation fails.
 */
function validateConfigShape(raw: unknown, label: string): AdvisorConfig | null {
  if (!Value.Check(AdvisorConfigSchema, raw)) {
    for (const error of Value.Errors(AdvisorConfigSchema, raw)) {
      console.error(
        `[pi-advisor] Config error in ${label}: ${error.instancePath || "(root)"} — ${error.message}`,
      );
    }
    return null;
  }
  return raw as AdvisorConfig;
}

/**
 * Load advisor config from global and project-local JSON files.
 * If a valid project `.pi/advisor.json` exists, it is used exclusively
 * and the global config is ignored entirely.
 */
export function loadConfig(cwd: string): AdvisorConfig | null {
  const globalPath = join(getAgentDir(), "advisor.json");
  const projectPath = join(cwd, ".pi", "advisor.json");

  // Project config exists → use it exclusively, ignore global
  if (existsSync(projectPath)) {
    try {
      const raw = JSON.parse(readFileSync(projectPath, "utf-8"));
      const parsed = validateConfigShape(raw, "project");
      if (parsed && parsed.provider && parsed.model) {
        return parsed;
      }
    } catch (err) {
      console.error(`Failed to parse ${projectPath}:`, err);
    }
    // If project config is invalid/missing fields, fall through to global
  }

  // No project config (or it was invalid) — try global
  if (existsSync(globalPath)) {
    try {
      const raw = JSON.parse(readFileSync(globalPath, "utf-8"));
      const parsed = validateConfigShape(raw, "global");
      if (parsed && parsed.provider && parsed.model) {
        return parsed;
      }
    } catch (err) {
      console.error(`Failed to parse ${globalPath}:`, err);
    }
  }

  return null;
}

export function saveConfig(
  path: string,
  config: AdvisorConfig,
): void {
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function buildSystemPrompt(config: AdvisorConfig): string {
  return config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
}
