import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseQuery } from '../../modules/reverse-search/src/nlu.js';
import { config } from '../config.js';
import { OpenRouterQueryPlannerClient } from '../llm/openrouter-query-planner.js';
import {
  buildRuleQueryPlan,
  createTaxonomyIndex,
  validateQueryPlan,
} from '../../modules/reverse-search/src/query-plan.js';

const taxonomyPath = fileURLToPath(new URL('../../config/etf-tagging/etf-taxonomy.json', import.meta.url));
const taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf8'));
const taxonomyIndex = createTaxonomyIndex(taxonomy);

export function createReverseSearchQueryPlanner({ llmClient = null } = {}) {
  return {
    async createPlan(query) {
      if (llmClient) {
        try {
          const candidate = await llmClient.createPlan({ query, taxonomy });
          const validated = validateQueryPlan(candidate, taxonomyIndex);
          if (validated.plan.tags.length || validated.plan.sort) {
            return { ...validated, source: 'llm', model: llmClient.model || null, taxonomyVersion: taxonomy.version };
          }
        } catch {
          // LLM failure falls through to the deterministic planner.
        }
      }

      const parsed = parseQuery(query, new Map());
      const validated = validateQueryPlan(buildRuleQueryPlan(parsed), taxonomyIndex);
      return { ...validated, source: 'rules', model: null, taxonomyVersion: taxonomy.version };
    },
  };
}

const openrouterClient = new OpenRouterQueryPlannerClient({
  ...config.llm.openrouter,
});

export const reverseSearchQueryPlanner = createReverseSearchQueryPlanner({
  llmClient: openrouterClient.isAvailable() ? openrouterClient : null,
});
