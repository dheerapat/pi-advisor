import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, getMarkdownTheme, type SessionEntry, DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text, Container, Spacer, SelectList, type SelectItem, matchesKey, Key } from "@earendil-works/pi-tui";
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
        ctx.ui.theme.fg("success", "●") + ` Advisor: ${config.provider}/${config.model}`,
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
    // ── Model selector: show available (configured) models ───────────
    const allModels = ctx.modelRegistry.getAvailable();

    let selectedProvider: string | undefined;
    let selectedModelId: string | undefined;

    if (allModels.length > 0) {
      const items: SelectItem[] = allModels.map((m) => ({
        value: `${m.provider}|${m.id}`,
        label: `${m.provider}/${m.id}`,
        description:
          m.name && m.name !== m.id
            ? m.name
            : undefined,
      }));

      const result = await ctx.ui.custom<string | null>(
        (tui, theme, _kb, done) => {
          const container = new Container();
          let filterText = "";

          // Top border
          container.addChild(
            new DynamicBorder((s: string) => theme.fg("accent", s)),
          );

          // Title (dynamic — shows filter when typing)
          const titleText = new Text(
            theme.fg("accent", theme.bold("Select Advisor Model")),
            1,
            1,
          );
          container.addChild(titleText);

          // Help text
          container.addChild(
            new Text(
              theme.fg("dim", "↑↓ navigate  ·  enter select  ·  esc manual input  ·  type to filter"),
              1,
              0,
            ),
          );

          // SelectList
          const selectList = new SelectList(
            items,
            Math.min(items.length, 10),
            {
              selectedPrefix: (t) => theme.fg("accent", t),
              selectedText: (t) => theme.fg("accent", t),
              description: (t) => theme.fg("muted", t),
              scrollInfo: (t) => theme.fg("dim", t),
              noMatch: (t) => theme.fg("warning", t),
            },
          );
          selectList.onSelect = (item) => done(item.value);
          selectList.onCancel = () => done(null);
          container.addChild(selectList);

          // Bottom spacer
          container.addChild(new Spacer(1));

          // Bottom border
          container.addChild(
            new DynamicBorder((s: string) => theme.fg("accent", s)),
          );

          function updateFilterDisplay() {
            if (filterText) {
              titleText.setText(
                theme.fg("accent", theme.bold("Select Advisor Model")) +
                  "  " +
                  theme.fg("muted", `[filter: ${filterText}▌]`),
              );
            } else {
              titleText.setText(
                theme.fg("accent", theme.bold("Select Advisor Model")),
              );
            }
          }

          return {
            render: (w) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: (data) => {
              // Backspace — remove last filter char
              if (matchesKey(data, Key.backspace)) {
                filterText = filterText.slice(0, -1);
                selectList.setFilter(filterText);
                updateFilterDisplay();
                tui.requestRender();
                return;
              }

              // Printable ASCII chars — add to filter
              if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
                filterText += data;
                selectList.setFilter(filterText);
                updateFilterDisplay();
                tui.requestRender();
                return;
              }

              // Delegate navigation / selection to SelectList
              selectList.handleInput(data);
              tui.requestRender();
            },
          };
        },
      );

      if (result) {
        const pipeIndex = result.indexOf("|");
        selectedProvider = result.slice(0, pipeIndex);
        selectedModelId = result.slice(pipeIndex + 1);
      }
      // If cancelled (Esc), fall through to manual input
    }

    // ── Manual input fallback ───────────────────────────────────────
    if (!selectedProvider) {
      selectedProvider =
        (await ctx.ui.input("Advisor provider:", "e.g. anthropic, opencode-go")) ?? "";
      if (!selectedProvider) return;
    }

    if (!selectedModelId) {
      selectedModelId =
        (await ctx.ui.input(
          `Model ID for ${selectedProvider}:`,
          "e.g. claude-sonnet-4-5",
        )) ?? "";
      if (!selectedModelId) return;
    }

    const found = ctx.modelRegistry.find(selectedProvider, selectedModelId);
    if (!found) {
      const proceed = await ctx.ui.confirm(
        "Model not found",
        `${selectedProvider}/${selectedModelId} was not found in the model registry. Save anyway?`,
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
      provider: selectedProvider,
      model: selectedModelId,
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

    ctx.ui.notify(`Advisor configured: ${selectedProvider}/${selectedModelId} (${scope})`, "info");
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
      "Use ask_advisor proactively when stuck or uncertain. Don't spin your wheels — a quick advisor call saves time. " +
        "Formulate a detailed question with specific context about what you're trying to achieve, what you've tried, and where you're stuck. " +
        "Good times to ask: after 2+ failed attempts, before large/risky changes, when debugging complex issues, " +
        "or when facing ambiguous requirements with trade-offs.",
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
        container.addChild(new Markdown(text, 0, 0, getMarkdownTheme()));

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
      ? `\n${theme.fg("dim", `↑${(message.details as any).usage.input} · ↓${(message.details as any).usage.output} · $${(message.details as any).usage.cost.toFixed(4)}`)}`
      : "";

    const header = theme.fg("customMessageLabel", theme.bold(`💡 Advisor (${modelName})`));

    if (expanded) {
      const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
      box.addChild(new Text(header, 0, 0));
      box.addChild(new Spacer(1));
      box.addChild(new Markdown(contentText, 0, 0, getMarkdownTheme()));
      if (usageFooter) {
        box.addChild(new Text(usageFooter, 0, 0));
      }
      return box;
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

    let collapsedText = header + "\n" + theme.fg("customMessageText", preview);

    if (isTruncated) {
      collapsedText += "\n" + theme.fg("muted", "(Ctrl+O to expand)");
    }

    collapsedText += usageFooter;

    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(collapsedText, 0, 0));
    return box;
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
        `A more capable advisor model (${config.provider}/${config.model}) is available. When you encounter a difficult problem or are unsure how to proceed, use the ask_advisor tool to get expert guidance. The advisor has full access to the conversation context but cannot make changes — it will provide advice for you to act on.`,
        "",
        "**Proactively use ask_advisor when:**",
        "- You've tried 2+ approaches and none have worked",
        "- You're unsure about the best architectural decision or design pattern",
        "- You're debugging a complex, hard-to-trace issue",
        "- You're about to make a large or risky change and want a second opinion",
        "- You find yourself going in circles or repeating the same steps",
        "- The user's request is ambiguous or involves significant trade-offs",
        "- You need help with a domain-specific problem (e.g., a framework or library you're less familiar with)",
        "",
        "The advisor is free to use — prefer asking for guidance over spinning your wheels. A 10-second advisor call can save minutes of fruitless effort.",
      ].join("\n");

      return {
        systemPrompt: event.systemPrompt + advisorHint,
      };
    }
  });
}
