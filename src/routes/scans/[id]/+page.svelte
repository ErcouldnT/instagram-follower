<script lang="ts">
	import { onMount } from "svelte";
	import { page } from "$app/stores";
	import { pb } from "$lib/pocketbase";
	import type { ScansResponse, InstagramUsersResponse } from "$lib/pocketbase-types";
	import { Avatar } from "@skeletonlabs/skeleton";

	let scanId = $page.params.id;
	let scan: ScansResponse | null = null;
	let users: InstagramUsersResponse[] = [];
	let loading = true;
	let loadingUsers = false;
	let error = "";

	// Search & Pagination
	let searchQuery = "";
	let currentPage = 1;
	let totalPages = 1;
	let totalItems = 0;
	const perPage = 20;

	// Debounce timer
	let searchTimer: NodeJS.Timeout;

	onMount(async () => {
		await fetchScanDetails();
		await fetchUsers();
	});

	async function fetchScanDetails() {
		try {
			scan = await pb.collection("scans").getOne<ScansResponse>(scanId);
		} catch (e) {
			console.error("Error fetching scan:", e);
			error = "Failed to load scan details.";
		}
	}

	async function fetchUsers() {
		loadingUsers = true;
		try {
			let filter = `scan_id="${scanId}"`;
			if (searchQuery.trim()) {
				filter += ` && (username ~ "${searchQuery}" || full_name ~ "${searchQuery}")`;
			}

			const result = await pb
				.collection("instagram_users")
				.getList<InstagramUsersResponse>(currentPage, perPage, {
					filter: filter,
					sort: "-followed_by_viewer, -is_verified" // Interesting sort: followed first, then verified
				});

			users = result.items;
			totalPages = result.totalPages;
			totalItems = result.totalItems;
		} catch (e) {
			console.error("Error fetching users:", e);
		} finally {
			loadingUsers = false;
			loading = false;
		}
	}

	function handleSearch() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			currentPage = 1;
			fetchUsers();
		}, 300);
	}

	function changePage(newPage: number) {
		if (newPage >= 1 && newPage <= totalPages) {
			currentPage = newPage;
			fetchUsers();
		}
	}

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
	<!-- Header / Breadcrumbs -->
	<div class="flex justify-between items-center">
		<div class="flex items-center space-x-2 text-sm opacity-70">
			<a href="/scans" class="hover:underline">Scans</a>
			<span>/</span>
			<span>{scanId}</span>
		</div>
		<a href="/scans" class="btn variant-ghost-secondary">Back to List</a>
	</div>

	{#if loading && !scan}
		<div class="flex justify-center p-10">
			<p>Loading scan details...</p>
		</div>
	{:else if error}
		<div class="alert variant-filled-error">{error}</div>
	{:else if scan}
		<!-- Scan Metadata Card -->
		<div class="card p-6 space-y-4">
			<header class="flex justify-between items-start">
				<div>
					<h1 class="h2 font-bold mb-1">{scan.username || "Unknown User"}</h1>
					<p class="opacity-70">Scanned on: {formatDate(scan.created)}</p>
					<p class="text-xs font-mono mt-1 opacity-50">ID: {scan.user_id}</p>
				</div>
				<div class="flex flex-col items-end space-y-2">
					<div class="badge variant-filled-surface text-lg px-4 py-2">
						Total: {scan.count ?? totalItems ?? "-"}
					</div>
					<div class="flex space-x-2">
						{#if scan.verified_count}<span class="badge variant-filled-primary"
								>Verified: {scan.verified_count}</span
							>{/if}
						{#if scan.private_count}<span class="badge variant-filled-warning"
								>Private: {scan.private_count}</span
							>{/if}
					</div>
				</div>
			</header>
		</div>

		<!-- Users List Section -->
		<div class="card p-4 space-y-4">
			<div class="flex justify-between items-center">
				<h2 class="h3 font-bold">Followers Found ({totalItems})</h2>
				<input
					class="input w-64"
					type="search"
					placeholder="Search username or name..."
					bind:value={searchQuery}
					on:input={handleSearch}
				/>
			</div>

			<div class="table-container">
				<table class="table table-hover">
					<thead>
						<tr>
							<th class="w-16">Avatar</th>
							<th>Username</th>
							<th>Full Name</th>
							<th>Status</th>
							<th>Relations</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						{#if loadingUsers}
							<tr><td colspan="6" class="text-center p-4">Loading users...</td></tr>
						{:else if users.length === 0}
							<tr><td colspan="6" class="text-center p-4">No users found for this scan.</td></tr>
						{:else}
							{#each users as user}
								<tr>
									<td>
										<Avatar
											src={`/api/proxy?url=${encodeURIComponent(user.profile_pic_url || "")}`}
											width="w-10"
											rounded="rounded-full"
											initials={user.username ? user.username.substring(0, 2).toUpperCase() : "??"}
										/>
									</td>
									<td class="font-bold">{user.username}</td>
									<td>{user.full_name || "-"}</td>
									<td>
										<div class="flex space-x-1">
											{#if user.is_verified}<span class="badge variant-filled-primary text-[10px]"
													>Verified</span
												>{/if}
											{#if user.is_private}<span class="badge variant-filled-warning text-[10px]"
													>Private</span
												>{/if}
										</div>
									</td>
									<td class="text-xs">
										<div class="flex flex-col">
											{#if user.followed_by_viewer}<span class="text-green-500">You follow</span
												>{/if}
											{#if user.follows_viewer}<span class="text-blue-500">Follows you</span>{/if}
										</div>
									</td>
									<td>
										<a
											href={`https://instagram.com/${user.username}`}
											target="_blank"
											class="btn btn-sm variant-ghost-surface"
										>
											View
										</a>
									</td>
								</tr>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

			<!-- Pagination -->
			{#if totalPages > 1}
				<div class="flex justify-center space-x-2 pt-4">
					<button
						class="btn variant-ghost-surface"
						disabled={currentPage === 1}
						on:click={() => changePage(currentPage - 1)}
					>
						Previous
					</button>
					<span class="flex items-center px-4 font-mono">
						Page {currentPage} of {totalPages}
					</span>
					<button
						class="btn variant-ghost-surface"
						disabled={currentPage === totalPages}
						on:click={() => changePage(currentPage + 1)}
					>
						Next
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
