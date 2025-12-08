<script lang="ts">
	import { onMount, tick } from "svelte"; // tick might be needed
	import { pb } from "$lib/pocketbase";
	import type { ScansResponse, InstagramUsersResponse } from "$lib/pocketbase-types";

	// Chart.js imports
	import {
		Chart as ChartJS,
		Title,
		Tooltip,
		Legend,
		LineElement,
		LinearScale,
		PointElement,
		CategoryScale
	} from "chart.js";
	import { Line } from "svelte-chartjs";

	// Icons
	import { Trash2, RefreshCcw, X } from "lucide-svelte";

	ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale);

	let scans: ScansResponse[] = [];
	let loading = true;
	let error = "";
	let isRefreshing = false;

	// Selection for comparison
	let selectedScans: string[] = [];
	let comparisonResult: {
		newFollowers: InstagramUsersResponse[];
		lostFollowers: InstagramUsersResponse[];
	} | null = null;
	let comparing = false;

	// Deletion
	let scanToDelete: ScansResponse | null = null;
	let isDeleting = false;

	// Charts Data
	let chartData: any = {
		labels: [],
		datasets: []
	};

	onMount(async () => {
		await fetchScans();
	});

	async function fetchScans() {
		loading = true;
		try {
			const result = await pb.collection("scans").getFullList<ScansResponse>({
				sort: "-created"
			});
			scans = result;
			await fixMissingCounts();
			updateChartData();
		} catch (e) {
			console.error(e);
			error = "Failed to load scans.";
		} finally {
			loading = false;
			isRefreshing = false;
		}
	}

	async function refreshScans() {
		isRefreshing = true;
		await fetchScans();
	}

	async function fixMissingCounts() {
		const updates = scans.map(async (scan, index) => {
			if (scan.count === undefined) {
				try {
					const result = await pb.collection("instagram_users").getList(1, 1, {
						filter: `scan_id="${scan.id}"`,
						fields: "id"
					});
					const total = result.totalItems;
					scans[index].count = total;
					await pb.collection("scans").update(scan.id, { count: total });
				} catch (err) {
					console.error("Failed to fix count for scan", scan.id, err);
				}
			}
		});

		await Promise.all(updates);
		scans = [...scans];
		updateChartData();
	}

	// Computed Properties
	$: groupedScans = scans.reduce(
		(acc, scan) => {
			const key = scan.username || "Unknown User";
			if (!acc[key]) acc[key] = [];
			acc[key].push(scan);
			return acc;
		},
		{} as Record<string, ScansResponse[]>
	);

	function updateChartData() {
		const datasets: any[] = [];
		const allDates = new Set<string>();
		const userGroups: Record<string, { label: string; dataPoints: Record<string, number> }> = {};

		scans.forEach((scan) => {
			const date = new Date(scan.created).toLocaleDateString();
			allDates.add(date);
			const userId = scan.user_id;
			const userLabel = scan.username || scan.user_id;

			if (!userGroups[userId]) {
				userGroups[userId] = { label: userLabel, dataPoints: {} };
			}
			if (scan.count !== undefined) {
				userGroups[userId].dataPoints[date] = scan.count;
			}
		});

		const colors = [
			"rgba(255, 99, 132, 1)",
			"rgba(54, 162, 235, 1)",
			"rgba(255, 206, 86, 1)",
			"rgba(75, 192, 192, 1)",
			"rgba(153, 102, 255, 1)",
			"rgba(255, 159, 64, 1)"
		];
		let colorIdx = 0;

		const sortedDates = Array.from(allDates).sort(
			(a, b) => new Date(a).getTime() - new Date(b).getTime()
		);

		Object.values(userGroups).forEach((group) => {
			const data = sortedDates.map((date) => group.dataPoints[date] || null);
			if (data.every((d) => d === null)) return;

			datasets.push({
				label: group.label,
				data: data,
				borderColor: colors[colorIdx % colors.length],
				backgroundColor: colors[colorIdx % colors.length].replace("1)", "0.5)"),
				tension: 0.3
			});
			colorIdx++;
		});

		chartData = {
			labels: sortedDates,
			datasets
		};
	}

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

			const [users1, users2] = await Promise.all([
				pb
					.collection("instagram_users")
					.getFullList<InstagramUsersResponse>({ filter: `scan_id="${id1}"` }),
				pb
					.collection("instagram_users")
					.getFullList<InstagramUsersResponse>({ filter: `scan_id="${id2}"` })
			]);

			const scan1 = scans.find((s) => s.id === id1);
			const scan2 = scans.find((s) => s.id === id2);

			if (!scan1 || !scan2) throw new Error("Scan not found");

			const is1Older = new Date(scan1.created || 0) < new Date(scan2.created || 0);

			const olderUsers = is1Older ? users1 : users2;
			const newerUsers = is1Older ? users2 : users1;

			const olderMap = new Map(olderUsers.map((u) => [u.user_id, u]));
			const newerMap = new Map(newerUsers.map((u) => [u.user_id, u]));

			const newFollowers: InstagramUsersResponse[] = [];
			const lostFollowers: InstagramUsersResponse[] = [];

			for (const [uid, user] of newerMap) {
				if (!olderMap.has(uid)) {
					newFollowers.push(user);
				}
			}

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

	const closeComparison = () => {
		comparisonResult = null;
	};

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			if (comparisonResult) closeComparison();
			if (scanToDelete) cancelDelete();
		}
	}

	const downloadCSV = () => {
		if (!comparisonResult) return;

		const rows = [
			["Type", "Username", "Full Name", "Profile URL"],
			...comparisonResult.newFollowers.map((u) => [
				"New Follower",
				u.username || "",
				u.full_name || "",
				`https://instagram.com/${u.username}`
			]),
			...comparisonResult.lostFollowers.map((u) => [
				"Lost Follower",
				u.username || "",
				u.full_name || "",
				`https://instagram.com/${u.username}`
			])
		];

		let csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");

		const encodedUri = encodeURI(csvContent);
		const link = document.createElement("a");
		link.setAttribute("href", encodedUri);
		link.setAttribute("download", "followers_comparison.csv");
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	};

	// Delete functions
	const confirmDelete = (scan: ScansResponse) => {
		scanToDelete = scan;
	};

	const cancelDelete = () => {
		scanToDelete = null;
	};

	const deleteScan = async () => {
		if (!scanToDelete) return;
		isDeleting = true;
		try {
			await pb.collection("scans").delete(scanToDelete.id);

			// Remove from local state
			scans = scans.filter((s) => s.id !== scanToDelete?.id);
			selectedScans = selectedScans.filter((id) => id !== scanToDelete?.id);

			updateChartData();

			scanToDelete = null;
		} catch (e) {
			console.error("Error deleting scan:", e);
			alert("Failed to delete scan.");
		} finally {
			isDeleting = false;
		}
	};

	function formatDate(dateString?: string) {
		if (!dateString) return "N/A";
		// Turkish format: DD.MM.YYYY HH:mm
		return new Date(dateString).toLocaleString("tr-TR", {
			day: "2-digit",
			month: "2-digit",
			year: "numeric",
			hour: "2-digit",
			minute: "2-digit"
		});
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="container mx-auto p-5 space-y-8">
	<!-- Top Header & Action Bar -->
	<div class="sticky top-0 z-50 bg-surface-100-800-token p-4 shadow-lg rounded-b-2xl -mx-4 md:mx-0">
		<div class="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
			<div class="flex items-center space-x-4">
				<h1 class="h2 font-bold">Scan History</h1>
				<a href="/" class="btn variant-ghost-secondary btn-sm">New Scan</a>
				<button
					class="btn-icon btn-icon-sm variant-ghost-surface"
					on:click={refreshScans}
					disabled={isRefreshing}
					title="Refresh List"
				>
					<RefreshCcw size="18" class={isRefreshing ? "animate-spin" : ""} />
				</button>
			</div>

			<div class="flex items-center space-x-4">
				<div class="text-sm opacity-70">
					{#if selectedScans.length < 2}
						Select 2 scans to compare
					{:else}
						Ready to compare
					{/if}
				</div>
				<button
					class="btn variant-filled-primary"
					disabled={selectedScans.length !== 2 || comparing}
					on:click={compareScans}
				>
					{comparing ? "Comparing..." : "Compare Scans"}
				</button>
			</div>
		</div>
	</div>

	<!-- Delete Confirmation Modal -->
	{#if scanToDelete}
		<div
			class="fixed inset-0 z-[100] bg-surface-900/50 flex justify-center items-center backdrop-blur-sm"
			on:click|self={cancelDelete}
			role="presentation"
		>
			<div class="card p-4 space-y-4 shadow-xl max-w-md w-full bg-surface-100-800-token">
				<header class="card-header">
					<h3 class="h3 font-bold text-error-500">Delete Scan?</h3>
				</header>
				<div class="p-4">
					<p>
						Are you sure you want to delete the scan for <strong>{scanToDelete.username}</strong>
						dated
						<strong>{formatDate(scanToDelete.created)}</strong>?
					</p>
					<p class="text-sm opacity-70 mt-2">
						This action cannot be undone. It will remove all follower records associated with this
						scan.
					</p>
				</div>
				<footer class="card-footer flex justify-end space-x-4">
					<button class="btn variant-ghost-surface" on:click={cancelDelete}>Cancel</button>
					<button class="btn variant-filled-error" on:click={deleteScan} disabled={isDeleting}>
						{#if isDeleting}
							Deleting...
						{:else}
							Delete
						{/if}
					</button>
				</footer>
			</div>
		</div>
	{/if}

	<!-- Comparison Results Modal -->
	{#if comparisonResult}
		<div
			class="fixed inset-0 z-[100] bg-surface-900/50 flex justify-center items-center backdrop-blur-sm p-4"
			on:click|self={closeComparison}
			role="presentation"
		>
			<div
				class="card p-6 space-y-4 shadow-2xl max-w-4xl w-full bg-surface-100-800-token max-h-[90vh] overflow-hidden flex flex-col"
			>
				<header class="flex justify-between items-center border-b border-surface-500/30 pb-4">
					<h2 class="h2 font-bold">Comparison Results</h2>
					<div class="flex space-x-2 items-center">
						<button class="btn variant-filled-tertiary btn-sm" on:click={downloadCSV}
							>Export CSV</button
						>
						<button
							class="btn-icon btn-icon-sm variant-ghost-surface ml-2"
							on:click={closeComparison}
							title="Close"
						>
							<X size="18" />
						</button>
					</div>
				</header>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-8 overflow-y-auto p-2">
					<!-- New Followers -->
					<div class="card p-4 space-y-4 border-l-4 border-green-500 h-full">
						<h3 class="h3 text-green-500 sticky top-0 bg-surface-100-800-token p-2">
							New Followers ({comparisonResult.newFollowers.length})
						</h3>
						{#if comparisonResult.newFollowers.length === 0}
							<p class="opacity-50">No new followers found.</p>
						{:else}
							<ul class="list-disc list-inside">
								{#each comparisonResult.newFollowers as user}
									<li>
										<a
											href={`https://instagram.com/${user.username}`}
											target="_blank"
											class="anchor"
										>
											{user.username}
										</a>
										<span class="text-xs opacity-70">({user.full_name})</span>
									</li>
								{/each}
							</ul>
						{/if}
					</div>

					<!-- Lost Followers -->
					<div class="card p-4 space-y-4 border-l-4 border-red-500 h-full">
						<h3 class="h3 text-red-500 sticky top-0 bg-surface-100-800-token p-2">
							Lost Followers ({comparisonResult.lostFollowers.length})
						</h3>
						{#if comparisonResult.lostFollowers.length === 0}
							<p class="opacity-50">No lost followers found.</p>
						{:else}
							<ul class="list-disc list-inside">
								{#each comparisonResult.lostFollowers as user}
									<li>
										<a
											href={`https://instagram.com/${user.username}`}
											target="_blank"
											class="anchor"
										>
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
		</div>
	{/if}

	<!-- Main Scans List (Grouped) -->
	{#if loading}
		<p class="text-center p-10 opacity-50">Loading scans...</p>
	{:else if error}
		<div class="alert variant-filled-error">{error}</div>
	{:else}
		<div class="space-y-8">
			{#each Object.entries(groupedScans) as [username, userScans]}
				<div class="card p-4 space-y-4">
					<header class="flex items-center space-x-2 border-b border-surface-500/30 pb-2">
						<h2 class="h3 font-bold">{username}</h2>
						<span class="badge variant-soft-surface">{userScans.length} scans</span>
					</header>
					<div class="table-container">
						<table class="table table-hover">
							<thead>
								<tr>
									<th class="w-12">Select</th>
									<th>Stats</th>
									<th>Date</th>
									<th class="text-right">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each userScans as scan}
									<tr
										class:bg-primary-500={selectedScans.includes(scan.id)}
										class:bg-opacity-20={selectedScans.includes(scan.id)}
										class="cursor-pointer hover:bg-primary-500/10 transition-colors"
										on:click={() => toggleSelection(scan.id)}
									>
										<td>
											<input
												type="checkbox"
												class="checkbox"
												checked={selectedScans.includes(scan.id)}
												on:click|stopPropagation={() => toggleSelection(scan.id)}
												disabled={!selectedScans.includes(scan.id) && selectedScans.length >= 2}
											/>
										</td>
										<!-- Removed Username Column -->
										<td>
											<div class="flex space-x-2">
												<span class="badge variant-filled-surface" title="Total Count">
													{scan.count ?? "-"}
												</span>
												{#if scan.verified_count}
													<span class="badge variant-filled-primary" title="Verified"
														>V: {scan.verified_count}</span
													>
												{/if}
												{#if scan.private_count}
													<span class="badge variant-filled-warning" title="Private"
														>P: {scan.private_count}</span
													>
												{/if}
											</div>
										</td>
										<td>{formatDate(scan.created)}</td>
										<td class="text-right space-x-1">
											<div class="inline-flex" on:click|stopPropagation>
												<a
													href={`/scans/${scan.id}`}
													class="btn-icon variant-ghost-primary btn-icon-sm inline-flex items-center justify-center mr-1"
													title="View Details"
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														width="16"
														height="16"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														stroke-width="2"
														stroke-linecap="round"
														stroke-linejoin="round"
														class="lucide lucide-eye"
														><path
															d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
														/><circle cx="12" cy="12" r="3" /></svg
													>
												</a>
												<button
													class="btn-icon variant-ghost-error btn-icon-sm"
													on:click={() => confirmDelete(scan)}
													title="Delete Scan"
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
				</div>
			{/each}
		</div>
	{/if}

	<!-- Chart Section (Bottom) -->
	{#if chartData.datasets.length > 0}
		<div class="card p-6 mt-8">
			<h2 class="h3 mb-4 font-bold">Follower Growth</h2>
			<div class="w-full h-96">
				<Line data={chartData} options={{ maintainAspectRatio: false, responsive: true }} />
			</div>
		</div>
	{/if}
</div>
```
