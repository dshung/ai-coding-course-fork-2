export const MIN_RATING = 1;
export const MAX_RATING = 5;

// Every course is scored as if it already had PRIOR_WEIGHT ratings of
// PRIOR_RATING, so a handful of real ratings cannot swing the score to an
// extreme. See "Rating Score" in CONTEXT.md.
export const PRIOR_RATING = 3;
export const PRIOR_WEIGHT = 5;

export type RatingSummary = {
  // The Rating Score, not the raw average. Null when there are no ratings.
  average: number | null;
  count: number;
};

export const EMPTY_RATING_SUMMARY: RatingSummary = { average: null, count: 0 };

/**
 * Turns the sum and count of a course's ratings into its Rating Score,
 * rounded to one decimal place.
 */
export function summarizeRatings(total: number, count: number): RatingSummary {
  if (count <= 0) {
    return EMPTY_RATING_SUMMARY;
  }

  const score =
    (PRIOR_RATING * PRIOR_WEIGHT + total) / (PRIOR_WEIGHT + count);

  return { average: Math.round(score * 10) / 10, count };
}
