/**
 * Fetch orchestration — queries SEAP for Brasov tenders, stores them,
 * and returns only new (not yet alerted) tenders.
 */

import type { Database } from "better-sqlite3";
import type { Config } from "../config.js";
import type { Logger } from "pino";
import type { SeapTender, RunLog, RunSlot } from "./types.js";
import {
	searchAboveThresholdTenders,
	searchSubThresholdTenders,
	mapTender,
	mapDirectAcquisition,
	isBrasovTender,
	matchesTrustedBrasovKeyword,
	confirmCaNoticeCounty,
	confirmDaCounty,
	checkNearThreshold,
} from "./client.js";
import { upsertTenders, getNewTenders, logRun } from "../db/operations.js";

/**
 * Fetch Brasov tenders from SEAP for the last `windowHours` hours.
 *
 * 1. Calculate date window
 * 2. Fetch above-threshold (CAN) tenders
 * 3. Fetch sub-threshold (DA) tenders
 * 4. Filter by Brasov county (client-side)
 * 5. Upsert all into SQLite
 * 6. Return only tenders with alerted=0
 * 7. Log the run
 *
 * @param slot - Optional cron slot label for logging. Defaults to 'morning'.
 */
export async function fetchBrasovTenders(
	config: Config,
	db: Database,
	logger: Logger,
	slot: RunSlot = "morning",
): Promise<SeapTender[]> {
	const now = new Date();
	const windowHours = 12; // overlap safety — covers both morning and afternoon slots
	const sinceDate = new Date(
		now.getTime() - windowHours * 60 * 60 * 1000,
	).toISOString();

	const prefix = slot !== "morning" ? `[${slot}]` : "";
	const logPrefix = (msg: string) => (prefix ? `[${slot}] ${msg}` : msg);

	logger.info(
		{
			county: config.seapCounty,
			sinceDate,
			maxTenders: config.maxTendersPerRun,
		},
		logPrefix("Fetching SEAP tenders"),
	);

	const runLog: RunLog = {
		runAt: now.toISOString(),
		cronSlot: slot,
		totalFetched: 0,
		newTenders: 0,
		alertedCount: 0,
		status: "completed",
	};

	try {
		// 1. Fetch above-threshold tenders (CAN)
		const aboveResult = await searchAboveThresholdTenders(
			config.maxTendersPerRun,
			sinceDate,
		);
		logger.info(
			logPrefix(
				`Fetched ${aboveResult.items.length} above-threshold tenders (total matches: ${aboveResult.total})`,
			),
		);

		// 2. Fetch sub-threshold tenders (DA)
		const subResult = await searchSubThresholdTenders(
			config.maxTendersPerRun,
			sinceDate,
		);
		logger.info(
			logPrefix(
				`Fetched ${subResult.items.length} sub-threshold tenders (total matches: ${subResult.total})`,
			),
		);

		// 3. Map and filter by Brasov county
		const allTenders: SeapTender[] = [];

		// An explicit "Brasov"/"Brașov" mention is trusted directly — that also
		// covers national agencies awarding contracts for local Brasov projects
		// (e.g. CNAIR notices titled "D.R.D.P. Brasov"), where the authority
		// itself isn't registered in Brasov county. A match on an individual
		// town/comuna name alone is confirmed against the authority's real
		// registered county first, since several of those names collide with
		// same-named localities in other counties. Only runs on the small
		// already-filtered set, not every raw result, and fails open (keeps
		// the tender) if the confirmation lookup itself fails.
		for (const raw of aboveResult.items) {
			const tender = mapTender(raw, "above_threshold");
			if (!isBrasovTender(tender)) continue;

			const confirmed = matchesTrustedBrasovKeyword(tender)
				? true
				: await confirmCaNoticeCounty(raw.caNoticeId, config.seapCounty);
			if (confirmed !== false) {
				tender.county = config.seapCounty;
				allTenders.push(tender);
			}
		}

		for (const raw of subResult.items) {
			const tender = mapDirectAcquisition(raw);
			if (!isBrasovTender(tender)) continue;

			const confirmed = matchesTrustedBrasovKeyword(tender)
				? true
				: await confirmDaCounty(raw.directAcquisitionId, config.seapCounty);
			if (confirmed !== false) {
				tender.county = config.seapCounty;
				// Contract-splitting red flag: value suspiciously close to the
				// direct-acquisition threshold. Cheap in the common case —
				// only fetches DA detail when the value is already in a
				// candidate window (see checkNearThreshold).
				tender.nearThreshold = await checkNearThreshold(
					raw.directAcquisitionId,
					tender.valueRon,
				);
				allTenders.push(tender);
			}
		}

		logger.info(
			logPrefix(
				`Filtered to ${allTenders.length} Brasov tenders from ${aboveResult.items.length + subResult.items.length} total`,
			),
		);

		// 4. Upsert into SQLite
		if (allTenders.length > 0) {
			upsertTenders(db, allTenders);
			logger.info(
				logPrefix(`Upserted ${allTenders.length} tenders to database`),
			);
		}

		runLog.totalFetched = allTenders.length;

		// 5. Get new (not yet alerted) tenders
		const newTenders = getNewTenders(db);
		runLog.newTenders = newTenders.length;

		logger.info(logPrefix(`Found ${newTenders.length} new tenders to alert`));

		return newTenders;
	} catch (err) {
		logger.error({ err }, logPrefix("Failed to fetch SEAP tenders"));
		runLog.status = "failed";
		runLog.errorMessage = (err as Error).message;
		throw err;
	} finally {
		// Always log the run
		try {
			logRun(db, runLog);
		} catch (logErr) {
			logger.error({ err: logErr }, logPrefix("Failed to log run"));
		}
	}
}
