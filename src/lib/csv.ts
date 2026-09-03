/**
 * RFC 4180 quoting.
 *
 * The original export joined raw fields with commas, so any account whose
 * display name contained a comma or quote shifted every later column.
 */
function cell(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function toCsv(rows: string[][]): string {
	return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

/**
 * Hands the file over as a Blob rather than a `data:` URL. Percent-encoding a
 * whole export blows past URL length limits and mangles non-ASCII names.
 */
export function downloadCsv(filename: string, rows: string[][]): void {
	const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}
