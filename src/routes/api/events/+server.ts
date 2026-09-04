import { getQueueState, subscribe, type QueueState } from "$lib/server/queue";
import type { RequestHandler } from "./$types";

/** What a given user is allowed to see of the global queue. */
export interface QueueView {
	/** Total scans waiting, across everyone. */
	waiting: number;
	/** True when some scan — anyone's — currently holds the runner. */
	busy: boolean;
	/** The signed-in user's own scans in the queue, with their positions. */
	mine: {
		scanId: number;
		username: string;
		status: "queued" | "running";
		position: number | null;
		percentage: number;
		list: string | null;
		current: number;
		total: number;
		log: string[];
	}[];
}

/**
 * Other people's scans are private, so the stream reports only aggregate facts
 * about them — how many are waiting, and whether the runner is busy — while
 * details are limited to the viewer's own scans.
 */
function project(state: QueueState, userId: string): QueueView {
	const running = state.running;

	return {
		waiting: state.entries.filter((entry) => entry.status === "queued").length,
		busy: state.entries.some((entry) => entry.status === "running"),
		mine: state.entries
			.filter((entry) => entry.userId === userId)
			.map((entry) => {
				const isRunning = entry.status === "running" && running?.scanId === entry.scanId;
				return {
					scanId: entry.scanId,
					username: entry.username,
					status: entry.status,
					position: entry.position,
					percentage: isRunning ? running.progress.percentage : 0,
					list: isRunning ? running.progress.list : null,
					current: isRunning ? running.progress.current : 0,
					total: isRunning ? running.progress.total : 0,
					log: isRunning ? running.progress.log : []
				};
			})
	};
}

export const GET: RequestHandler = async ({ locals, request }) => {
	const user = locals.user;
	if (!user) return new Response("Unauthorized", { status: 401 });

	const encoder = new TextEncoder();
	let unsubscribe: (() => void) | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let closed = false;

			const send = (view: QueueView) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(view)}\n\n`));
				} catch {
					// The client vanished between the check and the write.
					closed = true;
				}
			};

			send(project(await getQueueState(), user.id));

			unsubscribe = subscribe((state) => send(project(state, user.id)));

			// Idle connections get reaped by proxies; a comment frame keeps the
			// pipe warm without being parsed as an event.
			heartbeat = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(": keep-alive\n\n"));
				} catch {
					closed = true;
				}
			}, 25_000);

			request.signal.addEventListener("abort", () => {
				closed = true;
			});
		},
		cancel() {
			unsubscribe?.();
			if (heartbeat) clearInterval(heartbeat);
		}
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-store",
			Connection: "keep-alive",
			// Without this Coolify's proxy buffers the stream and nothing arrives
			// until the scan finishes.
			"X-Accel-Buffering": "no"
		}
	});
};
