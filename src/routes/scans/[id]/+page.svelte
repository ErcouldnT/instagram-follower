<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page as pageStore } from "$app/state";
	import Avatar from "$lib/components/Avatar.svelte";
	import { RELATION_LABELS } from "$lib/constants";
	import { formatDate, formatNumber } from "$lib/format";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// A writable derived: seeded from the URL, freely typed into, and resynced
	// whenever navigation (including back/forward) changes the query string.
	let search = $derived(data.search);
	let timer: ReturnType<typeof setTimeout>;

	/** Search and pagination live in the URL, so results stay shareable. */
	function navigate(params: { q?: string; page?: number }) {
		const url = new URL(pageStore.url);
		const q = params.q ?? search;

		if (q.trim()) url.searchParams.set("q", q.trim());
		else url.searchParams.delete("q");

		if (params.page && params.page > 1) url.searchParams.set("page", String(params.page));
		else url.searchParams.delete("page");

		const query = url.searchParams.toString();
		const target = resolve("/scans/[id]", { id: String(data.scan.id) });
		// The path already comes from resolve(); the rule just cannot see through
		// the template literal that appends the query string.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		void goto(query ? `${target}?${query}` : target, { keepFocus: true, noScroll: true });
	}

	function onSearchInput() {
		clearTimeout(timer);
		timer = setTimeout(() => navigate({ page: 1 }), 300);
	}
</script>

<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
	<nav class="flex items-center justify-between gap-4 text-sm">
		<a href={resolve("/scans")} class="text-ink-dim hover:underline">← Scan history</a>
		<a href={resolve("/")} class="btn">New scan</a>
	</nav>

	<section class="card p-5">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-bold">{data.scan.username}</h1>
				<p class="mt-1 text-sm text-ink-dim">
					{RELATION_LABELS[data.scan.relation]} · captured {formatDate(data.scan.createdAt)}
				</p>
				<p class="mt-1 font-mono text-xs text-ink-dim">ID {data.scan.instagramUserId}</p>
			</div>

			<div class="flex flex-wrap justify-end gap-2">
				<span class="badge">Total {formatNumber(data.scan.count)}</span>
				{#if data.scan.verifiedCount > 0}
					<span class="badge">Verified {formatNumber(data.scan.verifiedCount)}</span>
				{/if}
				{#if data.scan.privateCount > 0}
					<span class="badge">Private {formatNumber(data.scan.privateCount)}</span>
				{/if}
			</div>
		</div>

		{#if data.scan.status === "failed"}
			<p
				class="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
			>
				This scan failed: {data.scan.error ?? "unknown error"}. The accounts below are what it
				managed to save first.
			</p>
		{:else if data.scan.status === "running"}
			<p
				class="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
			>
				This scan is still running — refresh for more.
			</p>
		{:else if data.scan.reportedCount !== null && data.scan.reportedCount !== data.scan.count}
			<!-- Surfacing the gap rather than fudging the total, as the old code did. -->
			<p class="mt-4 text-xs text-ink-dim">
				Instagram reported {formatNumber(data.scan.reportedCount)} accounts; {formatNumber(
					data.scan.count
				)} were retrieved. The reported figure is a snapshot and drifts during a scan.
			</p>
		{/if}
	</section>

	<section class="card overflow-hidden">
		<header
			class="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3"
		>
			<h2 class="font-semibold">
				{formatNumber(data.total)}
				{data.search ? "matching accounts" : "accounts"}
			</h2>
			<input
				class="input w-full sm:w-64"
				type="search"
				placeholder="Filter by username or name"
				bind:value={search}
				oninput={onSearchInput}
			/>
		</header>

		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="text-left text-xs text-ink-dim">
					<tr class="border-b border-line">
						<th class="px-4 py-2">Account</th>
						<th class="px-4 py-2">Status</th>
						<th class="px-4 py-2">Relationship</th>
						<th class="px-4 py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.users as user (user.id)}
						<tr class="border-b border-line/50 last:border-0 hover:bg-surface-3/40">
							<td class="px-4 py-2">
								<div class="flex items-center gap-3">
									<Avatar src={user.profilePicUrl} username={user.username} size={36} />
									<div class="min-w-0">
										<p class="truncate font-medium">{user.username}</p>
										{#if user.fullName}
											<p class="truncate text-xs text-ink-dim">{user.fullName}</p>
										{/if}
									</div>
								</div>
							</td>
							<td class="px-4 py-2">
								<div class="flex flex-wrap gap-1">
									{#if user.isVerified}<span class="badge">Verified</span>{/if}
									{#if user.isPrivate}<span class="badge">Private</span>{/if}
								</div>
							</td>
							<td class="px-4 py-2 text-xs">
								<div class="flex flex-col">
									{#if user.followedByViewer}<span class="text-emerald-400">You follow</span>{/if}
									{#if user.followsViewer}<span class="text-sky-400">Follows you</span>{/if}
									{#if user.requestedByViewer}<span class="text-amber-300">Requested</span>{/if}
								</div>
							</td>
							<td class="px-4 py-2 text-right">
								<a
									class="btn"
									href="https://instagram.com/{user.username}"
									target="_blank"
									rel="noopener noreferrer">Open</a
								>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="4" class="px-4 py-10 text-center text-sm text-ink-dim">
								{data.search ? "Nothing matched that filter." : "This scan stored no accounts."}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if data.totalPages > 1}
			<footer class="flex items-center justify-center gap-3 border-t border-line px-4 py-3">
				<button
					class="btn"
					disabled={data.page <= 1}
					onclick={() => navigate({ page: data.page - 1 })}>Previous</button
				>
				<span class="font-mono text-xs text-ink-dim">
					Page {data.page} of {data.totalPages}
				</span>
				<button
					class="btn"
					disabled={data.page >= data.totalPages}
					onclick={() => navigate({ page: data.page + 1 })}>Next</button
				>
			</footer>
		{/if}
	</section>
</div>
