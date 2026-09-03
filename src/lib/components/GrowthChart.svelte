<script lang="ts">
	interface Point {
		at: number;
		count: number;
	}

	interface Series {
		username: string;
		points: Point[];
	}

	let { series }: { series: Series[] } = $props();

	/**
	 * Categorical slots in fixed order, stepped for this dark surface.
	 * Validated for CVD separation, contrast and lightness — never cycled, so a
	 * given account keeps its colour no matter how many others are on screen.
	 */
	const SLOTS = [
		"#3987e5",
		"#d95926",
		"#199e70",
		"#c98500",
		"#d55181",
		"#008300",
		"#9085e9",
		"#e66767"
	];
	const MAX_SERIES = SLOTS.length;

	const HEIGHT = 320;
	const PAD = { top: 16, right: 96, bottom: 36, left: 52 };

	let width = $state(760);
	let hover = $state<number | null>(null);

	const shown = $derived(series.slice(0, MAX_SERIES));
	const overflow = $derived(Math.max(0, series.length - MAX_SERIES));

	const times = $derived(
		[...new Set(shown.flatMap((s) => s.points.map((p) => p.at)))].sort((a, b) => a - b)
	);

	const domain = $derived.by(() => {
		const counts = shown.flatMap((s) => s.points.map((p) => p.count));
		const maxCount = Math.max(1, ...counts);
		// Round the top of the axis up to something readable.
		const magnitude = 10 ** Math.floor(Math.log10(maxCount));
		const top = Math.ceil(maxCount / magnitude) * magnitude;
		const minAt = times[0] ?? 0;
		const maxAt = times.at(-1) ?? 1;
		return { top, minAt, maxAt: maxAt === minAt ? minAt + 1 : maxAt };
	});

	const plotWidth = $derived(Math.max(80, width - PAD.left - PAD.right));
	const plotHeight = HEIGHT - PAD.top - PAD.bottom;

	const scaleX = $derived(
		(at: number) => PAD.left + ((at - domain.minAt) / (domain.maxAt - domain.minAt)) * plotWidth
	);
	const scaleY = $derived((count: number) => PAD.top + (1 - count / domain.top) * plotHeight);

	const paths = $derived(
		shown.map((s, index) => ({
			username: s.username,
			color: SLOTS[index] ?? SLOTS[0]!,
			points: s.points.map((p) => ({ ...p, x: scaleX(p.at), y: scaleY(p.count) })),
			d: s.points
				.map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(p.at)},${scaleY(p.count)}`)
				.join(" ")
		}))
	);

	const yTicks = $derived([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(domain.top * f)));

	const xTicks = $derived.by(() => {
		if (times.length <= 4) return times;
		const step = (times.length - 1) / 3;
		return [0, 1, 2, 3].map((i) => times[Math.round(i * step)]!);
	});

	const dateFormat = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" });
	const fullFormat = new Intl.DateTimeFormat("tr-TR", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit"
	});

	/** Snaps the crosshair to the nearest scan time rather than a free pixel. */
	function nearestTime(clientX: number, target: SVGSVGElement): number | null {
		const box = target.getBoundingClientRect();
		const x = clientX - box.left;
		let best: number | null = null;
		let bestDistance = Infinity;
		for (const at of times) {
			const distance = Math.abs(scaleX(at) - x);
			if (distance < bestDistance) {
				bestDistance = distance;
				best = at;
			}
		}
		return bestDistance <= 48 ? best : null;
	}

	const hoverRows = $derived.by(() => {
		if (hover === null) return [];
		return paths
			.map((p) => ({
				username: p.username,
				color: p.color,
				point: p.points.find((pt) => pt.at === hover)
			}))
			.filter(
				(
					row
				): row is { username: string; color: string; point: Point & { x: number; y: number } } =>
					Boolean(row.point)
			);
	});
</script>

<div class="relative" bind:clientWidth={width}>
	<svg
		{width}
		height={HEIGHT}
		role="img"
		aria-label="Accounts tracked per scan over time"
		onpointermove={(event) => (hover = nearestTime(event.clientX, event.currentTarget))}
		onpointerleave={() => (hover = null)}
	>
		<!-- Recessive gridlines: horizontal only -->
		{#each yTicks as tick (tick)}
			<line
				x1={PAD.left}
				x2={PAD.left + plotWidth}
				y1={scaleY(tick)}
				y2={scaleY(tick)}
				stroke="var(--color-line)"
				stroke-width="1"
				opacity={tick === 0 ? 0.9 : 0.35}
			/>
			<text
				x={PAD.left - 10}
				y={scaleY(tick)}
				text-anchor="end"
				dominant-baseline="middle"
				fill="var(--color-ink-dim)"
				font-size="11"
			>
				{tick.toLocaleString("tr-TR")}
			</text>
		{/each}

		{#each xTicks as tick (tick)}
			<text
				x={scaleX(tick)}
				y={HEIGHT - 12}
				text-anchor="middle"
				fill="var(--color-ink-dim)"
				font-size="11"
			>
				{dateFormat.format(new Date(tick))}
			</text>
		{/each}

		{#if hover !== null}
			<line
				x1={scaleX(hover)}
				x2={scaleX(hover)}
				y1={PAD.top}
				y2={PAD.top + plotHeight}
				stroke="var(--color-ink-dim)"
				stroke-width="1"
				stroke-dasharray="3 3"
			/>
		{/if}

		{#each paths as path (path.username)}
			<path
				d={path.d}
				fill="none"
				stroke={path.color}
				stroke-width="2"
				stroke-linejoin="round"
				stroke-linecap="round"
			/>
			{#each path.points as point (point.at)}
				<!-- 2px surface ring keeps overlapping markers separable -->
				<circle
					cx={point.x}
					cy={point.y}
					r={hover === point.at ? 6 : 4}
					fill={path.color}
					stroke="var(--color-surface-2)"
					stroke-width="2"
				/>
			{/each}

			<!-- Direct labels while the count stays legible -->
			{#if paths.length <= 4 && path.points.length > 0}
				<text
					x={(path.points.at(-1)?.x ?? 0) + 10}
					y={path.points.at(-1)?.y ?? 0}
					dominant-baseline="middle"
					fill="var(--color-ink)"
					font-size="11"
					font-weight="600"
				>
					{path.username}
				</text>
			{/if}
		{/each}
	</svg>

	{#if hover !== null && hoverRows.length > 0}
		<div
			class="pointer-events-none absolute top-4 z-10 min-w-44 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-xl"
			style="left: {Math.min(Math.max(scaleX(hover) + 12, 8), Math.max(8, width - 190))}px"
		>
			<p class="mb-1 font-medium text-ink-dim">{fullFormat.format(new Date(hover))}</p>
			{#each hoverRows as row (row.username)}
				<p class="flex items-center justify-between gap-3">
					<span class="flex items-center gap-2">
						<span class="inline-block h-2 w-2 rounded-full" style="background: {row.color}"></span>
						<span class="text-ink">{row.username}</span>
					</span>
					<span class="font-mono text-ink">{row.point.count.toLocaleString("tr-TR")}</span>
				</p>
			{/each}
		</div>
	{/if}
</div>

<!-- Legend is always present for two or more series, so identity is never colour alone -->
{#if paths.length > 1}
	<ul class="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-dim">
		{#each paths as path (path.username)}
			<li class="flex items-center gap-2">
				<span class="inline-block h-2 w-2 rounded-full" style="background: {path.color}"></span>
				{path.username}
			</li>
		{/each}
	</ul>
{/if}

{#if overflow > 0}
	<p class="mt-2 text-xs text-ink-dim">
		{overflow} more {overflow === 1 ? "account is" : "accounts are"} tracked but not charted.
	</p>
{/if}
