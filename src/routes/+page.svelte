<script lang="ts">
	import { resolve } from "$app/paths";
	import Avatar from "$lib/components/Avatar.svelte";
	import { LIST_HINTS, LIST_LABELS, LISTS, type ListKind } from "$lib/constants";
	import { scan } from "$lib/scan.svelte";
	import type { PageData } from "./$types";

	interface SearchResult {
		id: string;
		username: string;
		fullName: string;
		profilePicUrl: string;
		isPrivate: boolean;
		isVerified: boolean;
	}

	let { data }: { data: PageData } = $props();

	let query = $state("");
	// Both by default: the interesting questions ("doesn't follow back") need
	// each list, and they can only be answered when one scan holds both.
	let lists = $state<ListKind[]>(["following", "followers"]);
	let results = $state<SearchResult[]>([]);
	let searching = $state(false);
	let searchError = $state<string | null>(null);
	let searched = $state(false);

	async function search(event: SubmitEvent) {
		// The original bound this to on:submit without preventing the default,
		// so the form navigated and threw the results away on every search.
		event.preventDefault();

		const term = query.trim();
		if (!term || searching) return;

		searching = true;
		searchError = null;
		results = [];

		try {
			const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
			const body = (await response.json()) as { users?: SearchResult[]; message?: string };
			if (!response.ok) throw new Error(body.message ?? `Search failed (HTTP ${response.status})`);
			results = body.users ?? [];
		} catch (error) {
			searchError = error instanceof Error ? error.message : "Search failed";
		} finally {
			searching = false;
			searched = true;
		}
	}

	function toggleList(list: ListKind) {
		lists = lists.includes(list) ? lists.filter((item) => item !== list) : [...lists, list];
	}
</script>

<div class="mx-auto max-w-2xl px-4 py-12">
	<header class="mb-8 flex items-start justify-between gap-4">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Instagram Follower</h1>
			<p class="mt-1 text-sm text-ink-dim">
				Capture a profile's social graph, then compare captures over time.
			</p>
		</div>
		<a href={resolve("/scans")} class="btn shrink-0">History</a>
	</header>

	{#if !data.configured}
		<p class="card mb-6 border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
			No Instagram session is configured. Set <code class="font-mono">IG_COOKIE</code> in the environment
			before scanning.
		</p>
	{/if}

	<form onsubmit={search} class="card space-y-4 p-5">
		<div>
			<label for="username" class="mb-1.5 block text-sm font-medium">Username</label>
			<input
				id="username"
				class="input"
				type="text"
				autocomplete="off"
				placeholder="ercouldnt"
				bind:value={query}
			/>
		</div>

		<fieldset>
			<legend class="mb-1.5 text-sm font-medium">Capture</legend>
			<div class="space-y-2">
				{#each LISTS as list (list)}
					<label class="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3">
						<input
							type="checkbox"
							class="mt-0.5 size-4 accent-brand"
							checked={lists.includes(list)}
							onchange={() => toggleList(list)}
						/>
						<span>
							<span class="block text-sm font-medium">{LIST_LABELS[list]}</span>
							<span class="block text-xs text-ink-dim">{LIST_HINTS[list]}</span>
						</span>
					</label>
				{/each}
			</div>
			{#if lists.length === 2}
				<p class="mt-2 text-xs text-ink-dim">
					Capturing both is what makes "doesn't follow back" answerable. It also doubles the
					requests sent to Instagram.
				</p>
			{:else if lists.length === 1}
				<p class="mt-2 text-xs text-amber-300">
					With one list, mutual and "doesn't follow back" cannot be computed.
				</p>
			{:else}
				<p class="mt-2 text-xs text-red-300">Pick at least one list.</p>
			{/if}
		</fieldset>

		<button
			type="submit"
			class="btn btn-brand w-full"
			disabled={searching || !query.trim() || !data.configured}
		>
			{searching ? "Searching..." : "Search"}
		</button>
	</form>

	{#if searchError}
		<p class="card mt-4 border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
			{searchError}
		</p>
	{/if}

	{#if results.length > 0}
		<section class="mt-6">
			<h2 class="mb-3 text-sm font-medium text-ink-dim">Pick a profile to scan</h2>
			<ul class="space-y-2">
				{#each results as result (result.id)}
					<li>
						<button
							class="card flex w-full items-center gap-4 p-3 text-left transition-colors hover:border-brand disabled:opacity-50"
							disabled={scan.isScanning || lists.length === 0}
							onclick={() => scan.start(result.id, result.username, lists)}
						>
							<Avatar src={result.profilePicUrl} username={result.username} size={48} />
							<div class="min-w-0 flex-1">
								<p class="truncate font-semibold">{result.fullName || result.username}</p>
								<p class="truncate text-sm text-ink-dim">@{result.username}</p>
							</div>
							<div class="flex shrink-0 gap-1">
								{#if result.isVerified}<span class="badge">Verified</span>{/if}
								<span class="badge">{result.isPrivate ? "Private" : "Public"}</span>
							</div>
						</button>
					</li>
				{/each}
			</ul>
			{#if scan.isScanning}
				<p class="mt-3 text-xs text-ink-dim">A scan is already running.</p>
			{/if}
		</section>
	{:else if searched && !searching && !searchError}
		<p class="mt-6 text-center text-sm text-ink-dim">No profiles matched that username.</p>
	{/if}

	{#if scan.logs.length > 0}
		<section class="card mt-6 p-4">
			<h2 class="mb-2 text-sm font-medium">Scan log</h2>
			<ul class="space-y-1 font-mono text-xs text-ink-dim">
				{#each scan.logs.slice(-6) as line, index (index)}
					<li>{line}</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>
