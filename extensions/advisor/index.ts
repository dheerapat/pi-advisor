import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { Text, Container, Spacer } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  loadConfig,
  saveConfig,
  type AdvisorConfig,
} from "./config.ts";
import { callAdvisor, type AdvisorResult } from "./advisor.ts";

export default function (pi: ExtensionAPI) {
  let config: AdvisorConfig | null = null;
  let configFilePath: string | null = null;

  function refreshConfig(cwd: string) {
    config = loadConfig(cwd);
    return config;
  }

  function updateStatus(ctx: ExtensionContext) {
    if (config) {
      ctx.ui.setStatus(
        "advisor",
        ctx.ui.theme.fg("accent", `advisor:${config.provider}/${config.model}`),
      );
    } else {
      ctx.ui.setStatus("advisor", undefined);
    }
  }

  function formatUsage(result: AdvisorResult): string {
    if (!result.usage) return "";
    const model = result.usage.model || `${config!.provider}/${config!.model}`;
    return `\n\n---\n*Advisor: ${model} · ↑${result.usage.input} · ↓${result.usage.output} · $${result.usage.cost.toFixed(4)}*`;
  }

  function injectAdvice(result: AdvisorResult, question: string) {
    pi.sendMessage({
      customType: "advisor",
      content: result.text + formatUsage(result),
      display: true,
      details: {
        question,
        model: result.usage?.model || `${config!.provider}/${config!.model}`,
        usage: result.usage,
      },
    });
  }

  // ── /advise command ────────────────────────────────────────────

  pi.registerCommand("advise", {
    description: "Ask the advisor model for guidance on the current problem. Use 'describe' to get a fresh pair of eyes on the conversation.",
    handler: async (args, ctx) => {
      const trimmed = args?.trim() || "";

      let question = trimmed;

      // /advise describe — send a generic review prompt
      if (trimmed === "describe") {
        question = "Review the conversation above. What is the user trying to accomplish? What's the current state? Are there any issues, edge cases, or improvements you can spot? Provide a fresh perspective on the overall situation.";
      }

      if (!question) {
        question =
          (await ctx.ui.input(
            "What do you need advice on?",
            "Describe the problem you're stuck on...",
          )) ?? "";
        if (!question) return;
      }

      if (!config) {
        ctx.ui.notify("No advisor configured. Run /advisor config to set up.", "error");
        return;
      }

      const branch = ctx.sessionManager.getBranch() as SessionEntry[];

      const result = await ctx.ui.custom<AdvisorResult | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(
          tui,
          theme,
          `Asking advisor (${config!.provider}/${config!.model})...`,
        );
        loader.onAbort = () => done(null);

        callAdvisor(config!, branch, question, loader.signal, ctx.modelRegistry)
          .then(done)
          .catch((err: any) => {
            console.error("Advisor call failed:", err);
            done({ text: `Error: ${err.message}`, usage: undefined });
          });

        return loader;
      });

      if (!result) return;

      injectAdvice(result, question);
      ctx.ui.notify(`Advisor responded`, "info");
      updateStatus(ctx);
    },
  });

  // ── /advisor command (config management) ───────────────────────

  pi.registerCommand("advisor", {
    description: "Configure or check advisor model settings",
    handler: async (args, ctx) => {
      const sub = args?.trim() || "";

      if (sub === "status" || sub === "show" || sub === "") {
        if (config) {
          const info = [
            `provider: ${config.provider}`,
            `model: ${config.model}`,
            `thinking: ${config.thinkingLevel || "default"}`,
            `systemPrompt: ${config.systemPrompt ? "custom" : "default"}`,
          ];
          ctx.ui.notify(info.join(" · "), "info");
        } else {
          ctx.ui.notify(
            "No advisor configured. Use /advisor config to set up.",
            "warning",
          );
        }
        return;
      }

      if (sub === "config" || sub === "setup") {
        await setupAdvisorConfig(ctx);
        return;
      }

      ctx.ui.notify("Usage: /advisor [status|config]", "warning");
    },
  });

  // ── Config setup flow ─────────────────────────────────────────

  async function setupAdvisorConfig(ctx: ExtensionContext) {
    const provider = (await ctx.ui.input("Advisor provider:", "e.g. anthropic, openai")) ?? "";
    if (!provider) return;

    const model = (await ctx.ui.input(`Model ID for ${provider}:`, "e.g. claude-sonnet-4-5")) ?? "";
    if (!model) return;

    const found = ctx.modelRegistry.find(provider, model);
    if (!found) {
      const proceed = await ctx.ui.confirm(
        "Model not found",
        `${provider}/${model} was not found in the model registry. Save anyway?`,
      );
      if (!proceed) return;
    }

    const thinkingChoices = [
      "__default__ (model default)",
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ];
    const thinkingChoice = await ctx.ui.select(
      "Select thinking level:",
      thinkingChoices,
    );
    if (thinkingChoice === undefined) return; // user cancelled
    const thinkingValue = thinkingChoice.split(" ")[0];

    const scopeSelection = await ctx.ui.select("Save to:", [
      "project (.pi/advisor.json)",
      "global (~/.pi/agent/advisor.json)",
    ]);
    if (!scopeSelection) return;
    const scope = scopeSelection.startsWith("project") ? "project" : "global";

    const newConfig: AdvisorConfig = {
      provider,
      model,
    };
    if (thinkingValue && thinkingValue !== "__default__") {
      newConfig.thinkingLevel = thinkingValue as AdvisorConfig["thinkingLevel"];
    }

    const fs = await import("node:fs");
    const path = await import("node:path");
    const { getAgentDir } = await import("@earendil-works/pi-coding-agent");

    if (scope === "global") {
      configFilePath = path.join(getAgentDir(), "advisor.json");
    } else {
      configFilePath = path.join(ctx.cwd, ".pi", "advisor.json");
      const dir = path.dirname(configFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    saveConfig(configFilePath, newConfig);
    config = newConfig;
    updateStatus(ctx);

    ctx.ui.notify(`Advisor configured: ${provider}/${model} (${scope})`, "info");
  }

  // ── ask_advisor tool (callable by LLM) ─────────────────────────

  pi.registerTool({
    name: "ask_advisor",
    label: "Ask Advisor",
    description:
      "Ask a more capable advisor model for guidance when you are stuck on a hard problem. " +
      "Formulate a specific, detailed question describing what you are trying to do, " +
      "what you've tried, and where you're stuck. The advisor will analyze the full " +
      "conversation context and provide expert guidance.",
    promptSnippet:
      "Ask the advisor model for help when stuck on a hard problem",
    promptGuidelines: [
      "When you encounter a difficult problem or are unsure how to proceed, use ask_advisor to get guidance from a more capable model. " +
        "Formulate a detailed question with specific context about what you're trying to achieve, what you've tried, and where you're stuck.",
    ],
    parameters: Type.Object({
      question: Type.String({
        description:
          "Your specific question for the advisor. Include what you're trying to do, " +
          "what approaches you've tried, and where exactly you're stuck. Be detailed.",
      }),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!config) {
        return {
          content: [
            {
              type: "text",
              text: "No advisor configured. Tell the user to run /advisor config to set up an advisor model.",
            },
          ],
          details: {},
        };
      }

      const branch = ctx.sessionManager.getBranch() as SessionEntry[];

      try {
        const result = await callAdvisor(
          config,
          branch,
          params.question,
          signal ?? new AbortController().signal,
          ctx.modelRegistry,
        );

        injectAdvice(result, params.question);

        return {
          content: [{ type: "text", text: result.text }],
          details: {
            question: params.question,
            model: result.usage?.model || `${config.provider}/${config.model}`,
            usage: result.usage,
          },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Advisor error: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },

    renderCall(args, theme, _context) {
      const question = (args.question as string) || "...";
      const preview = question.length > 80 ? `${question.slice(0, 80)}...` : question;
      return new Text(
        theme.fg("toolTitle", theme.bold("ask_advisor ")) + theme.fg("dim", preview),
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as {
        question?: string;
        model?: string;
        usage?: { input: number; output: number; cost: number };
        error?: string;
      } | null;
      const content = result.content?.[0];
      const text = content?.type === "text" ? content.text : "(no output)";

      if (details?.error) {
        return new Text(theme.fg("error", `✗ Advisor error: ${details.error}`), 0, 0);
      }

      if (expanded) {
        const container = new Container();
        container.addChild(new Text(theme.fg("success", "✓ Advisor response"), 0, 0));

        if (details?.question) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("muted", "─── Question ───"), 0, 0));
          container.addChild(new Text(theme.fg("dim", details.question), 0, 0));
        }

        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("muted", "─── Advice ───"), 0, 0));
        container.addChild(new Text(text, 0, 0));

        if (details?.usage) {
          container.addChild(new Spacer(1));
          container.addChild(
            new Text(
              theme.fg(
                "dim",
                `${details.model || ""} · ↑${details.usage.input} · ↓${details.usage.output} · $${details.usage.cost.toFixed(4)}`,
              ),
              0,
              0,
            ),
          );
        }

        return container;
      }

      // Collapsed
      const preview = text.split("\n").slice(0, 4).join("\n");
      let collapsed =
        theme.fg("success", "✓ ") +
        theme.fg("toolTitle", theme.bold("advisor")) +
        (details?.model ? " " + theme.fg("muted", `(${details.model})`) : "");

      collapsed += "\n" + theme.fg("toolOutput", preview);
      if (text.split("\n").length > 4) {
        collapsed += "\n" + theme.fg("muted", "(Ctrl+O to expand)");
      }

      if (details?.usage) {
        collapsed +=
          "\n" +
          theme.fg("dim", `↑${details.usage.input} · ↓${details.usage.output} · $${details.usage.cost.toFixed(4)}`);
      }

      return new Text(collapsed, 0, 0);
    },
  });

  // ── Custom message renderer ────────────────────────────────────

  pi.registerMessageRenderer("advisor", (message, options, theme) => {
    const { expanded } = options;
    const modelName = (message.details as any)?.model || "advisor";
    const contentText = typeof message.content === "string"
      ? message.content
      : message.content.map(c => c.type === "text" ? c.text : "").join("");

    // Build usage footer
    const usageFooter = (message.details as any)?.usage
      ? `\n\n${theme.fg("dim", `↑${(message.details as any).usage.input} · ↓${(message.details as any).usage.output} · $${(message.details as any).usage.cost.toFixed(4)}`)}`
      : "";

    if (expanded) {
      let text =
        theme.fg("accent", theme.bold(`💡 Advisor (${modelName})`)) +
        "\n\n" +
        theme.fg("toolOutput", contentText) +
        usageFooter;

      return new Text(text, 0, 0);
    }

    // Collapsed: show generous preview with expand hint
    const totalLines = contentText.split("\n").length;
    const previewLines = contentText.split("\n").slice(0, 15);
    let preview = previewLines.join("\n");
    let isTruncated = totalLines > 15;
    if (preview.length > 500) {
      preview = preview.slice(0, 500) + "...";
      isTruncated = true;
    }

    let collapsedText =
      theme.fg("accent", theme.bold(`💡 Advisor (${modelName})`)) +
      "\n" +
      theme.fg("toolOutput", preview);

    if (isTruncated) {
      collapsedText += "\n" + theme.fg("muted", "(Ctrl+O to expand)");
    }

    collapsedText += usageFooter;

    return new Text(collapsedText, 0, 0);
  });

  // ── Lifecycle ──────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    refreshConfig(ctx.cwd);
    updateStatus(ctx);
  });

  pi.on("before_agent_start", async (event) => {
    if (config) {
      const advisorHint = [
        "",
        "## Advisor Available",
        `A more capable advisor model (${config.provider}/${config.model}) is available. ` +
          "When you encounter a difficult problem or are unsure how to proceed, use the ask_advisor tool " +
          "to get expert guidance. The advisor has full access to the conversation context but cannot make changes — " +
          "it will provide advice for you to act on.",
      ].join("\n");

      return {
        systemPrompt: event.systemPrompt + advisorHint,
      };
    }
  });
}
