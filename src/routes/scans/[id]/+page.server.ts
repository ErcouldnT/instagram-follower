import { error } from "@sveltejs/kit";
import { USER_FILTERS, type UserFilter } from "$lib/constants";
import { getScan, getScanBreakdown, getScanUsers } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const user = locals.user;
	if (!user) error(401, "Authentication required");

	const id = Number(params.id);
	if (!Number.isInteger(id)) error(400, "Invalid scan id");

	// Scoped by owner, so another user's scan is indistinguishable from one that
	// does not exist — no id probing.
	const scan = await getScan(id, user.id);
	if (!scan) error(404, "Scan not found");

	const search = url.searchParams.get("q") ?? "";
	const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
	const requested = url.searchParams.get("filter") ?? "all";
	const filter = (USER_FILTERS.includes(requested as UserFilter) ? requested : "all") as UserFilter;

	const [{ users, total, totalPages }, breakdown] = await Promise.all([
		getScanUsers({ scanId: id, page, search, filter }),
		getScanBreakdown(id)
	]);

	return { scan, users, total, totalPages, page, search, filter, breakdown };
};
