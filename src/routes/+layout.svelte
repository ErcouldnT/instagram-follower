<script lang="ts">
	import "../app.css";
	import { resolve } from "$app/paths";
	import { scan } from "$lib/scan.svelte";
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	<title>Instagram Follower</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="min-h-dvh pb-24">
	{@render children()}
</div>

{#if scan.isScanning || scan.finished}
	<div class="fixed inset-x-0 bottom-0 z-90 border-t border-line bg-surface-2/95 backdrop-blur">
		<div class="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
			<div class="min-w-0 flex-1">
				<div class="mb-1 flex items-baseline justify-between gap-3 text-sm">
					<span class="truncate font-semibold">{scan.targetUsername}</span>
					<span class="shrink-0 text-xs text-ink-dim">{scan.status}</span>
				</div>
				<div
					class="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
					role="progressbar"
					aria-valuenow={scan.progress}
					aria-valuemin="0"
					aria-valuemax="100"
					aria-label="Scan progress"
				>
					<div
						class="h-full rounded-full transition-all duration-300 {scan.error
							? 'bg-red-500'
							: 'bg-brand'}"
						style="width: {scan.progress}%"
					></div>
				</div>
				{#if scan.error}
					<p class="mt-1 text-xs text-red-400">{scan.error}</p>
				{/if}
			</div>

			{#if scan.finished}
				<div class="flex shrink-0 gap-2">
					{#if scan.scanId && !scan.error}
						<a class="btn" href={resolve("/scans/[id]", { id: String(scan.scanId) })}>View</a>
					{/if}
					<button class="btn" onclick={() => scan.reset()}>Dismiss</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
