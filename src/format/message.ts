/**
 * Formats a list of SEAP tenders into readable WhatsApp message(s).
 *
 * Romanian language, emoji indicators. Batches larger than
 * MAX_TENDERS_PER_MESSAGE are split across multiple messages instead of
 * being truncated, so no tender is ever silently dropped from the alert.
 */

import type { SeapTender, RunSlot } from "../seap/types.js";

const MAX_TENDERS_PER_MESSAGE = 10;

/** Romanian day names. */
const ROMANIAN_DAYS = [
	"Duminică",
	"Luni",
	"Marți",
	"Miercuri",
	"Joi",
	"Vineri",
	"Sâmbătă",
];

/** Romanian month abbreviations. */
const ROMANIAN_MONTHS = [
	"Ian",
	"Feb",
	"Mar",
	"Apr",
	"Mai",
	"Iun",
	"Iul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** Format a Date to Romanian locale string, e.g. "Luni, 20 Iul 2026". */
function formatRomanianDate(date: Date): string {
	const dayName = ROMANIAN_DAYS[date.getDay()];
	const day = date.getDate();
	const month = ROMANIAN_MONTHS[date.getMonth()];
	const year = date.getFullYear();
	return `${dayName}, ${day} ${month} ${year}`;
}

/** Format a number as RON currency string, e.g. "16.811,20 RON". */
function formatValue(value: number | undefined): string {
	if (value === undefined || value === null || value <= 0) return "n/a";
	return (
		new Intl.NumberFormat("ro-RO", {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(value) + " RON"
	);
}

/** Slot label in Romanian. */
function slotLabel(slot: RunSlot): string {
	if (slot === "morning") return "dimineața";
	if (slot === "afternoon") return "seara";
	return "manual";
}

/**
 * Format a single tender entry for the message body.
 */
function formatTenderEntry(index: number, t: SeapTender): string {
	const lines: string[] = [];

	const marker = t.nearThreshold ? " ⚠️" : "";
	lines.push(`${index}. [${t.sicapId}] ${t.title}${marker}`);
	lines.push(`   Autoritate: ${t.authorityName}`);
	lines.push(`   Valoare: ${formatValue(t.valueRon)}`);

	const cpvPart = t.cpvLabel ? `${t.cpvCode} (${t.cpvLabel})` : t.cpvCode;
	lines.push(`   CPV: ${cpvPart}`);

	if (t.deadline) {
		lines.push(`   Termen: ${t.deadline}`);
	}

	if (t.nearThreshold) {
		lines.push(
			"   ⚠️ Aproape de pragul de achiziție directă — posibilă divizare a contractului",
		);
	}

	lines.push(`   Link: ${t.url}`);

	return lines.join("\n");
}

/** Build a single message for one chunk of tenders within a (possibly multi-part) batch. */
function buildMessage(
	chunk: SeapTender[],
	slot: RunSlot,
	startIndex: number,
	totalCount: number,
	partIndex: number,
	totalParts: number,
): string {
	const now = new Date();
	const dateStr = formatRomanianDate(now);
	const slotStr = slotLabel(slot);

	const separator = "─".repeat(35);
	const partSuffix = totalParts > 1 ? ` — partea ${partIndex}/${totalParts}` : "";

	const header = `📋 SEAP Alert — Brasov (${dateStr} — ${slotStr})${partSuffix}`;

	const bodyLines = chunk.map((t, i) => formatTenderEntry(startIndex + i + 1, t));

	let totalLine: string;
	if (totalCount === 1) {
		totalLine = "Total: 1 licitație noi";
	} else {
		totalLine = `Total: ${totalCount} licitații noi`;
	}
	if (totalParts > 1) {
		totalLine += ` (partea ${partIndex}/${totalParts})`;
	}

	return [header, separator, ...bodyLines, "", totalLine, separator].join("\n");
}

/**
 * Format the full WhatsApp alert for a batch of tenders as one message per
 * chunk of at most MAX_TENDERS_PER_MESSAGE tenders — never truncates, splits
 * into as many messages as needed instead.
 *
 * @param tenders  — list of new (or modified) tenders to alert
 * @param slot     — 'morning' or 'afternoon' cron slot
 */
export function formatWhatsAppMessages(
	tenders: SeapTender[],
	slot: RunSlot,
): string[] {
	if (tenders.length === 0) {
		return [buildMessage([], slot, 0, 0, 1, 1)];
	}

	const chunks: SeapTender[][] = [];
	for (let i = 0; i < tenders.length; i += MAX_TENDERS_PER_MESSAGE) {
		chunks.push(tenders.slice(i, i + MAX_TENDERS_PER_MESSAGE));
	}

	const totalParts = chunks.length;
	return chunks.map((chunk, idx) =>
		buildMessage(
			chunk,
			slot,
			idx * MAX_TENDERS_PER_MESSAGE,
			tenders.length,
			idx + 1,
			totalParts,
		),
	);
}

/**
 * Format a "no new tenders" informational message.
 */
export function formatNoNewTendersMessage(slot: RunSlot): string {
	const now = new Date();
	const dateStr = formatRomanianDate(now);
	const slotStr = slotLabel(slot);

	return `✅ Nicio licitație nouă — Brasov (${dateStr} — ${slotStr})`;
}

/**
 * Format an error message when a scheduled run fails.
 */
export function formatErrorMessage(slot: RunSlot, error: string): string {
	const now = new Date();
	const dateStr = formatRomanianDate(now);
	const slotStr = slotLabel(slot);

	return `⚠️ Eroare SEAP Watcher — Brasov (${dateStr} — ${slotStr})\n\n${error}`;
}
