<script lang="ts">
	import { onMount } from "svelte";
	import { pb } from "$lib/pocketbase";
	import type { ScansResponse, InstagramUsersResponse } from "$lib/pocketbase-types";
	// checking imports... pb is exported from $lib/pocketbase

	let scans: ScansResponse[] = [];
	let loading = true;
	let error = "";

	// Selection for comparison
	let selectedScans: string[] = [];
	let comparisonResult: {
		newFollowers: InstagramUsersResponse[];
		lostFollowers: InstagramUsersResponse[];
	} | null = null;
	let comparing = false;

	onMount(async () => {
		try {
			// Fetch all scans, sorted by created desc
			const result = await pb.collection("scans").getFullList<ScansResponse>({
				sort: "-created"
			});
			scans = result;
		} catch (e) {
			console.error(e);
			error = "Failed to load scans.";
		} finally {
			loading = false;
		}
	});

	// Group scans by user_id or username
	$: groupedScans = scans.reduce(
		(groups, scan) => {
			const key = scan.username ? `${scan.username} (${scan.user_id})` : scan.user_id;
			if (!groups[key]) {
				groups[key] = [];
			}
			groups[key].push(scan);
			return groups;
		},
		{} as Record<string, ScansResponse[]>
	);

	const toggleSelection = (scanId: string) => {
		if (selectedScans.includes(scanId)) {
			selectedScans = selectedScans.filter((id) => id !== scanId);
		} else {
			if (selectedScans.length < 2) {
				selectedScans = [...selectedScans, scanId];
			}
		}
	};

	const compareScans = async () => {
		if (selectedScans.length !== 2) return;
		comparing = true;
		comparisonResult = null;

		try {
			const [id1, id2] = selectedScans;

			// Fetch users for both scans (handling pagination logic if needed, but getFullList handles it)
			// Note: If users count is huge, this might be slow on client.
			const [users1, users2] = await Promise.all([
				pb
					.collection("instagram_users")
					.getFullList<InstagramUsersResponse>({ filter: `scan_id="${id1}"` }),
				pb
					.collection("instagram_users")
					.getFullList<InstagramUsersResponse>({ filter: `scan_id="${id2}"` })
			]);

			// Determine which is older/newer based on created date of the scan record
			// We need to find the scan objects from our local list
			const scan1 = scans.find((s) => s.id === id1);
			const scan2 = scans.find((s) => s.id === id2);

			if (!scan1 || !scan2) throw new Error("Scan not found");

			const is1Older = new Date(scan1.created || 0) < new Date(scan2.created || 0);

			const olderUsers = is1Older ? users1 : users2;
			const newerUsers = is1Older ? users2 : users1;

			// Map by unique identifier (username or user_id)
			// Using user_id (Instagram ID) is safer if username changes
			const olderMap = new Map(olderUsers.map((u) => [u.user_id, u]));
			const newerMap = new Map(newerUsers.map((u) => [u.user_id, u]));

			const newFollowers: InstagramUsersResponse[] = [];
			const lostFollowers: InstagramUsersResponse[] = [];

			// Find New: Present in Newer but not in Older
			for (const [uid, user] of newerMap) {
				if (!olderMap.has(uid)) {
					newFollowers.push(user);
				}
			}

			// Find Lost: Present in Older but not in Newer
			for (const [uid, user] of olderMap) {
				if (!newerMap.has(uid)) {
					lostFollowers.push(user);
				}
			}

			comparisonResult = { newFollowers, lostFollowers };
		} catch (e) {
			console.error(e);
			alert("Error comparing scans");
		} finally {
			comparing = false;
		}
	};

	function formatDate(dateString?: string) {
		if (!dateString) return "N/A";
		return new Date(dateString).toLocaleString();
	}
</script>

<div class="container mx-auto p-5 space-y-8">
	<div class="flex justify-between items-center">
		<h1 class="h1">Scan History</h1>
		<a href="/" class="btn variant-ghost-secondary">Back to Search</a>
	</div>

	{#if loading}
		<p>Loading scans...</p>
	{:else if error}
		<div class="alert variant-filled-error">{error}</div>
	{:else}
		{#each Object.entries(groupedScans) as [groupName, groupScans]}
			<div class="card p-4 space-y-4">
				<header class="card-header">
					<h2 class="h3 font-bold">{groupName}</h2>
				</header>
				<div class="table-container">
					<table class="table table-hover">
						<thead>
							<tr>
								<th>Select</th>
								<th>Date</th>
								<th>Username</th>
								<th>ID</th>
							</tr>
						</thead>
						<tbody>
							{#each groupScans as scan}
								<tr
									class:bg-primary-500={selectedScans.includes(scan.id)}
									class="transition-colors duration-200"
								>
									<td>
										<input
											type="checkbox"
											class="checkbox"
											checked={selectedScans.includes(scan.id)}
											on:change={() => toggleSelection(scan.id)}
											disabled={!selectedScans.includes(scan.id) && selectedScans.length >= 2}
										/>
									</td>
									<td>{formatDate(scan.created)}</td>
									<td>{scan.username || "N/A"}</td>
									<td>{scan.id}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/each}
	{/if}

	<div
		class="fixed bottom-5 right-5 card p-4 shadow-xl z-50 flex items-center space-x-4 bg-surface-100-800-token"
	>
		<div>
			<p class="font-bold">Compare Scans</p>
			<p class="text-sm">{selectedScans.length} / 2 selected</p>
		</div>
		<button
			class="btn variant-filled-primary"
			disabled={selectedScans.length !== 2 || comparing}
			on:click={compareScans}
		>
			{comparing ? "Comparing..." : "Compare"}
		</button>
	</div>

	{#if comparisonResult}
		<div class="space-y-8 pt-8 border-t border-surface-500/30">
			<h2 class="h2 text-center">Comparison Results</h2>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-8">
				<!-- New Followers -->
				<div class="card p-4 space-y-4 border-l-4 border-green-500">
					<h3 class="h3 text-green-500">New Followers ({comparisonResult.newFollowers.length})</h3>
					{#if comparisonResult.newFollowers.length === 0}
						<p class="opacity-50">No new followers found.</p>
					{:else}
						<ul class="list-disc list-inside">
							{#each comparisonResult.newFollowers as user}
								<li>
									<a href={`https://instagram.com/${user.username}`} target="_blank" class="anchor">
										{user.username}
									</a>
									<span class="text-xs opacity-70">({user.full_name})</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<!-- Lost Followers -->
				<div class="card p-4 space-y-4 border-l-4 border-red-500">
					<h3 class="h3 text-red-500">Lost Followers ({comparisonResult.lostFollowers.length})</h3>
					{#if comparisonResult.lostFollowers.length === 0}
						<p class="opacity-50">No lost followers found.</p>
					{:else}
						<ul class="list-disc list-inside">
							{#each comparisonResult.lostFollowers as user}
								<li>
									<a href={`https://instagram.com/${user.username}`} target="_blank" class="anchor">
										{user.username}
									</a>
									<span class="text-xs opacity-70">({user.full_name})</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
