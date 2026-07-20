import { safeFetchText } from '../lib/http.js';
import { ProviderError, ErrorCodes } from '../lib/errors.js';
import { SYSTEM_PROMPT_RULES } from '../../src/js/tag-brief/generate.js';

export class OpenRouterTagBriefClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'deepseek/deepseek-v4-flash';
    this.baseUrl = (config.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    this.siteUrl = config.siteUrl || '';
    this.appName = config.appName || 'ETF Hub Tag Brief';
    this.timeoutMs = config.timeoutMs || 30000;
    this.retries = config.retries ?? 0;
  }

  isAvailable() {
    return this.apiKey.trim() !== '';
  }

  async createContent({ tagUniverse, articles, attempt = 1 }) {
    if (!this.isAvailable()) {
      throw new ProviderError(ErrorCodes.UNAVAILABLE, 'openrouter key missing', { provider: 'openrouter' });
    }
    const evidence = articles.map((article) => ({
      id: article.id,
      title: article.title,
      summary: article.summary || article.body || null,
      source: article.source,
      publishedAt: article.publishedAt,
      mentionedStockIds: article.mentionedStockIds || [],
      mentionedTopicIds: article.mentionedTopicIds || [],
    }));
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
        temperature: attempt === 1 ? 0.1 : 0,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: JSON.stringify({ tagUniverse, articles: evidence }) },
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
    return validateContent(parseJsonObject(content));
  }
}

function systemPrompt() {
  return [
    '당신은 한국 ETF 태그 브리핑 편집자입니다.',
    ...SYSTEM_PROMPT_RULES,
    '반드시 다음 JSON 스키마만 출력하세요: {"title":"...","summary":"...","keyPoints":["..."],"mentionedStockIds":["..."],"mentionedTopicIds":["..."]}.',
    'mentionedStockIds와 mentionedTopicIds는 입력 기사에 실제로 등장한 ID만 사용하세요.',
  ].join('\n');
}

function parseJsonObject(content) {
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(unfenced.slice(start, end + 1)); } catch { /* below */ }
    }
    throw new ProviderError(ErrorCodes.PARSE_ERROR, 'openrouter brief json', { provider: 'openrouter' });
  }
}

function validateContent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderError(ErrorCodes.PARSE_ERROR, 'brief content must be an object', { provider: 'openrouter' });
  }
  const ok = typeof value.title === 'string'
    && typeof value.summary === 'string'
    && Array.isArray(value.keyPoints)
    && value.keyPoints.every((item) => typeof item === 'string')
    && Array.isArray(value.mentionedStockIds)
    && value.mentionedStockIds.every((item) => typeof item === 'string')
    && Array.isArray(value.mentionedTopicIds)
    && value.mentionedTopicIds.every((item) => typeof item === 'string');
  if (!ok) {
    throw new ProviderError(ErrorCodes.PARSE_ERROR, 'invalid brief content schema', { provider: 'openrouter' });
  }
  return {
    title: value.title,
    summary: value.summary,
    keyPoints: value.keyPoints.slice(0, 3),
    mentionedStockIds: [...new Set(value.mentionedStockIds)],
    mentionedTopicIds: [...new Set(value.mentionedTopicIds)],
  };
}

export default OpenRouterTagBriefClient;
