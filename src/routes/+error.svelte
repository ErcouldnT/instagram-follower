<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
</script>

<div
	class="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center"
>
	<h1 class="text-5xl font-bold">{page.status}</h1>
	<p class="text-ink-dim">{page.error?.message ?? "Something went wrong."}</p>
	<a href={resolve("/")} class="btn btn-brand">Back to start</a>
</div>
