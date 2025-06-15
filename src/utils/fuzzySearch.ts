export interface FuzzySearchResult<T> {
  item: T;
  score: number;
  matches: number[];
}

export function fuzzySearch<T>(
  query: string,
  items: T[],
  getValue: (item: T) => string[]
): FuzzySearchResult<T>[] {
  if (!query) {
    return items.map(item => ({ item, score: 0, matches: [] }));
  }

  const results: FuzzySearchResult<T>[] = [];
  const queryLower = query.toLowerCase();
  const queryChars = queryLower.split('');

  for (const item of items) {
    const values = getValue(item);
    let bestScore = -1;
    let bestMatches: number[] = [];

    for (const value of values) {
      const valueLower = value.toLowerCase();
      const { score, matches } = fuzzyMatch(queryChars, valueLower);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatches = matches;
      }
    }

    if (bestScore > 0) {
      results.push({ item, score: bestScore, matches: bestMatches });
    }
  }

  // Sort by score (highest first)
  return results.sort((a, b) => b.score - a.score);
}

function fuzzyMatch(queryChars: string[], text: string): { score: number; matches: number[] } {
  let score = 0;
  let matches: number[] = [];
  let queryIndex = 0;
  let lastMatchIndex = -1;
  
  for (let i = 0; i < text.length && queryIndex < queryChars.length; i++) {
    if (text[i] === queryChars[queryIndex]) {
      matches.push(i);
      
      // Base score for match
      score += 10;
      
      // Bonus for consecutive matches
      if (lastMatchIndex === i - 1) {
        score += 5;
      }
      
      // Bonus for matching at word boundaries
      if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '-' || text[i - 1] === '_') {
        score += 15;
      }
      
      // Bonus for matching capital letters (camelCase)
      if (text[i] !== text[i].toLowerCase()) {
        score += 10;
      }
      
      // Penalty for distance from last match
      if (lastMatchIndex !== -1) {
        score -= (i - lastMatchIndex - 1) * 2;
      }
      
      lastMatchIndex = i;
      queryIndex++;
    }
  }
  
  // If not all query characters were matched, return no match
  if (queryIndex < queryChars.length) {
    return { score: 0, matches: [] };
  }
  
  // Bonus for shorter strings (more relevant)
  score += Math.max(0, 50 - text.length);
  
  // Bonus for exact match
  if (text.toLowerCase() === queryChars.join('')) {
    score += 100;
  }
  
  // Bonus for prefix match
  if (text.toLowerCase().startsWith(queryChars.join(''))) {
    score += 50;
  }
  
  return { score, matches };
}