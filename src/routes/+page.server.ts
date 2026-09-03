import { hasInstagramCredentials } from "$lib/server/config";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
	configured: hasInstagramCredentials()
});
