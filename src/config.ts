import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface AdvisorConfig {
  provider: string;
  model: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  systemPrompt?: string;
}

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
 * Load advisor config from global and project-local JSON files.
 * Project-local overrides global.
 */
export function loadConfig(cwd: string): AdvisorConfig | null {
  const globalPath = join(getAgentDir(), "advisor.json");
  const projectPath = join(cwd, ".pi", "advisor.json");

  let globalConfig: AdvisorConfig | null = null;
  let projectConfig: AdvisorConfig | null = null;

  if (existsSync(globalPath)) {
    try {
      globalConfig = JSON.parse(readFileSync(globalPath, "utf-8"));
    } catch (err) {
      console.error(`Failed to parse ${globalPath}:`, err);
    }
  }

  if (existsSync(projectPath)) {
    try {
      projectConfig = JSON.parse(readFileSync(projectPath, "utf-8"));
    } catch (err) {
      console.error(`Failed to parse ${projectPath}:`, err);
    }
  }

  const merged: AdvisorConfig = { ...globalConfig, ...projectConfig } as AdvisorConfig;

  if (!merged.provider || !merged.model) {
    return null;
  }

  return merged;
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
