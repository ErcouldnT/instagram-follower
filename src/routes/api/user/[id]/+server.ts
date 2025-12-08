import axios from "axios";
import { json } from "@sveltejs/kit";
import { pb } from "$lib/pocketbase";
import { cookieString, sleep, urlGenerator } from "$lib/utils";
import type { Timings, User, UserNode } from "$lib/user.types.js";
import {
	DEFAULT_TIME_BETWEEN_SEARCH_CYCLES,
	DEFAULT_TIME_BETWEEN_UNFOLLOWS,
	DEFAULT_TIME_TO_WAIT_AFTER_FIVE_SEARCH_CYCLES,
	DEFAULT_TIME_TO_WAIT_AFTER_FIVE_UNFOLLOWS
} from "$lib/constants.js";

const timings: Timings = {
	timeBetweenSearchCycles: DEFAULT_TIME_BETWEEN_SEARCH_CYCLES,
	timeToWaitAfterFiveSearchCycles: DEFAULT_TIME_TO_WAIT_AFTER_FIVE_SEARCH_CYCLES,
	timeBetweenUnfollows: DEFAULT_TIME_BETWEEN_UNFOLLOWS,
	timeToWaitAfterFiveUnfollows: DEFAULT_TIME_TO_WAIT_AFTER_FIVE_UNFOLLOWS
};

export const GET = async ({ params, url }) => {
	const user_id = params.id;
	const username = url.searchParams.get("username") || "";

	// Create scan record immediately
	let scan_id: string;
	try {
		console.log(`Creating scan for user_id: ${user_id}, username: ${username}`);
		const scan = await pb.collection("scans").create({ user_id, username });
		scan_id = scan.id;
	} catch (error) {
		console.error("Pocketbase scan creation error:", error);
		return json({ error: "Failed to create scan record" }, { status: 500 });
	}

	let instagramUrl = urlGenerator(user_id);

	// Create a stream to send updates to the client
	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			const sendUpdate = (data: any) => {
				controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
			};

			const results: UserNode[] = [];
			let scrollCycle = 0;
			let hasNext = true;
			let currentFollowedUsersCount = 0;
			let totalFollowedUsersCount = -1;
			let percentage = 0;

			try {
				while (hasNext) {
					let receivedData: User;

					try {
						const response = await axios.get(instagramUrl, {
							headers: { Cookie: cookieString },
							withCredentials: true,
							timeout: 10000
						});
						const userData = response.data.data.user;
						receivedData = userData.edge_follow;
					} catch (error: any) {
						console.error("Instagram fetch error:", error);
						sendUpdate({ error: error.message || "Unknown error fetching from Instagram" });
						controller.close();
						return;
					}

					if (totalFollowedUsersCount === -1) {
						totalFollowedUsersCount = receivedData.count - 1; // -1 accounts for slight mismatch often seen
					}

					// pagination
					hasNext = receivedData.page_info.has_next_page;
					instagramUrl = urlGenerator(user_id, receivedData.page_info.end_cursor);

					const newUsers = receivedData.edges.map(x => x.node);
					currentFollowedUsersCount += newUsers.length;

					// Avoid division by zero
					if (totalFollowedUsersCount > 0) {
						percentage = Math.floor((currentFollowedUsersCount / totalFollowedUsersCount) * 100);
					} else {
						percentage = 0;
					}

					// IMMEDIATE DB INSERT
					const mappedChunk = newUsers.map((user) => ({
						scan_id,
						username: user.username,
						full_name: user.full_name,
						user_id: user.id,
						profile_pic_url: user.profile_pic_url,
						is_private: user.is_private,
						is_verified: user.is_verified,
						followed_by_viewer: user.followed_by_viewer,
						follows_viewer: user.follows_viewer,
						requested_by_viewer: user.requested_by_viewer
					}));

					// Insert logic (fire and forget for speed? No, wait to prevent rate limits/overload)
					await Promise.all(
						mappedChunk.map((data) => pb.collection("instagram_users").create(data).catch((err) => {
							console.error("Error creating user:", data.username, err);
						}))
					);

					// Collect results for final stats (optional, could just count DB)
					// We need them for verified/private count though.
					results.push(...newUsers);

					// STREAM PROGRESS
					sendUpdate({
						type: 'progress',
						percentage,
						current: currentFollowedUsersCount,
						total: totalFollowedUsersCount
					});

					await sleep(
						Math.floor(
							Math.random() * (timings.timeBetweenSearchCycles - timings.timeBetweenSearchCycles * 0.7)
						) + timings.timeBetweenSearchCycles
					);

					scrollCycle++;

					if (scrollCycle > 6) {
						scrollCycle = 0;
						sendUpdate({ type: 'log', message: `Sleeping ${timings.timeToWaitAfterFiveSearchCycles / 1000}s...` });
						await sleep(timings.timeToWaitAfterFiveSearchCycles);
					}
				}

				// Final Logic
				const verifiedCount = results.filter((u) => u.is_verified).length;
				const privateCount = results.filter((u) => u.is_private).length;

				try {
					console.log(`Updating scan ${scan_id} with final stats.`);
					await pb.collection("scans").update(scan_id, {
						count: totalFollowedUsersCount,
						verified_count: verifiedCount,
						private_count: privateCount
					});
				} catch (e) {
					console.error("Failed to update scan stats:", e);
				}

				sendUpdate({
					type: 'done',
					user_id,
					totalFollowedUsersCount,
					verifiedCount,
					privateCount,
					results: results // Sending all results back might be huge? Frontend doesn't seem to display them all immediately in the main page list, but let's keep compatibility.
					// Actually, the frontend is +page.svelte which only displays "Let's go".
					// The old code returned "results". The frontend displayed nothing specific about "results" array in main view, 
					// except maybe for debug?
					// Ah, the frontend uses `users` array populated from Search... 
					// Wait, chooseProfile triggers this API. 
					// The original code returned `results` and the frontend just `response = JSON.stringify(data, null, 2)`.
					// So sending results is fine for debug, but users are already in DB.
				});

				controller.close();

			} catch (error) {
				console.error("Stream error:", error);
				sendUpdate({ error: "Stream failed" });
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/json', // Or text/event-stream, but ndjson is simpler for manual parsing
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive'
		}
	});
};

