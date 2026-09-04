import { LIST_LABELS, type ListKind } from "$lib/constants";

export interface MyScan {
	scanId: number;
	username: string;
	status: "queued" | "running";
	position: number | null;
	percentage: number;
	list: ListKind | null;
	current: number;
	total: number;
	log: string[];
}

interface QueueView {
	waiting: number;
	busy: boolean;
	mine: MyScan[];
}

const number = (value: number) => value.toLocaleString("tr-TR");

/**
 * Live queue state over server-sent events.
 *
 * EventSource reconnects on its own after a drop, which is the reason for
 * preferring it here: a scan can sit in the queue for a long time, and the
 * previous streaming-response approach lost all state the moment the
 * connection blipped or the page was reloaded.
 */
class QueueState {
	waiting = $state(0);
	busy = $state(false);
	mine = $state<MyScan[]>([]);
	connected = $state(false);

	#source: EventSource | null = null;

	/** The scan this browser most recently started, if still active. */
	active = $derived(this.mine.find((scan) => scan.status === "running") ?? this.mine[0] ?? null);

	statusText(scan: MyScan): string {
		if (scan.status === "queued") {
			return scan.position === 1
				? "Next in line"
				: `Waiting — position ${scan.position ?? "?"} of ${this.waiting}`;
		}
		if (scan.total > 0 && scan.list) {
			return `${LIST_LABELS[scan.list]}: ${number(scan.current)} of ${number(scan.total)}`;
		}
		return "Scanning...";
	}

	connect(): () => void {
		if (this.#source) return () => {};

		const source = new EventSource("/api/events");
		this.#source = source;

		source.onopen = () => (this.connected = true);
		source.onerror = () => (this.connected = false);
		source.onmessage = (event) => {
			const view = JSON.parse(event.data as string) as QueueView;
			this.waiting = view.waiting;
			this.busy = view.busy;
			this.mine = view.mine;
			this.connected = true;
		};

		return () => {
			source.close();
			this.#source = null;
			this.connected = false;
		};
	}

	async start(instagramUserId: string, username: string, lists: ListKind[]) {
		const response = await fetch("/api/scan", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userId: instagramUserId, username, lists })
		});

		if (!response.ok) {
			const detail = (await response.json().catch(() => null)) as { message?: string } | null;
			throw new Error(detail?.message ?? `Could not queue the scan (HTTP ${response.status})`);
		}
	}

	async cancel(scanId: number) {
		await fetch(`/api/scan?scanId=${scanId}`, { method: "DELETE" });
	}
}

export const queue = new QueueState();
