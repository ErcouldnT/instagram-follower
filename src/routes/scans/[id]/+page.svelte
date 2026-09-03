<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page as pageStore } from "$app/state";
	import Avatar from "$lib/components/Avatar.svelte";
	import { USER_FILTER_LABELS, USER_FILTERS, type UserFilter } from "$lib/constants";
	import { formatDate, formatNumber } from "$lib/format";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// A writable derived: seeded from the URL, freely typed into, and resynced
	// whenever navigation (including back/forward) changes the query string.
	let search = $derived(data.search);
	let timer: ReturnType<typeof setTimeout>;

	/** Both lists are needed before a cross-list filter means anything. */
	const bothCaptured = $derived(data.scan.capturedFollowing && data.scan.capturedFollowers);

	const availableFilters = $derived(
		USER_FILTERS.filter((filter) => {
			if (filter === "all") return true;
			if (filter === "following") return data.scan.capturedFollowing;
			if (filter === "followers") return data.scan.capturedFollowers;
			return bothCaptured;
		})
	);

	/** Search, filter and pagination live in the URL, so results stay shareable. */
	function navigate(params: { q?: string; page?: number; filter?: UserFilter }) {
		const url = new URL(pageStore.url);
		const q = params.q ?? search;

		if (q.trim()) url.searchParams.set("q", q.trim());
		else url.searchParams.delete("q");

		const filter = params.filter ?? data.filter;
		if (filter !== "all") url.searchParams.set("filter", filter);
		else url.searchParams.delete("filter");

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
				<p class="mt-1 text-sm text-ink-dim">Captured {formatDate(data.scan.createdAt)}</p>
				<p class="mt-1 font-mono text-xs text-ink-dim">ID {data.scan.instagramUserId}</p>
			</div>

			<div class="flex flex-wrap justify-end gap-2">
				{#if data.scan.capturedFollowing}
					<span class="badge">Following {formatNumber(data.scan.followingCount)}</span>
				{/if}
				{#if data.scan.capturedFollowers}
					<span class="badge">Followers {formatNumber(data.scan.followersCount)}</span>
				{/if}
				{#if bothCaptured}
					<span class="badge">Mutual {formatNumber(data.breakdown.mutual)}</span>
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
		{/if}

		{#if !bothCaptured}
			<p class="mt-4 text-xs text-ink-dim">
				Only one list was captured, so mutual and "doesn't follow back" cannot be computed for this
				scan.
			</p>
		{/if}

		<!-- Surfacing the gap rather than fudging the total, as the old code did. -->
		{#if data.scan.capturedFollowing && data.scan.reportedFollowingCount !== null && data.scan.reportedFollowingCount !== data.scan.followingCount}
			<p class="mt-2 text-xs text-ink-dim">
				Instagram reported {formatNumber(data.scan.reportedFollowingCount)} following; {formatNumber(
					data.scan.followingCount
				)} were retrieved. The reported figure is a snapshot and drifts during a scan.
			</p>
		{/if}
		{#if data.scan.capturedFollowers && data.scan.reportedFollowersCount !== null && data.scan.reportedFollowersCount !== data.scan.followersCount}
			<p class="mt-2 text-xs text-ink-dim">
				Instagram reported {formatNumber(data.scan.reportedFollowersCount)} followers; {formatNumber(
					data.scan.followersCount
				)} were retrieved.
			</p>
		{/if}
	</section>

	<section class="card overflow-hidden">
		<header class="space-y-3 border-b border-line px-4 py-3">
			<div class="flex flex-wrap items-center justify-between gap-3">
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
			</div>

			<div class="flex flex-wrap gap-1.5">
				{#each availableFilters as filter (filter)}
					<button
						class="badge {data.filter === filter
							? 'border-brand bg-brand text-black'
							: 'cursor-pointer'}"
						onclick={() => navigate({ filter, page: 1 })}
					>
						{USER_FILTER_LABELS[filter]}
						<span class="opacity-70">{formatNumber(data.breakdown[filter])}</span>
					</button>
				{/each}
			</div>
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
									{#if user.inFollowing && user.inFollowers}
										<span class="text-emerald-400">Mutual</span>
									{:else if user.inFollowing}
										<span class="text-amber-300">Doesn't follow back</span>
									{:else if user.inFollowers}
										<span class="text-sky-400">Not followed back</span>
									{/if}
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
								{data.search || data.filter !== "all"
									? "Nothing matched that filter."
									: "This scan stored no accounts."}
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
