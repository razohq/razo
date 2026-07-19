import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { batchReports, buildPrompt, promptBudget, SYSTEM_PROMPT } from './prompt';
import type { AiTestReport } from './types';

export type ProviderName = 'anthropic' | 'openai';

/** Minimal Anthropic client surface, so tests can inject a fake. */
export interface AnalyzeClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

/** Minimal OpenAI client surface, so tests can inject a fake. */
export interface OpenAiClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: Array<{ role: 'system' | 'user'; content: string }>;
      }): Promise<{
        choices: Array<{ message: { content: string | null } }>;
        usage?: { prompt_tokens: number; completion_tokens: number } | null;
      }>;
    };
  };
}

export interface AnalyzeOptions {
  /** Model provider. Default: anthropic. */
  provider?: ProviderName;
  /** Model id. Default (anthropic only): claude-opus-4-8. Required for openai. */
  model?: string;
  /** Prompt budget in characters. Default: promptBudget() (env-overridable). */
  budgetChars?: number;
  /** Injectable API clients (tests). Defaults: real SDK clients. */
  client?: AnalyzeClient;
  openaiClient?: OpenAiClient;
}

/**
 * CLI-facing validation: openai has no default model on purpose (a hardcoded
 * one would go stale) and needs its key present before any batching work.
 * Returns an actionable error message, or null when the options are valid.
 */
export function validateProviderOptions(
  provider: string,
  model: string | undefined,
  env: Record<string, string | undefined>,
): string | null {
  if (provider === 'anthropic') return null;
  if (provider === 'openai') {
    if (!model) return '--model is required with --provider openai (no default is assumed).';
    if (!env.OPENAI_API_KEY) return 'Set OPENAI_API_KEY to use --provider openai.';
    return null;
  }
  return `Unknown provider: ${provider}. Supported: anthropic, openai.`;
}

interface BatchResult {
  markdown: string;
}

async function callAnthropic(
  system: string,
  user: string,
  model: string,
  client: AnalyzeClient,
): Promise<BatchResult> {
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to analyze this content (stop_reason: refusal).');
  }
  return {
    markdown: response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n'),
  };
}

async function callOpenAi(
  system: string,
  user: string,
  model: string,
  client: OpenAiClient,
): Promise<BatchResult> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return { markdown: response.choices[0]?.message.content ?? '' };
}

/**
 * Sends the failed reports to the configured model and returns a Markdown
 * analysis. Large suites split into prompt-budget-sized batches (one API
 * call each), concatenated in order. Credentials resolve from the
 * environment (ANTHROPIC_API_KEY / OPENAI_API_KEY).
 */
export async function analyzeFailures(
  reports: AiTestReport[],
  options: AnalyzeOptions = {},
): Promise<string> {
  const provider = options.provider ?? 'anthropic';
  const model = options.model ?? (provider === 'anthropic' ? 'claude-opus-4-8' : undefined);
  if (!model) throw new Error('A model id is required for this provider.');

  const anthropicClient =
    provider === 'anthropic' ? (options.client ?? new Anthropic()) : null;
  const openaiClient = provider === 'openai' ? (options.openaiClient ?? new OpenAI()) : null;

  const batches = batchReports(reports, options.budgetChars ?? promptBudget());
  const parts: string[] = [];
  for (const batch of batches) {
    const user = buildPrompt(batch);
    const result =
      provider === 'anthropic'
        ? await callAnthropic(SYSTEM_PROMPT, user, model, anthropicClient!)
        : await callOpenAi(SYSTEM_PROMPT, user, model, openaiClient!);
    parts.push(result.markdown);
  }
  return parts.join('\n\n---\n\n');
}

/** Maps SDK errors to actionable CLI messages. */
export function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Authentication failed. Set ANTHROPIC_API_KEY (or log in with `ant auth login`).';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Rate limited by the Anthropic API. Wait a moment and retry.';
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API. Check your network connection.';
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error ${error.status}: ${error.message}`;
  }
  if (error instanceof OpenAI.AuthenticationError) {
    return 'Authentication failed. Check OPENAI_API_KEY.';
  }
  if (error instanceof OpenAI.RateLimitError) {
    return 'Rate limited by the OpenAI API. Wait a moment and retry.';
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return 'Could not reach the OpenAI API. Check your network connection.';
  }
  if (error instanceof OpenAI.APIError) {
    return `OpenAI API error ${error.status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
