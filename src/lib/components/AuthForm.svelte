<script lang="ts">
	import { resolve } from "$app/paths";

	interface Props {
		mode: "login" | "signup";
		redirectTo: string;
	}

	let { mode, redirectTo }: Props = $props();

	let name = $state("");
	let email = $state("");
	let password = $state("");
	let busy = $state(false);
	let error = $state<string | null>(null);

	const isSignup = $derived(mode === "signup");

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;

		busy = true;
		error = null;

		try {
			const { signIn, signUp } = await import("$lib/auth-client");

			const result = isSignup
				? await signUp.email({ name: name.trim() || email.split("@")[0]!, email, password })
				: await signIn.email({ email, password });

			if (result.error) {
				error = result.error.message ?? "Authentication failed";
				return;
			}

			// A full navigation, not a client-side one: the session cookie must be
			// sent with the next document request for the server guard to see it.
			window.location.href = redirectTo || "/";
		} catch (err) {
			error = err instanceof Error ? err.message : "Authentication failed";
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} class="card space-y-4 p-6">
	<h1 class="text-xl font-bold">{isSignup ? "Create an account" : "Sign in"}</h1>

	{#if isSignup}
		<div>
			<label for="name" class="mb-1.5 block text-sm font-medium">Name</label>
			<input id="name" class="input" type="text" autocomplete="name" bind:value={name} />
		</div>
	{/if}

	<div>
		<label for="email" class="mb-1.5 block text-sm font-medium">Email</label>
		<input id="email" class="input" type="email" autocomplete="email" required bind:value={email} />
	</div>

	<div>
		<label for="password" class="mb-1.5 block text-sm font-medium">Password</label>
		<input
			id="password"
			class="input"
			type="password"
			autocomplete={isSignup ? "new-password" : "current-password"}
			required
			minlength={isSignup ? 8 : undefined}
			bind:value={password}
		/>
		{#if isSignup}
			<p class="mt-1 text-xs text-ink-dim">At least 8 characters.</p>
		{/if}
	</div>

	{#if error}
		<p class="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
			{error}
		</p>
	{/if}

	<button type="submit" class="btn btn-brand w-full" disabled={busy}>
		{busy ? "Working..." : isSignup ? "Sign up" : "Sign in"}
	</button>

	<p class="text-center text-sm text-ink-dim">
		{#if isSignup}
			Already have an account?
			<a href={resolve("/login")} class="underline">Sign in</a>
		{:else}
			No account yet?
			<a href={resolve("/signup")} class="underline">Sign up</a>
		{/if}
	</p>
</form>
