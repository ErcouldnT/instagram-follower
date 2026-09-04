import { auth } from "$lib/server/auth";
import type { RequestHandler } from "./$types";

/** Better Auth's own endpoints: sign-up, sign-in, sign-out, session. */
export const GET: RequestHandler = ({ request }) => auth.handler(request);
export const POST: RequestHandler = ({ request }) => auth.handler(request);
