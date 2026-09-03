<script lang="ts">
	interface Props {
		src?: string | null;
		username: string;
		size?: number;
	}

	let { src = null, username, size = 40 }: Props = $props();

	let failed = $state(false);

	// Instagram's CDN refuses cross-origin hotlinks, so avatars go through the
	// server-side proxy, which only accepts Instagram CDN hosts.
	const proxied = $derived(src ? `/api/image?url=${encodeURIComponent(src)}` : null);
	const initials = $derived(username.slice(0, 2).toUpperCase());
</script>

<div
	class="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 text-xs font-semibold text-ink-dim"
	style="width: {size}px; height: {size}px"
>
	{#if proxied && !failed}
		<img
			src={proxied}
			alt=""
			width={size}
			height={size}
			loading="lazy"
			class="h-full w-full object-cover"
			onerror={() => (failed = true)}
		/>
	{:else}
		<span aria-hidden="true">{initials}</span>
	{/if}
</div>
