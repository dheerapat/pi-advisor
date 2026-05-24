import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { complete, type Message } from "@earendil-works/pi-ai";
import {
  convertToLlm,
  serializeConversation,
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
 */
function getBranchMessages(branch: SessionEntry[]): AgentMessage[] {
  let compactionIndex = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === "compaction") {
      compactionIndex = i;
      break;
    }
  }

  if (compactionIndex < 0) {
    return branch
      .map(entryToMessage)
      .filter((m): m is AgentMessage => m !== undefined);
  }

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

  return compactedBranch
    .map(entryToMessage)
    .filter((m): m is AgentMessage => m !== undefined);
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
 * Call the advisor model with conversation context and a question.
 * Returns the advisor's text response.
 */
export async function callAdvisor(
  config: AdvisorConfig,
  branch: SessionEntry[],
  question: string,
  signal: AbortSignal,
  modelRegistry: {
    find(
      provider: string,
      id: string,
    ): { provider: string; id: string; api: string } | undefined;
    getApiKeyAndHeaders(model: {
      provider: string;
      id: string;
      api: string;
    }): Promise<{ ok: boolean; apiKey?: string; error?: string; headers?: Record<string, string> }>;
  },
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
  const messages = getBranchMessages(branch);
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

  const response = await complete(
    model,
    { systemPrompt, messages: [userMessage] },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal,
    },
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
