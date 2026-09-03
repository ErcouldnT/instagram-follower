import { fail } from "@sveltejs/kit";
import { compareScans, deleteScan, growthSeries, listScans } from "$lib/server/queries";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => ({
	scans: await listScans(),
	series: await growthSeries()
});

export const actions: Actions = {
	delete: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get("id"));
		if (!Number.isInteger(id)) return fail(400, { message: "Invalid scan id" });

		await deleteScan(id);
		return { deleted: true };
	},

	compare: async ({ request }) => {
		const form = await request.formData();
		const a = Number(form.get("a"));
		const b = Number(form.get("b"));
		if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
			return fail(400, { message: "Select two different scans" });
		}

		try {
			const comparison = await compareScans(a, b);
			return {
				comparison: {
					olderLabel: comparison.older.createdAt.toISOString(),
					newerLabel: comparison.newer.createdAt.toISOString(),
					username: comparison.newer.username,
					relation: comparison.newer.relation,
					gained: comparison.gained,
					lost: comparison.lost
				}
			};
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : "Comparison failed"
			});
		}
	}
};
