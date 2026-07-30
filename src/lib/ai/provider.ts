import { createLogger } from '../logger';
import { getSetting } from '../settings/service';
import { getIntegrationSecrets, recordIntegrationFailure } from '../integrations/store';
import { buildSystemPrompt, buildUserPrompt, extractJsonObject, type QualificationInput } from './prompt';
import { qualifyWithRules } from './rules-provider';
import { QUALIFICATION_JSON_SCHEMA, qualificationSchema, type QualificationResult } from './schema';

const log = createLogger('ai');

export type AiProviderName = 'anthropic' | 'openai' | 'rules';

export type QualificationOutcome = {
  result: QualificationResult;
  provider: AiProviderName;
  model: string;
  /** True when an LLM was attempted and failed, and rules produced this result. */
  degraded: boolean;
  degradedReason?: string;
};

const REQUEST_TIMEOUT_MS = 60_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(
  apiKey: string,
  model: string,
  input: QualificationInput,
  maxTokens: number,
  temperature: number,
): Promise<QualificationResult> {
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    system: buildSystemPrompt(input),
    // A single forced tool call is the most reliable way to get schema-valid
    // JSON out of the Messages API.
    tools: [
      {
        name: 'record_qualified_opportunity',
        description: 'Record the structured qualification result for one lead source.',
        input_schema: QUALIFICATION_JSON_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'record_qualified_opportunity' },
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
  };

  const json = (await postJson('https://api.anthropic.com/v1/messages', {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }, body)) as { content?: Array<{ type: string; input?: unknown; text?: string }> };

  const toolUse = json.content?.find((c) => c.type === 'tool_use');
  if (toolUse?.input) return qualificationSchema.parse(toolUse.input);

  const textBlock = json.content?.find((c) => c.type === 'text')?.text;
  if (textBlock) return qualificationSchema.parse(extractJsonObject(textBlock));
  throw new Error('Anthropic response contained no tool use or text block');
}

async function callOpenAi(
  apiKey: string,
  model: string,
  input: QualificationInput,
  maxTokens: number,
  temperature: number,
): Promise<QualificationResult> {
  const body = {
    model,
    max_completion_tokens: maxTokens,
    temperature,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'qualified_opportunity',
        strict: false,
        schema: QUALIFICATION_JSON_SCHEMA,
      },
    },
    messages: [
      { role: 'system', content: buildSystemPrompt(input) },
      { role: 'user', content: buildUserPrompt(input) },
    ],
  };

  const json = (await postJson('https://api.openai.com/v1/chat/completions', {
    authorization: `Bearer ${apiKey}`,
  }, body)) as { choices?: Array<{ message?: { content?: string } }> };

  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI response contained no message content');
  return qualificationSchema.parse(extractJsonObject(content));
}

type ResolvedProvider =
  | { name: 'anthropic'; apiKey: string; model: string }
  | { name: 'openai'; apiKey: string; model: string }
  | { name: 'rules'; apiKey: null; model: 'rules-v1' };

/**
 * Resolves which provider to use. Credentials configured in Settings win over
 * environment variables, and `auto` prefers Anthropic → OpenAI → rules.
 */
export async function resolveProvider(): Promise<ResolvedProvider> {
  const config = await getSetting('ai.config');

  const anthropicKey =
    (await getIntegrationSecrets('AI_ANTHROPIC'))?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? null;
  const openaiKey =
    (await getIntegrationSecrets('AI_OPENAI'))?.apiKey ?? process.env.OPENAI_API_KEY ?? null;

  const anthropicModel = config.anthropicModel || process.env.ANTHROPIC_MODEL || 'claude-opus-5';
  const openaiModel = config.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const wanted = config.provider;

  if (wanted === 'rules') return { name: 'rules', apiKey: null, model: 'rules-v1' };
  if (wanted === 'anthropic' && anthropicKey) {
    return { name: 'anthropic', apiKey: anthropicKey, model: anthropicModel };
  }
  if (wanted === 'openai' && openaiKey) {
    return { name: 'openai', apiKey: openaiKey, model: openaiModel };
  }
  if (wanted === 'auto') {
    if (anthropicKey) return { name: 'anthropic', apiKey: anthropicKey, model: anthropicModel };
    if (openaiKey) return { name: 'openai', apiKey: openaiKey, model: openaiModel };
  }
  return { name: 'rules', apiKey: null, model: 'rules-v1' };
}

/**
 * Qualify one lead source.
 *
 * An LLM failure never stalls the pipeline: it is logged as an integration
 * failure (visible to the owner) and the deterministic rules engine produces a
 * lower-confidence result that routes to Manual Review.
 */
export async function qualifyOpportunity(input: QualificationInput): Promise<QualificationOutcome> {
  const provider = await resolveProvider();
  const config = await getSetting('ai.config');

  if (provider.name === 'rules') {
    return { result: qualifyWithRules(input), provider: 'rules', model: 'rules-v1', degraded: false };
  }

  try {
    const result =
      provider.name === 'anthropic'
        ? await callAnthropic(provider.apiKey, provider.model, input, config.maxTokens, config.temperature)
        : await callOpenAi(provider.apiKey, provider.model, input, config.maxTokens, config.temperature);
    return { result, provider: provider.name, model: provider.model, degraded: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('AI qualification failed, falling back to rules engine', {
      provider: provider.name,
      message,
    });
    await recordIntegrationFailure(
      provider.name === 'anthropic' ? 'AI_ANTHROPIC' : 'AI_OPENAI',
      'qualification_failed',
      message,
    );
    const fallback = qualifyWithRules(input);
    return {
      // Cap confidence so a degraded result can never bypass manual review.
      result: { ...fallback, confidence: Math.min(fallback.confidence, 0.4) },
      provider: 'rules',
      model: 'rules-v1',
      degraded: true,
      degradedReason: message,
    };
  }
}

/** Live credential test used by Settings → Integrations. */
export async function testAiProvider(
  name: 'anthropic' | 'openai',
): Promise<{ ok: boolean; message: string }> {
  const secrets = await getIntegrationSecrets(name === 'anthropic' ? 'AI_ANTHROPIC' : 'AI_OPENAI');
  const apiKey = secrets?.apiKey ?? (name === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);
  if (!apiKey) return { ok: false, message: 'No API key configured.' };

  const config = await getSetting('ai.config');
  try {
    if (name === 'anthropic') {
      await postJson('https://api.anthropic.com/v1/messages', {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }, {
        model: config.anthropicModel,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      });
    } else {
      await postJson('https://api.openai.com/v1/chat/completions', {
        authorization: `Bearer ${apiKey}`,
      }, {
        model: config.openaiModel,
        max_completion_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      });
    }
    return { ok: true, message: 'Credentials accepted and a test completion succeeded.' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
