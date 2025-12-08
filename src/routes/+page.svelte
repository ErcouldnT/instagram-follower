<script lang="ts">
	import axios from "axios";
	import { onMount } from "svelte";
	import { Avatar, ProgressRadial } from "@skeletonlabs/skeleton";
	import type { UserNode } from "$lib/user.types";

	let username: string = "";
	let ds_user_id: string | null;
	let inputRef: HTMLInputElement;

	let users: { user: UserNode }[] = [];
	// let nextCode = "";
	let response = "";
	let loading = false;

	const fetchData = async (url: string) => {
		loading = true;
		try {
			const response = await axios.get(url);
			loading = false;
			return { data: response.data, error: null };
		} catch (error) {
			loading = false;
			return { data: null, error };
		}
	};

	const getUsernameId = async () => {
		ds_user_id = null;
		username = username.trim();

		if (!username) return;
		users = [];

		try {
			const { data, error } = await fetchData(`/api/search/${username}`);
			if (error) {
				console.error("Veri alınırken hata oluştu:", error);
				return;
			}

			response = JSON.stringify(data, null, 2);
			users = data.users;

			if (!users.length) {
				alert("Kullanıcı adı bulunamadı");
				return;
			}

			const user = users[0].user;
			const usernameFound = user.username;
		} catch (err) {
			console.error("Beklenmeyen bir hata oluştu:", err);
		}
	};

	const chooseProfile = async (id: string, username: string) => {
		ds_user_id = id;
		response = ""; // Clear previous response

		// const res = await fetch(`/api/user/${ds_user_id}`);
		// if (!res || !res.body) return;

		// const reader = res.body.getReader();
		// const decoder = new TextDecoder();
		// let receivedLength = 0; // Total bytes received
		// let results = "";

		// while (true) {
		// 	const { done, value } = await reader.read();

		// 	if (done) {
		// 		console.log("Stream complete");
		// 		break;
		// 	}

		// 	receivedLength += value.length;
		// 	results += decoder.decode(value, { stream: true });

		// 	response = results;

		// Optionally, process each chunk as it's received
		// For example, parse JSON lines if the server sends newline-delimited JSON
		// const lines = response.split('\n');
		// lines.forEach(line => {
		//   if (line.trim()) {
		//     const json = JSON.parse(line);
		//     // Process json object
		//   }
		// });
		// }

		const { data, error } = await fetchData(
			`/api/user/${ds_user_id}?username=${encodeURIComponent(username)}`
		);
		if (error) {
			console.error("Veri alınırken hata oluştu:", error);
			return;
		}

		// Process the complete response if needed
		// const data = JSON.parse(response);
		// console.log("Received", receivedLength, "bytes");

		response = JSON.stringify(data, null, 2);
	};

	onMount(() => {
		if (inputRef) {
			inputRef.focus();
		}
	});
</script>

<div class="p-5 container h-full mx-auto flex justify-center items-center">
	<div class="space-y-5">
		<h1 class="h1 m-12">Instagram Follower</h1>
		<p class="text-center font-thin">Enter "public" instagram username to follow:</p>
		<form on:submit={getUsernameId} class="flex flex-col space-y-5">
			<label class="label">
				<!-- <span>Username</span> -->
				<input
					bind:value={username}
					bind:this={inputRef}
					class="input"
					type="text"
					placeholder="ercouldnt"
				/>
			</label>
			<button on:click={getUsernameId} type="button" class="btn variant-ghost-primary"
				>Let's go</button
			>
		</form>

		{#if loading}
			<div class="flex flex-col items-center space-y-2 justify-center">
				<ProgressRadial />
				<p class="font-semibold">Loading</p>
			</div>
		{/if}

		<!-- <ul>
			<li><code class="code">ds_user_id: {ds_user_id || "null"}</code></li>
			<li><code class="code">/src/routes/+layout.svelte</code> - barebones layout</li>
			<li><code class="code">/src/app.postcss</code> - app wide css</li>
			<li>
				<code class="code">/src/routes/+page.svelte</code> - this page, you can replace the contents
			</li>
		</ul> -->

		<but class="flex flex-col space-y-5">
			{#if users.length}
				{#each users as data}
					<!-- svelte-ignore a11y-click-events-have-key-events -->
					<!-- svelte-ignore a11y-no-static-element-interactions -->
					<div
						on:click={() => chooseProfile(data.user.id, data.user.username)}
						class="p-2 border border-transparent flex items-center space-x-5 cursor-pointer hover:border hover:border-dashed hover:border-primary-500 rounded-lg"
					>
						<Avatar
							src={`/api/proxy?url=${encodeURIComponent(data.user.profile_pic_url)}`}
							width="w-20"
							rounded="rounded-full"
							alt={data.user.username}
						/>
						<div>
							<p class="font-bold">{data.user.full_name}</p>
							<a
								href={`https://www.instagram.com/${data.user.username}`}
								class="underline text-blue-500 hover:text-blue-600"
								target="_blank"
								rel="noopener noreferrer"
							>
								{data.user.username}
							</a>
							<p class="text-sm font-thin">
								{data.user.is_private ? "Private" : data.user.is_verified ? "Verified" : "Public"}
							</p>
						</div>
					</div>
				{/each}
			{/if}
		</but>
	</div>
</div>

<pre>{response}</pre>
