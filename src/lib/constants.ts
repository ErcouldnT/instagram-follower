/** The two edge lists a scan can capture. */
export const LISTS = ["following", "followers"] as const;
export type ListKind = (typeof LISTS)[number];

export const LIST_LABELS: Record<ListKind, string> = {
	following: "Following",
	followers: "Followers"
};

export const LIST_HINTS: Record<ListKind, string> = {
	following: "Accounts this profile follows",
	followers: "Accounts that follow this profile"
};

/** Accounts requested per page. Instagram caps this well below 100. */
export const PAGE_SIZE = 50;

/** Base delay between page requests, in ms. Jittered at the call site. */
export const DELAY_BETWEEN_PAGES_MS = 1_000;

/** Pages fetched before taking the longer cool-down pause. */
export const PAGES_BEFORE_LONG_PAUSE = 5;

/** Length of that cool-down pause, in ms. */
export const LONG_PAUSE_MS = 10_000;

/**
 * Hard ceiling on pages per list. Instagram occasionally returns a cursor that
 * never advances; without a bound the pagination loop never terminates.
 */
export const MAX_PAGES = 2_000;

/** Rows per page in the scan detail table. */
export const USERS_PER_PAGE = 25;

/** Relationship filters on the scan detail page. */
export const USER_FILTERS = [
	"all",
	"not_following_back",
	"not_followed_back",
	"mutual",
	"following",
	"followers"
] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

export const USER_FILTER_LABELS: Record<UserFilter, string> = {
	all: "Everyone",
	not_following_back: "Doesn't follow back",
	not_followed_back: "Not followed back",
	mutual: "Mutual",
	following: "Following",
	followers: "Followers"
};
