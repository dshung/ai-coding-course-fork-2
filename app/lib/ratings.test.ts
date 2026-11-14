import { describe, it, expect } from "vitest";
import { summarizeRatings, EMPTY_RATING_SUMMARY } from "./ratings";

describe("summarizeRatings", () => {
  it("reports no score when nobody has rated", () => {
    expect(summarizeRatings(0, 0)).toEqual(EMPTY_RATING_SUMMARY);
  });

  it("pulls a single perfect rating towards neutral", () => {
    // (5 × 3 + 5) / (5 + 1) = 3.33…
    expect(summarizeRatings(5, 1)).toEqual({ average: 3.3, count: 1 });
  });

  it("pulls a single terrible rating towards neutral", () => {
    // (15 + 1) / 6 = 2.66…
    expect(summarizeRatings(1, 1)).toEqual({ average: 2.7, count: 1 });
  });

  it("approaches the raw average as ratings build up", () => {
    // 50 perfect ratings: (15 + 250) / 55 = 4.81…
    expect(summarizeRatings(250, 50)).toEqual({ average: 4.8, count: 50 });
  });

  it("leaves a neutral course at neutral", () => {
    expect(summarizeRatings(30, 10)).toEqual({ average: 3, count: 10 });
  });
});
