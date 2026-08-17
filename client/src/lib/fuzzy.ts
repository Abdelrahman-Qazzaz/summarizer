/**
 * Subsequence matching with scoring, for the model search.
 *
 * A model catalogue is full of near-identical ids, so plain substring matching
 * makes you type the separators exactly: "gpt4o" should find "GPT-4o" and
 * "clsonnet" should find "Claude Sonnet". Every query character must still
 * appear in order — this narrows, it doesn't guess.
 */

const CONSECUTIVE_BONUS = 8;
const WORD_START_BONUS = 10;
const LEADING_PENALTY = 2;
const MAX_LEADING_PENALTY = 12;

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1];
  return !/[a-z0-9]/i.test(previous) || (/[a-z]/.test(previous) && /[A-Z]/.test(text[index]));
}

/**
 * Higher is better; null when `query` is not a subsequence of `text`.
 * An empty query matches everything with a score of 0.
 */
export function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0;

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  // A literal substring is always the strongest signal available.
  const direct = haystack.indexOf(needle);
  if (direct !== -1) {
    return (
      1000 +
      (isWordStart(text, direct) ? WORD_START_BONUS * 2 : 0) -
      Math.min(direct, MAX_LEADING_PENALTY)
    );
  }

  let score = 0;
  let cursor = 0;
  let previousMatch = -1;

  for (const character of needle) {
    if (character === " ") continue;
    const found = haystack.indexOf(character, cursor);
    if (found === -1) return null;

    if (found === previousMatch + 1) score += CONSECUTIVE_BONUS;
    if (isWordStart(text, found)) score += WORD_START_BONUS;
    if (previousMatch === -1) {
      score -= Math.min(found * LEADING_PENALTY, MAX_LEADING_PENALTY);
    }

    previousMatch = found;
    cursor = found + 1;
  }

  // Shorter matches are tighter matches: "gpt-4o" beats "gpt-4o-mini-search".
  return score - Math.min(haystack.length / 10, 10);
}

/**
 * Best score across several fields, so a query can match a model's display
 * name, its id, or its provider without the caller ranking them separately.
 */
export function fuzzyScoreAny(
  fields: readonly string[],
  query: string,
): number | null {
  let best: number | null = null;
  for (const field of fields) {
    const score = fuzzyScore(field, query);
    if (score !== null && (best === null || score > best)) best = score;
  }
  return best;
}
