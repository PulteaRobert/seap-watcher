/**
 * Fetch orchestration — queries SEAP for Brasov tenders, stores them,
 * and returns only new (not yet alerted) tenders.
 */

import type { Database } from "better-sqlite3";
import type { Config } from "../config.js";
import type { Logger } from "pino";
import type { SeapTender, RunLog } from "./types.js";
import {
	searchAboveThresholdTenders,
	searchSubThresholdTenders,
	mapTender,
	isBrasovTender,
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
	slot: "morning" | "afternoon" = "morning",
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

		for (const raw of aboveResult.items) {
			const tender = mapTender(raw, "above_threshold");
			if (isBrasovTender(tender)) {
				tender.county = config.seapCounty;
				allTenders.push(tender);
			}
		}

		for (const raw of subResult.items) {
			const tender = mapTender(raw, "sub_threshold");
			if (isBrasovTender(tender)) {
				tender.county = config.seapCounty;
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
