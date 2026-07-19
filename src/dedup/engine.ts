/**
 * Deduplication engine — compares current SEAP results against stored state
 * and identifies truly new vs. modified vs. unchanged tenders.
 */

import type { SeapTender } from "../seap/types.js";

export interface DedupResult {
	/** Tenders never seen before. */
	new: SeapTender[];

	/** Existing tenders with changed fields (value, state, deadline, etc.). */
	modified: SeapTender[];

	/** Count of tenders that are identical to stored state. */
	unchanged: number;
}

/**
 * Fields that indicate a meaningful change to an existing tender.
 */
const SIGNIFICANT_FIELDS: (keyof Pick<
	SeapTender,
	"valueRon" | "state" | "deadline" | "publicationDate"
>)[] = ["valueRon", "state", "deadline", "publicationDate"];

/**
 * Check whether two tenders (same sicapId) differ in significant fields.
 */
function isModified(current: SeapTender, stored: SeapTender): boolean {
	for (const field of SIGNIFICANT_FIELDS) {
		if (current[field] !== stored[field]) return true;
	}
	return false;
}

/**
 * Compute the diff between a fresh batch of tenders and the stored database
 * snapshot, returning new, modified, and unchanged counts.
 *
 * @param current  — tenders just fetched from SEAP
 * @param stored   — tenders already in the database (matched by sicap_id)
 */
export function computeDiff(
	current: SeapTender[],
	stored: SeapTender[],
): DedupResult {
	// Index stored tenders by sicap_id for O(1) lookup
	const storedMap = new Map(stored.map((t) => [t.sicapId, t]));

	const newTenders: SeapTender[] = [];
	const modifiedTenders: SeapTender[] = [];
	let unchangedCount = 0;

	// Track which stored tenders we've seen (for the unchanged count)
	const seenIds = new Set<string>();

	for (const tender of current) {
		const existing = storedMap.get(tender.sicapId);

		if (!existing) {
			// Never seen before
			newTenders.push(tender);
		} else if (isModified(tender, existing)) {
			// Known tender but something changed
			modifiedTenders.push(tender);
		}

		seenIds.add(tender.sicapId);
	}

	// Unchanged = stored tenders that appeared in current with no diffs
	// We count them as: total current matches in stored minus modified count
	let matchedCount = 0;
	for (const tender of current) {
		if (storedMap.has(tender.sicapId)) {
			matchedCount++;
		}
	}
	unchangedCount = matchedCount - modifiedTenders.length;

	return {
		new: newTenders,
		modified: modifiedTenders,
		unchanged: unchangedCount,
	};
}

/**
 * Convenience: compute diff and return only the tenders worth alerting
 * (new + modified).
 */
export function alertableTenders(
	current: SeapTender[],
	stored: SeapTender[],
): SeapTender[] {
	const { new: newT, modified } = computeDiff(current, stored);
	return [...newT, ...modified];
}
