<script lang="ts">
	import AuthForm from "$lib/components/AuthForm.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();
</script>

<div class="mx-auto flex min-h-dvh max-w-md items-center px-4">
	<div class="w-full">
		<AuthForm mode="login" redirectTo={data.redirectTo} />
	</div>
</div>
