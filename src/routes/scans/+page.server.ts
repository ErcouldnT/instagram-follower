import { error, fail } from "@sveltejs/kit";
import { compareScans, deleteScan, growthSeries, listScans } from "$lib/server/queries";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) error(401, "Authentication required");

	return {
		scans: await listScans(user.id),
		series: await growthSeries(user.id)
	};
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) error(401, "Authentication required");

		const form = await request.formData();
		const id = Number(form.get("id"));
		if (!Number.isInteger(id)) return fail(400, { message: "Invalid scan id" });

		// Ownership is part of the delete predicate, so another user's id simply
		// matches nothing rather than deleting their scan.
		if (!(await deleteScan(id, user.id))) {
			return fail(404, { message: "That scan no longer exists." });
		}
		return { deleted: true };
	},

	compare: async ({ request, locals }) => {
		const user = locals.user;
		if (!user) error(401, "Authentication required");

		const form = await request.formData();
		const a = Number(form.get("a"));
		const b = Number(form.get("b"));
		if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
			return fail(400, { message: "Select two different scans" });
		}

		try {
			return { comparison: await compareScans(a, b, user.id) };
		} catch (err) {
			return fail(400, {
				message: err instanceof Error ? err.message : "Comparison failed"
			});
		}
	}
};
