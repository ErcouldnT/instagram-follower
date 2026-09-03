/** Which Instagram edge list a scan walks. */
export const RELATIONS = ["following", "followers"] as const;
export type Relation = (typeof RELATIONS)[number];

export const RELATION_LABELS: Record<Relation, string> = {
	following: "Following",
	followers: "Followers"
};

/** Accounts requested per GraphQL page. Instagram caps this around 50. */
export const PAGE_SIZE = 50;

/** Base delay between page requests, in ms. Jittered at the call site. */
export const DELAY_BETWEEN_PAGES_MS = 1_000;

/** Pages fetched before taking the longer cool-down pause. */
export const PAGES_BEFORE_LONG_PAUSE = 5;

/** Length of that cool-down pause, in ms. */
export const LONG_PAUSE_MS = 10_000;

/**
 * Hard ceiling on pages per scan. Instagram occasionally returns a cursor that
 * never advances; without a bound the pagination loop never terminates.
 */
export const MAX_PAGES = 2_000;

/** Rows per page in the scan detail table. */
export const USERS_PER_PAGE = 25;
