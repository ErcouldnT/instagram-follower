import { error } from "@sveltejs/kit";
import { USER_FILTERS, type UserFilter } from "$lib/constants";
import { getScan, getScanBreakdown, getScanUsers } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(400, "Invalid scan id");

	const scan = await getScan(id);
	if (!scan) error(404, "Scan not found");

	const search = url.searchParams.get("q") ?? "";
	const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
	const requested = url.searchParams.get("filter") ?? "all";
	const filter = (USER_FILTERS.includes(requested as UserFilter) ? requested : "all") as UserFilter;

	// Paginating and filtering in SQL means the browser receives one page of
	// rows instead of the whole scan.
	const [{ users, total, totalPages }, breakdown] = await Promise.all([
		getScanUsers({ scanId: id, page, search, filter }),
		getScanBreakdown(id)
	]);

	return { scan, users, total, totalPages, page, search, filter, breakdown };
};
