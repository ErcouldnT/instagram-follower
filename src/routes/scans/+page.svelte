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
	import { Trash2 } from "lucide-svelte";

	ChartJS.register(Title, Tooltip, Legend, LineElement, LinearScale, PointElement, CategoryScale);

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

	// Deletion
	let scanToDelete: ScansResponse | null = null;
	let isDeleting = false;

	// Charts Data
	let chartData: any = {
		labels: [],
		datasets: []
	};

	onMount(async () => {
		try {
			// Fetch all scans, sorted by created desc
			// We need updated count field if available
			const result = await pb.collection("scans").getFullList<ScansResponse>({
				sort: "-created"
			});
			scans = result;

			// Self-healing: Fix missing counts in background
			fixMissingCounts();

			updateChartData();
		} catch (e) {
			console.error(e);
			error = "Failed to load scans.";
		} finally {
			loading = false;
		}
	});

	async function fixMissingCounts() {
		const updates = scans.map(async (scan, index) => {
			if (scan.count === undefined || scan.count === 0) {
				// Check if it's really 0 or just missing.
				// If undefined, definitely fetch. If 0, it might be real 0 or default.
				// Let's assume undefined is the main issue as per user report "-"
				// But wait, user report says "-" which is the else block for undefined.
				// So we only target undefined.

				// However, let's just re-verify for all just to be safe?
				// No, that's too heavy. Stick to undefined.
				if (scan.count !== undefined) return;

				try {
					const result = await pb.collection("instagram_users").getList(1, 1, {
						filter: `scan_id="${scan.id}"`,
						fields: "id" // Optimized fetch
					});

					const total = result.totalItems;

					// Update local state
					scans[index].count = total;

					// Update DB
					await pb.collection("scans").update(scan.id, { count: total });
				} catch (err) {
					console.error("Failed to fix count for scan", scan.id, err);
				}
			}
		});

		await Promise.all(updates);
		// Force reactivity assignment
		scans = [...scans];
		updateChartData(); // Refresh chart with new numbers
	}

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

	function updateChartData() {
		// Prepare chart data grouping by username
		// We might want one dataset per user or just show the most recent user?
		// Let's show all distinct users as separate lines.

		const datasets: any[] = [];
		const allDates = new Set<string>();

		// First pass: collect all dates and group by user_id (stable key)
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
				// Use latest count for that day if multiple scans per day? Or keep time granularity?
				// Let's use simple Date string for now to avoid overcrowding
				userGroups[userId].dataPoints[date] = scan.count;
			}
		});

		// specific colors for chart lines
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
			const data = sortedDates.map((date) => group.dataPoints[date] || null); // null for missing points
			// Filter out if no data at all
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

			// Re-calc groupedScans (reactive)
			updateChartData(); // Refresh chart

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

<div class="container mx-auto p-5 space-y-8">
	<div class="flex justify-between items-center">
		<h1 class="h1">Scan History</h1>
		<a href="/" class="btn variant-ghost-secondary">Back to Search</a>
	</div>

	<!-- Chart Section -->
	{#if chartData.datasets.length > 0}
		<div class="card p-4">
			<h2 class="h3 mb-4 font-bold">Follower Growth</h2>
			<div class="w-full h-64">
				<Line data={chartData} options={{ maintainAspectRatio: false, responsive: true }} />
			</div>
		</div>
	{/if}

	<!-- Delete Confirmation Modal -->
	{#if scanToDelete}
		<div
			class="fixed inset-0 z-[100] bg-surface-900/50 flex justify-center items-center backdrop-blur-sm"
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
								<th>Username</th>
								<th>Toplam Kişi</th>
								<th>Date</th>
								<th class="text-right">Action</th>
							</tr>
						</thead>
						<tbody>
							{#each groupScans as scan}
								<tr
									class:bg-primary-500={selectedScans.includes(scan.id)}
									class="transition-colors duration-200"
								>
									<td class="w-12">
										<input
											type="checkbox"
											class="checkbox"
											checked={selectedScans.includes(scan.id)}
											on:change={() => toggleSelection(scan.id)}
											disabled={!selectedScans.includes(scan.id) && selectedScans.length >= 2}
										/>
									</td>
									<td>{scan.username || "N/A"}</td>
									<td>
										<div class="flex space-x-2">
											{#if scan.count !== undefined}
												<span class="badge variant-filled-surface" title="Total">{scan.count}</span>
											{:else}
												<span class="opacity-50">-</span>
											{/if}

											{#if scan.verified_count !== undefined && scan.verified_count > 0}
												<span class="badge variant-filled-primary" title="Verified"
													>V: {scan.verified_count}</span
												>
											{/if}

											{#if scan.private_count !== undefined && scan.private_count > 0}
												<span class="badge variant-filled-warning" title="Private"
													>P: {scan.private_count}</span
												>
											{/if}
										</div>
									</td>
									<td>{formatDate(scan.created)}</td>
									<td class="text-right">
										<button
											class="btn-icon variant-ghost-error btn-icon-sm"
											on:click={() => confirmDelete(scan)}
											title="Delete Scan"
										>
											<Trash2 size="16" />
										</button>
									</td>
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
			<div class="flex justify-between items-center">
				<h2 class="h2 text-center">Comparison Results</h2>
				<button class="btn variant-filled-tertiary" on:click={downloadCSV}>Export CSV</button>
			</div>

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
