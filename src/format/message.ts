/**
 * Formats a list of SEAP tenders into a readable WhatsApp message.
 *
 * Romanian language, emoji indicators, max 20 tenders per message
 * with truncation indicator.
 */

import type { SeapTender } from "../seap/types.js";
import type { RunSlot } from "../scheduler.js";

const MAX_TENDERS_PER_MESSAGE = 20;

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

	lines.push(`${index}. [${t.sicapId}] ${t.title}`);
	lines.push(`   Autoritate: ${t.authorityName}`);
	lines.push(`   Valoare: ${formatValue(t.valueRon)}`);

	const cpvPart = t.cpvLabel ? `${t.cpvCode} (${t.cpvLabel})` : t.cpvCode;
	lines.push(`   CPV: ${cpvPart}`);

	if (t.deadline) {
		lines.push(`   Termen: ${t.deadline}`);
	}

	lines.push(`   Link: ${t.url}`);

	return lines.join("\n");
}

/**
 * Format the full WhatsApp alert message for a batch of tenders.
 *
 * @param tenders  — list of new (or modified) tenders to alert
 * @param slot     — 'morning' or 'afternoon' cron slot
 */
export function formatWhatsAppMessage(
	tenders: SeapTender[],
	slot: RunSlot,
): string {
	const now = new Date();
	const dateStr = formatRomanianDate(now);
	const slotStr = slotLabel(slot);

	const separator = "─".repeat(35);

	const header = `📋 SEAP Alert — Brasov (${dateStr} — ${slotStr})`;

	// Truncate if too many tenders
	const truncated = tenders.length > MAX_TENDERS_PER_MESSAGE;
	const displayed = truncated
		? tenders.slice(0, MAX_TENDERS_PER_MESSAGE)
		: tenders;

	const bodyLines = displayed.map((t, i) => formatTenderEntry(i + 1, t));

	let totalLine: string;
	if (truncated) {
		totalLine = `Total: ${tenders.length} licitații noi (afisate ${MAX_TENDERS_PER_MESSAGE}…)`;
	} else if (tenders.length === 1) {
		totalLine = "Total: 1 licitație noi";
	} else {
		totalLine = `Total: ${tenders.length} licitații noi`;
	}

	return [header, separator, ...bodyLines, "", totalLine, separator].join("\n");
}

/**
 * Format a "no new tenders" informational message.
 */
export function formatNoNewTendersMessage(
	slot: RunSlot,
): string {
	const now = new Date();
	const dateStr = formatRomanianDate(now);
	const slotStr = slotLabel(slot);

	return `✅ Nicio licitație nouă — Brasov (${dateStr} — ${slotStr})`;
}

/**
 * Format an error message when a scheduled run fails.
 */
export function formatErrorMessage(
	slot: RunSlot,
	error: string,
): string {
	const now = new Date();
	const dateStr = formatRomanianDate(now);
	const slotStr = slotLabel(slot);

	return `⚠️ Eroare SEAP Watcher — Brasov (${dateStr} — ${slotStr})\n\n${error}`;
}
