import { safeFetchText } from '../lib/http.js';
import { ProviderError, ErrorCodes } from '../lib/errors.js';

export class OpenRouterQueryPlannerClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'deepseek/deepseek-v4-flash';
    this.baseUrl = (config.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    this.siteUrl = config.siteUrl || '';
    this.appName = config.appName || 'ETF Hub Reverse Search';
    this.timeoutMs = config.timeoutMs || 15000;
    this.retries = config.retries ?? 1;
  }

  isAvailable() {
    return this.apiKey.trim() !== '';
  }

  async createPlan({ query, taxonomy }) {
    if (!this.isAvailable()) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'openrouter key missing', { provider: 'openrouter' });
    }

    const tags = (taxonomy?.tags || [])
      .filter((tag) => tag.enabled !== false)
      .map((tag) => ({ id: tag.id, facet: tag.facet, label: tag.label, definition: tag.definition }));

    const text = await safeFetchText(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(this.siteUrl ? { 'HTTP-Referer': this.siteUrl } : {}),
        ...(this.appName ? { 'X-OpenRouter-Title': this.appName } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(tags) },
          { role: 'user', content: query },
        ],
      }),
      provider: 'openrouter',
      allowlist: [new URL(this.baseUrl).hostname],
      timeoutMs: this.timeoutMs,
      retries: this.retries,
    });

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ProviderError(ErrorCodes.PARSE_ERROR, 'openrouter response json', { provider: 'openrouter' });
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new ProviderError(ErrorCodes.PARSE_ERROR, 'openrouter content missing', { provider: 'openrouter' });
    }
    return parseJsonObject(content);
  }
}

function systemPrompt(tags) {
  return [
    'You are a Korean ETF query planner.',
    'Convert the user query into JSON only. Never recommend or invent an ETF.',
    'Use only tag IDs from the supplied taxonomy.',
    'Schema: {"intent":"TAG_MATCH|MARKET_SORT|COMPOSITE|UNKNOWN","tags":[{"tagId":"...","queryScore":0..1,"mode":"required|preferred|excluded","reason":"short Korean reason"}],"sort":null|{"field":"volume|tradingValue|return1m|volatilityScore|totalFee","direction":"asc|desc","label":"Korean label"}}.',
    'Use required only for explicit core conditions. Use preferred for softer wishes such as 선호, 좋겠어, 너무 높지 않게, or 있으면 좋다. Use excluded for explicit avoidance.',
    'Return at most 6 tags. Higher queryScore means stronger relevance. Do not include generic tags without evidence in the query.',
    'Only set sort when the user explicitly asks for ranking by a supported metric.',
    `Taxonomy: ${JSON.stringify(tags)}`,
  ].join('\n');
}

function parseJsonObject(content) {
  const trimmed = content.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        // handled below
      }
    }
    throw new ProviderError(ErrorCodes.PARSE_ERROR, 'openrouter plan json', { provider: 'openrouter' });
  }
}
