import type { Relation } from "$lib/constants";

interface ScanEvent {
	type: "started" | "progress" | "log" | "done" | "error";
	scanId?: number;
	current?: number;
	total?: number;
	percentage?: number;
	message?: string;
	count?: number;
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

class ScanState {
	scanId = $state<number | null>(null);
	isScanning = $state(false);
	progress = $state(0);
	status = $state("Idle");
	logs = $state<string[]>([]);
	scanned = $state(0);
	total = $state(0);
	error = $state<string | null>(null);
	targetUsername = $state("");
	finished = $state(false);

	reset() {
		this.scanId = null;
		this.isScanning = false;
		this.progress = 0;
		this.status = "Idle";
		this.logs = [];
		this.scanned = 0;
		this.total = 0;
		this.error = null;
		this.targetUsername = "";
		this.finished = false;
	}

	async start(userId: string, username: string, relation: Relation) {
		if (this.isScanning) return;

		this.reset();
		this.isScanning = true;
		this.targetUsername = username;
		this.status = "Starting scan...";

		try {
			const response = await fetch("/api/scan", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ userId, username, relation })
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
				case "progress":
					this.progress = event.percentage ?? 0;
					this.scanned = event.current ?? 0;
					this.total = event.total ?? 0;
					this.status = `Scanning ${this.scanned.toLocaleString("tr-TR")} of ${this.total.toLocaleString("tr-TR")}`;
					break;
				case "log":
					if (event.message) this.logs = [...this.logs, event.message];
					break;
				case "done":
					this.progress = 100;
					this.scanned = event.count ?? this.scanned;
					this.status = `Done — ${this.scanned.toLocaleString("tr-TR")} accounts saved`;
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
