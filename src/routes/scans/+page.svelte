<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { invalidateAll } from "$app/navigation";
	import GrowthChart from "$lib/components/GrowthChart.svelte";
	import Modal from "$lib/components/Modal.svelte";
	import { RELATION_LABELS } from "$lib/constants";
	import { downloadCsv } from "$lib/csv";
	import { formatDate, formatNumber } from "$lib/format";
	import { Eye, RefreshCcw, Trash2 } from "@lucide/svelte";
	import type { ActionData, PageData } from "./$types";

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Scan = PageData["scans"][number];

	let selected = $state<number[]>([]);
	let pendingDelete = $state<Scan | null>(null);
	let refreshing = $state(false);
	let comparing = $state(false);

	// Dismissing tracks which result was closed rather than reassigning `form`,
	// which is a prop and gets restored on the next update anyway.
	let dismissed = $state<ActionData | null>(null);

	const comparison = $derived(
		form && form !== dismissed && "comparison" in form ? form.comparison : null
	);
	const errorMessage = $derived(form && "message" in form ? form.message : null);

	// Scans of different accounts, or of different lists, cannot be diffed —
	// disable the control rather than returning a meaningless result.
	const chosen = $derived(data.scans.filter((scan) => selected.includes(scan.id)));
	const comparable = $derived(
		chosen.length === 2 &&
			chosen[0]!.instagramUserId === chosen[1]!.instagramUserId &&
			chosen[0]!.relation === chosen[1]!.relation
	);

	interface Group {
		key: string;
		username: string;
		relation: string;
		scans: Scan[];
	}

	const grouped = $derived.by(() => {
		const groups: Group[] = [];
		for (const scan of data.scans) {
			const key = `${scan.instagramUserId}:${scan.relation}`;
			const existing = groups.find((group) => group.key === key);
			if (existing) {
				existing.scans.push(scan);
			} else {
				groups.push({ key, username: scan.username, relation: scan.relation, scans: [scan] });
			}
		}
		return groups;
	});

	function toggle(id: number) {
		if (selected.includes(id)) {
			selected = selected.filter((value) => value !== id);
		} else if (selected.length < 2) {
			selected = [...selected, id];
		} else {
			// Replace the oldest pick so a third click is never a dead end.
			selected = [selected[1]!, id];
		}
	}

	async function refresh() {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}

	function exportCsv() {
		if (!comparison) return;
		downloadCsv(`${comparison.username}-changes.csv`, [
			["Change", "Username", "Full name", "Profile"],
			...comparison.gained.map((user) => [
				"Gained",
				user.username,
				user.fullName,
				`https://instagram.com/${user.username}`
			]),
			...comparison.lost.map((user) => [
				"Lost",
				user.username,
				user.fullName,
				`https://instagram.com/${user.username}`
			])
		]);
	}
</script>

<div class="mx-auto max-w-5xl space-y-8 px-4 py-8">
	<header class="flex flex-wrap items-center justify-between gap-4">
		<div class="flex items-center gap-3">
			<h1 class="text-2xl font-bold">Scan history</h1>
			<button class="btn px-2 py-2" onclick={refresh} disabled={refreshing} aria-label="Refresh">
				<RefreshCcw size="16" class={refreshing ? "animate-spin" : ""} />
			</button>
		</div>

		<div class="flex items-center gap-3">
			<span class="text-xs text-ink-dim">
				{#if selected.length < 2}
					Select two scans of the same account
				{:else if !comparable}
					Those scans cover different accounts or lists
				{:else}
					Ready to compare
				{/if}
			</span>
			<a href={resolve("/")} class="btn">New scan</a>
			<form
				method="POST"
				action="?/compare"
				use:enhance={() => {
					comparing = true;
					return async ({ update }) => {
						await update({ reset: false });
						comparing = false;
					};
				}}
			>
				<input type="hidden" name="a" value={selected[0] ?? ""} />
				<input type="hidden" name="b" value={selected[1] ?? ""} />
				<button class="btn btn-brand" disabled={!comparable || comparing}>
					{comparing ? "Comparing..." : "Compare"}
				</button>
			</form>
		</div>
	</header>

	{#if errorMessage}
		<p class="card border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
			{errorMessage}
		</p>
	{/if}

	{#if data.scans.length === 0}
		<p class="card p-10 text-center text-sm text-ink-dim">
			No scans yet. <a href={resolve("/")} class="underline">Run one</a> to get started.
		</p>
	{/if}

	{#each grouped as group (group.key)}
		<section class="card overflow-hidden">
			<header class="flex items-center gap-2 border-b border-line px-4 py-3">
				<h2 class="font-semibold">{group.username}</h2>
				<span class="badge">{RELATION_LABELS[group.relation as "following" | "followers"]}</span>
				<span class="badge">{group.scans.length} scans</span>
			</header>

			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="text-left text-xs text-ink-dim">
						<tr class="border-b border-line">
							<th class="w-12 px-4 py-2">Pick</th>
							<th class="px-4 py-2">Date</th>
							<th class="px-4 py-2">Accounts</th>
							<th class="px-4 py-2">Status</th>
							<th class="px-4 py-2 text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each group.scans as scan (scan.id)}
							<tr class="border-b border-line/50 last:border-0 hover:bg-surface-3/40">
								<td class="px-4 py-2">
									<input
										type="checkbox"
										class="size-4 accent-brand"
										checked={selected.includes(scan.id)}
										onchange={() => toggle(scan.id)}
										aria-label="Select scan from {formatDate(scan.createdAt)}"
									/>
								</td>
								<td class="px-4 py-2 whitespace-nowrap">{formatDate(scan.createdAt)}</td>
								<td class="px-4 py-2">
									<div class="flex flex-wrap gap-1">
										<span class="badge">{formatNumber(scan.count)}</span>
										{#if scan.verifiedCount > 0}
											<span class="badge">V {formatNumber(scan.verifiedCount)}</span>
										{/if}
										{#if scan.privateCount > 0}
											<span class="badge">P {formatNumber(scan.privateCount)}</span>
										{/if}
									</div>
								</td>
								<td class="px-4 py-2">
									{#if scan.status === "completed"}
										<span class="badge">Done</span>
									{:else if scan.status === "running"}
										<span class="badge text-amber-300">Running</span>
									{:else}
										<span class="badge text-red-300" title={scan.error ?? ""}>Failed</span>
									{/if}
								</td>
								<td class="px-4 py-2">
									<div class="flex justify-end gap-1">
										<a
											href={resolve("/scans/[id]", { id: String(scan.id) })}
											class="btn px-2 py-2"
											aria-label="View scan details"
										>
											<Eye size="16" />
										</a>
										<button
											class="btn px-2 py-2"
											onclick={() => (pendingDelete = scan)}
											aria-label="Delete scan"
										>
											<Trash2 size="16" />
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/each}

	{#if data.series.length > 0}
		<section class="card p-5">
			<h2 class="mb-4 font-semibold">Accounts tracked over time</h2>
			<GrowthChart series={data.series} />
		</section>
	{/if}
</div>

{#if pendingDelete}
	{@const target = pendingDelete}
	<Modal title="Delete this scan?" onclose={() => (pendingDelete = null)}>
		<p class="text-sm">
			Delete the scan of <strong>{target.username}</strong> from
			<strong>{formatDate(target.createdAt)}</strong>?
		</p>
		<p class="mt-2 text-sm text-ink-dim">
			Its {formatNumber(target.count)} stored accounts go with it. This cannot be undone.
		</p>

		{#snippet actions()}
			<button class="btn" onclick={() => (pendingDelete = null)}>Cancel</button>
			<form
				method="POST"
				action="?/delete"
				use:enhance={() => {
					return async ({ update }) => {
						await update();
						pendingDelete = null;
						selected = selected.filter((id) => id !== target.id);
					};
				}}
			>
				<input type="hidden" name="id" value={target.id} />
				<button class="btn btn-danger">Delete</button>
			</form>
		{/snippet}
	</Modal>
{/if}

{#if comparison}
	<Modal title="Changes for {comparison.username}" onclose={() => (dismissed = form)} wide>
		<p class="mb-4 text-xs text-ink-dim">
			{formatDate(comparison.olderLabel)} → {formatDate(comparison.newerLabel)}
		</p>

		<div class="grid gap-6 md:grid-cols-2">
			<div>
				<h3 class="mb-2 font-semibold text-emerald-400">
					Gained ({comparison.gained.length})
				</h3>
				{#if comparison.gained.length === 0}
					<p class="text-sm text-ink-dim">None.</p>
				{:else}
					<ul class="space-y-1 text-sm">
						{#each comparison.gained as user (user.instagramUserId)}
							<li>
								<a
									class="underline"
									href="https://instagram.com/{user.username}"
									target="_blank"
									rel="noopener noreferrer">{user.username}</a
								>
								{#if user.fullName}
									<span class="text-ink-dim">— {user.fullName}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div>
				<h3 class="mb-2 font-semibold text-red-400">Lost ({comparison.lost.length})</h3>
				{#if comparison.lost.length === 0}
					<p class="text-sm text-ink-dim">None.</p>
				{:else}
					<ul class="space-y-1 text-sm">
						{#each comparison.lost as user (user.instagramUserId)}
							<li>
								<a
									class="underline"
									href="https://instagram.com/{user.username}"
									target="_blank"
									rel="noopener noreferrer">{user.username}</a
								>
								{#if user.fullName}
									<span class="text-ink-dim">— {user.fullName}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>

		{#snippet actions()}
			<button class="btn" onclick={exportCsv}>Export CSV</button>
			<button class="btn btn-brand" onclick={() => (dismissed = form)}>Close</button>
		{/snippet}
	</Modal>
{/if}
