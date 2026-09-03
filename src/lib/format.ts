const dateTime = new Intl.DateTimeFormat("tr-TR", {
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit"
});

export function formatDate(value: Date | string | number | null | undefined): string {
	if (value === null || value === undefined) return "—";
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

export function formatNumber(value: number | null | undefined): string {
	return typeof value === "number" ? value.toLocaleString("tr-TR") : "—";
}
