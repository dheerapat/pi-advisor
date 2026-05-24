import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { completeSimple, type Message } from "@earendil-works/pi-ai";
import {
  convertToLlm,
  serializeConversation,
  type ModelRegistry,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { AdvisorConfig } from "./config.ts";
import { buildSystemPrompt } from "./config.ts";

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === "message") {
    return entry.message;
  }
  if (entry.type === "compaction") {
    return {
      role: "compactionSummary",
      summary: entry.summary,
      tokensBefore: entry.tokensBefore,
      timestamp: new Date(entry.timestamp).getTime(),
    };
  }
  return undefined;
}

/**
 * Walk the current branch and convert entries to messages for the advisor.
 * Handles compaction entries by including the summary.
 * Respects maxContextMessages config to limit context size.
 */
function getBranchMessages(branch: SessionEntry[], maxMessages?: number): AgentMessage[] {
  let compactionIndex = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === "compaction") {
      compactionIndex = i;
      break;
    }
  }

  let messages: AgentMessage[];

  if (compactionIndex < 0) {
    messages = branch
      .map(entryToMessage)
      .filter((m): m is AgentMessage => m !== undefined);
  } else {
    const compaction = branch[compactionIndex];
    const firstKeptIndex =
      compaction.type === "compaction"
        ? branch.findIndex((e) => e.id === compaction.firstKeptEntryId)
        : -1;

    const compactedBranch = [
      compaction,
      ...(firstKeptIndex >= 0
        ? branch.slice(firstKeptIndex, compactionIndex)
        : []),
      ...branch.slice(compactionIndex + 1),
    ];

    messages = compactedBranch
      .map(entryToMessage)
      .filter((m): m is AgentMessage => m !== undefined);
  }

  // Trim oldest messages if over the limit (keep the most recent)
  const limit = maxMessages ?? 50;
  if (messages.length > limit) {
    messages = messages.slice(messages.length - limit);
  }

  return messages;
}

export interface AdvisorResult {
  text: string;
  usage?: {
    input: number;
    output: number;
    cost: number;
    model?: string;
  };
}

/**
 * Retry a function with exponential backoff for transient errors.
 * Retries on network errors, rate limits (429), and server errors (5xx).
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  signal: AbortSignal,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries || signal.aborted) throw err;

      // Only retry on transient errors
      const status = err.status ?? err.statusCode ?? 0;
      const isTransient =
        status === 429 || (status >= 500 && status < 600) ||
        err.code === "ECONNRESET" || err.code === "ETIMEDOUT" ||
        err.type === "rate_limit" || err.type === "server_error";

      if (!isTransient) throw err;

      const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, delay);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve(undefined);
        }, { once: true });
      });

      if (signal.aborted) throw err;
    }
  }
  throw new Error("unreachable");
}

/**
 * Call the advisor model with conversation context and a question.
 * Returns the advisor's text response.
 */
export async function callAdvisor(
  config: AdvisorConfig,
  branch: SessionEntry[],
  question: string,
  signal: AbortSignal,
  modelRegistry: ModelRegistry,
): Promise<AdvisorResult> {
  const model = modelRegistry.find(config.provider, config.model);
  if (!model) {
    throw new Error(
      `Advisor model ${config.provider}/${config.model} not found. Check your config or run /advisor config.`,
    );
  }

  const auth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    throw new Error(
      auth.ok
        ? `No API key for advisor model ${config.provider}/${config.model}.`
        : (auth.error ?? "Failed to get API key"),
    );
  }

  // Build conversation context
  const messages = getBranchMessages(branch, config.maxContextMessages);
  const llmMessages = convertToLlm(messages);
  const conversationText = serializeConversation(llmMessages);

  // Build the advisor prompt
  const systemPrompt = buildSystemPrompt(config);

  const userMessage: Message = {
    role: "user",
    content: [
      {
        type: "text",
        text: `## Conversation History\n\n${conversationText}\n\n## Question\n\n${question}`,
      },
    ],
    timestamp: Date.now(),
  };

  // Build options with optional thinking level
  const options: Record<string, unknown> = {
    apiKey: auth.apiKey,
    headers: auth.headers,
    signal,
  };
  if (config.thinkingLevel && config.thinkingLevel !== "off") {
    options.reasoning = config.thinkingLevel;
  }

  const response = await retryWithBackoff(
    () => completeSimple(
      model,
      { systemPrompt, messages: [userMessage] },
      options,
    ),
    2,
    signal,
  );

  if (response.stopReason === "aborted") {
    throw new Error("Advisor call was aborted");
  }

  const text = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  return {
    text,
    usage: response.usage
      ? {
          input: response.usage.input || 0,
          output: response.usage.output || 0,
          cost: response.usage.cost?.total || 0,
          model: response.model,
        }
      : undefined,
  };
}
