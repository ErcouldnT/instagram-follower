<script lang="ts">
	import "../app.css";
	import { resolve } from "$app/paths";
	import { queue } from "$lib/queue.svelte";
	import { onMount, type Snippet } from "svelte";
	import type { LayoutData } from "./$types";

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	// One event stream per tab, opened only for signed-in users.
	onMount(() => (data.user ? queue.connect() : undefined));

	async function logout() {
		const { signOut } = await import("$lib/auth-client");
		await signOut();
		window.location.href = "/login";
	}
</script>

<svelte:head>
	<title>Instagram Follower</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if data.user}
	<header class="border-b border-line">
		<nav class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
			<div class="flex items-center gap-4 text-sm">
				<a href={resolve("/")} class="font-semibold">Instagram Follower</a>
				<a href={resolve("/scans")} class="text-ink-dim hover:underline">History</a>
			</div>
			<div class="flex items-center gap-3 text-sm">
				<span class="hidden text-ink-dim sm:inline">{data.user.email}</span>
				<button class="btn" onclick={logout}>Sign out</button>
			</div>
		</nav>
	</header>
{/if}

<div class="min-h-dvh {queue.mine.length > 0 ? 'pb-32' : ''}">
	{@render children()}
</div>

{#if data.user && queue.mine.length > 0}
	<div class="fixed inset-x-0 bottom-0 z-90 border-t border-line bg-surface-2/95 backdrop-blur">
		<div class="mx-auto max-w-4xl space-y-3 px-4 py-3">
			{#each queue.mine as scan (scan.scanId)}
				<div class="flex items-center gap-4">
					<div class="min-w-0 flex-1">
						<div class="mb-1 flex items-baseline justify-between gap-3 text-sm">
							<span class="truncate font-semibold">{scan.username}</span>
							<span class="shrink-0 text-xs text-ink-dim">{queue.statusText(scan)}</span>
						</div>

						{#if scan.status === "running"}
							<div
								class="h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
								role="progressbar"
								aria-valuenow={scan.percentage}
								aria-valuemin="0"
								aria-valuemax="100"
								aria-label="Scan progress"
							>
								<div
									class="h-full rounded-full bg-brand transition-all duration-300"
									style="width: {scan.percentage}%"
								></div>
							</div>
						{:else}
							<!-- Queued: a striped bar reads as "not started" rather than 0% done -->
							<div class="h-1.5 w-full rounded-full bg-surface-3">
								<div class="h-full w-full animate-pulse rounded-full bg-surface-3"></div>
							</div>
						{/if}

						{#if scan.log.length > 0}
							<p class="mt-1 truncate font-mono text-xs text-ink-dim">{scan.log.at(-1)}</p>
						{/if}
					</div>

					<div class="flex shrink-0 gap-2">
						<a class="btn" href={resolve("/scans/[id]", { id: String(scan.scanId) })}>View</a>
						{#if scan.status === "queued"}
							<button class="btn" onclick={() => queue.cancel(scan.scanId)}>Cancel</button>
						{/if}
					</div>
				</div>
			{/each}

			{#if queue.waiting > 0}
				<p class="text-center text-xs text-ink-dim">
					{queue.waiting}
					{queue.waiting === 1 ? "scan is" : "scans are"} waiting. Only one runs at a time — every account
					shares the same Instagram session.
				</p>
			{/if}

			{#if !queue.connected}
				<p class="text-center text-xs text-amber-300">Reconnecting to live updates...</p>
			{/if}
		</div>
	</div>
{/if}
