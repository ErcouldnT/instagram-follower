<script lang="ts">
	import "../app.postcss";

	// Highlight JS
	import hljs from "highlight.js/lib/core";
	import "highlight.js/styles/github-dark.css";
	import { storeHighlightJs } from "@skeletonlabs/skeleton";
	import xml from "highlight.js/lib/languages/xml"; // for HTML
	import css from "highlight.js/lib/languages/css";
	import javascript from "highlight.js/lib/languages/javascript";
	import typescript from "highlight.js/lib/languages/typescript";

	hljs.registerLanguage("xml", xml); // for HTML
	hljs.registerLanguage("css", css);
	hljs.registerLanguage("javascript", javascript);
	hljs.registerLanguage("typescript", typescript);
	storeHighlightJs.set(hljs);

	// Floating UI for Popups
	import { computePosition, autoUpdate, flip, shift, offset, arrow } from "@floating-ui/dom";
	import { storePopup } from "@skeletonlabs/skeleton";
	storePopup.set({ computePosition, autoUpdate, flip, shift, offset, arrow });

	// Global Scan Store
	import { scanStore } from "$lib/stores/scanStore";
	import { fly } from "svelte/transition";
</script>

<svelte:head>
	<title>Instagram Follower</title>
</svelte:head>

<slot />

{#if $scanStore.isScanning || ($scanStore.progress === 100 && $scanStore.status === "Scan Complete!")}
	<div
		transition:fly={{ y: 50, duration: 300 }}
		class="fixed bottom-0 left-0 right-0 bg-surface-100-800-token border-t border-surface-500/30 p-4 shadow-2xl z-[90] flex items-center justify-between"
	>
		<div class="flex items-center space-x-4 w-full max-w-4xl mx-auto">
			<div class="flex-1">
				<div class="flex justify-between mb-1">
					<span class="font-bold">{$scanStore.targetUsername}</span>
					<span class="text-xs opacity-70">{$scanStore.status}</span>
				</div>
				<div class="w-full bg-surface-200 rounded-full h-2 dark:bg-surface-700">
					<div
						class="bg-primary-500 h-2 rounded-full transition-all duration-300"
						style="width: {$scanStore.progress}%"
					></div>
				</div>
			</div>
			{#if $scanStore.status === "Scan Complete!"}
				<button class="btn btn-sm variant-ghost-surface" on:click={() => scanStore.reset()}
					>Close</button
				>
			{/if}
		</div>
	</div>
{/if}
