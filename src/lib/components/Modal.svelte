<script lang="ts">
	import type { Snippet } from "svelte";
	import { X } from "@lucide/svelte";

	interface Props {
		title: string;
		onclose: () => void;
		children: Snippet;
		actions?: Snippet;
		wide?: boolean;
	}

	let { title, onclose, children, actions, wide = false }: Props = $props();
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === "Escape") onclose();
	}}
/>

<div
	class="fixed inset-0 z-100 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
	role="presentation"
	onclick={(event) => {
		if (event.target === event.currentTarget) onclose();
	}}
>
	<div
		class="card flex max-h-[88vh] w-full flex-col {wide ? 'max-w-4xl' : 'max-w-md'}"
		role="dialog"
		aria-modal="true"
		aria-label={title}
	>
		<header class="flex items-center justify-between border-b border-line px-5 py-4">
			<h2 class="text-lg font-semibold">{title}</h2>
			<button class="btn px-2 py-2" onclick={onclose} aria-label="Close">
				<X size="16" />
			</button>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
			{@render children()}
		</div>

		{#if actions}
			<footer class="flex justify-end gap-3 border-t border-line px-5 py-4">
				{@render actions()}
			</footer>
		{/if}
	</div>
</div>
