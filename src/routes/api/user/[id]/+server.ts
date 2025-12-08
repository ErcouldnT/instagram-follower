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
	const results: UserNode[] = [];
	let scrollCycle = 0;
	let hasNext = true;
	let currentFollowedUsersCount = 0;
	let totalFollowedUsersCount = -1;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let percentage = 0;

	const user_id = params.id;
	// url comes from SvelteKit event
	const username = url.searchParams.get("username") || "";

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

	while (hasNext) {
		let receivedData: User;

		try {
			const response = await axios.get(instagramUrl, {
				headers: {
					Cookie: cookieString
				},
				withCredentials: true,
				timeout: 10000 // ms cinsinden (örneğin burada 10 saniye)
			});
			const userData = response.data.data.user;

			// Debug logging
			if (scrollCycle === 0) {
				console.log('Fetched User Data:', {
					username: userData.username,
					id: userData.id,
					full_name: userData.full_name
				});
			}

			receivedData = userData.edge_follow;

			// Update scan with username if we haven't yet (fallback if not provided in URL)
			if (scrollCycle === 0 && userData.username && !username) {
				try {
					console.log(`Updating scan ${scan_id} with username from Instagram: ${userData.username}`);
					await pb.collection("scans").update(scan_id, { username: userData.username });
				} catch (err) {
					console.error("Failed to update scan with username:", err);
				}
			}

		} catch (error: unknown) {
			if (axios.isAxiosError(error)) {
				return json({ error: error.message, details: error.response?.data }, { status: 500 });
			} else {
				return json({ error: "An unknown error occurred" }, { status: 500 });
			}
		}

		if (totalFollowedUsersCount === -1) {
			totalFollowedUsersCount = receivedData.count - 1;
		}

		hasNext = receivedData.page_info.has_next_page;
		instagramUrl = urlGenerator(user_id, receivedData.page_info.end_cursor);
		currentFollowedUsersCount += receivedData.edges.length;
		percentage = Math.floor((currentFollowedUsersCount / totalFollowedUsersCount) * 100);

		receivedData.edges.forEach((x) => results.push(x.node));

		await sleep(
			Math.floor(
				Math.random() * (timings.timeBetweenSearchCycles - timings.timeBetweenSearchCycles * 0.7)
			) + timings.timeBetweenSearchCycles
		);

		scrollCycle++;

		if (scrollCycle > 6) {
			scrollCycle = 0;
			console.log({
				text: `Sleeping ${timings.timeToWaitAfterFiveSearchCycles / 1000} seconds to prevent getting temp blocked`
			});
			await sleep(timings.timeToWaitAfterFiveSearchCycles);
		}
	}

	const mappedResults = results.map((user) => ({
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

	// Pocketbase doesn't support bulk insert directly like Supabase, so we loop.
	// We use Promise.all to do it in parallel, but maybe in chunks if too many.
	// For now, let's try parallel chunks of 50 to avoid hitting limits if any.

	const chunkSize = 50;
	for (let i = 0; i < mappedResults.length; i += chunkSize) {
		const chunk = mappedResults.slice(i, i + chunkSize);
		await Promise.all(
			chunk.map((data) => pb.collection("instagram_users").create(data).catch((err) => {
				console.error("Error creating user:", data.username, err);
			}))
		);
	}

	return json({
		user_id,
		totalFollowedUsersCount,
		percentage,
		results
	});
};
