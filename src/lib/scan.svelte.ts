import { LIST_LABELS, type ListKind } from "$lib/constants";

interface ScanEvent {
	type: "started" | "progress" | "log" | "done" | "error";
	scanId?: number;
	list?: ListKind;
	current?: number;
	total?: number;
	percentage?: number;
	message?: string;
	followingCount?: number;
	followersCount?: number;
}

/**
 * Splits a byte stream into whole JSON lines.
 *
 * A chunk boundary can land in the middle of a JSON object, so parsing each
 * chunk on its own — as the original store did — drops records whenever a
 * record straddles two reads. Holding the remainder in a buffer fixes that.
 */
async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<ScanEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			let newline: number;
			while ((newline = buffer.indexOf("\n")) !== -1) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (line) yield JSON.parse(line) as ScanEvent;
			}
		}

		const tail = buffer.trim();
		if (tail) yield JSON.parse(tail) as ScanEvent;
	} finally {
		reader.releaseLock();
	}
}

const number = (value: number) => value.toLocaleString("tr-TR");

class ScanState {
	scanId = $state<number | null>(null);
	isScanning = $state(false);
	progress = $state(0);
	status = $state("Idle");
	logs = $state<string[]>([]);
	error = $state<string | null>(null);
	targetUsername = $state("");
	finished = $state(false);

	reset() {
		this.scanId = null;
		this.isScanning = false;
		this.progress = 0;
		this.status = "Idle";
		this.logs = [];
		this.error = null;
		this.targetUsername = "";
		this.finished = false;
	}

	async start(userId: string, username: string, lists: ListKind[]) {
		if (this.isScanning) return;

		this.reset();
		this.isScanning = true;
		this.targetUsername = username;
		this.status = "Starting scan...";

		try {
			const response = await fetch("/api/scan", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userId, username, lists })
			});

			if (!response.ok || !response.body) {
				const detail = await response
					.json()
					.then((data: { message?: string }) => data.message)
					.catch(() => null);
				throw new Error(detail ?? `Scan failed to start (HTTP ${response.status})`);
			}

			await this.consume(response.body);
		} catch (err) {
			this.error = err instanceof Error ? err.message : "Failed to start scan";
			this.status = "Failed";
			this.isScanning = false;
			this.finished = true;
		}
	}

	private async consume(body: ReadableStream<Uint8Array>) {
		for await (const event of ndjson(body)) {
			switch (event.type) {
				case "started":
					this.scanId = event.scanId ?? null;
					this.status = "Scanning...";
					break;
				case "progress": {
					this.progress = event.percentage ?? 0;
					const label = event.list ? LIST_LABELS[event.list] : "Accounts";
					this.status = `${label}: ${number(event.current ?? 0)} of ${number(event.total ?? 0)}`;
					break;
				}
				case "log":
					if (event.message) this.logs = [...this.logs, event.message];
					break;
				case "done":
					this.progress = 100;
					this.status =
						`Done — ${number(event.followingCount ?? 0)} following, ` +
						`${number(event.followersCount ?? 0)} followers`;
					this.isScanning = false;
					this.finished = true;
					break;
				case "error":
					this.error = event.message ?? "Scan failed";
					this.status = "Failed";
					this.isScanning = false;
					this.finished = true;
					break;
			}
		}

		// The stream can end without a terminal event if the server goes away.
		if (this.isScanning) {
			this.isScanning = false;
			this.finished = true;
			this.status = "Connection closed";
		}
	}
}

export const scan = new ScanState();
