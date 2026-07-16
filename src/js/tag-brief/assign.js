// Pure news -> tag assignment via dual anchors (stock codes + topic ids).
// No DOM/window access; no taxonomy/filter-map access (see universeAdapter.js).

// Assignment rule: article `a` joins universe `u` iff
// (a.mentionedStockIds ∩ u.stockIds) ∪ (a.mentionedTopicIds ∩ u.topicIds) ≠ ∅.
export function articleMatchesUniverse(article, universe) {
  const stockHit = article.mentionedStockIds.some((id) => universe.stockIds.includes(id));
  const topicHit = article.mentionedTopicIds.some((id) => universe.topicIds.includes(id));
  return stockHit || topicHit;
}

// Assigns each article to every universe it matches (an article may join
// multiple tags). Returns { byTag: Map<tagId, article[]>, unassigned: article[] }.
// `universes` accepts a Map<tagId, TagUniverse> (as returned by
// buildTagUniverses()) or a plain array of TagUniverse objects.
export function assignArticles(articles, universes) {
  const universeList = universes instanceof Map ? [...universes.values()] : universes;
  const byTag = new Map(universeList.map((universe) => [universe.tagId, []]));
  const unassigned = [];

  for (const article of articles) {
    let matchedAny = false;
    for (const universe of universeList) {
      if (articleMatchesUniverse(article, universe)) {
        byTag.get(universe.tagId).push(article);
        matchedAny = true;
      }
    }
    if (!matchedAny) unassigned.push(article);
  }

  return { byTag, unassigned };
}

// Every mentionedTopicIds entry in a set of articles must exist in the
// controlled-vocabulary topic registry (data/fixtures/topic-registry.json).
// Returns a list of { articleId, topicId } violations (empty = valid).
export function validateTopicRegistry(articles, registry) {
  const validTopicIds = new Set(Object.keys(registry.topics));
  const violations = [];
  for (const article of articles) {
    for (const topicId of article.mentionedTopicIds) {
      if (!validTopicIds.has(topicId)) violations.push({ articleId: article.id, topicId });
    }
  }
  return violations;
}
