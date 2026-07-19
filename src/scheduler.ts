/**
 * Scheduled task runner — triggers the fetch → dedup → alert pipeline
 * twice daily on weekdays via node-cron.
 */

import cron from "node-cron";
import type { Database } from "better-sqlite3";
import type { Logger } from "pino";
import type { Config } from "./config.js";
import type { WhatsAppClient } from "./whatsapp/types.js";
import type { SeapTender } from "./seap/types.js";
import { fetchBrasovTenders } from "./seap/fetch.js";
import { markAsAlerted } from "./db/operations.js";
import { formatWhatsAppMessage } from "./format/message.js";
import { sendWithRetry } from "./whatsapp/send.js";

/* ------------------------------------------------------------------ */
/*  Run check                                                          */
/* ------------------------------------------------------------------ */

/**
 * Execute one scheduled check: fetch tenders, send WhatsApp alert
 * for new ones, and mark them as alerted.
 */
export type RunSlot = "morning" | "afternoon" | "manual";

/**
 * Execute one scheduled check: fetch tenders, send WhatsApp alert
 * for new ones, and mark them as alerted.
 */
export async function runCheck(
	slot: RunSlot,
	config: Config,
	db: Database,
	whatsapp: WhatsAppClient,
	logger: Logger,
): Promise<void> {
	const tag = `[${slot}]`;

	logger.info(`${tag} Scheduled check starting`);

	try {
		// 1. Fetch Brasov tenders from SEAP (this upserts to DB internally)
		const newTenders: SeapTender[] = await fetchBrasovTenders(
			config,
			db,
			logger,
			slot,
		);

		if (newTenders.length === 0) {
			logger.info(`${tag} No new tenders to alert`);
			return;
		}

		// 2. Format and send WhatsApp message (with retry)
		const message = formatWhatsAppMessage(newTenders, slot);
		const sent = await sendWithRetry(whatsapp, message);

		if (sent) {
			// 3. Mark tenders as alerted in DB
			const sicapIds = newTenders.map((t) => t.sicapId);
			markAsAlerted(db, sicapIds);
			logger.info(
				`${tag} Alerted ${newTenders.length} new tenders via WhatsApp`,
			);
		} else {
			logger.error(
				`${tag} Failed to send WhatsApp alert — tenders NOT marked as alerted`,
			);
		}
	} catch (err) {
		logger.error({ err }, `${tag} Scheduled check failed`);
	}
}

/* ------------------------------------------------------------------ */
/*  Scheduler                                                          */
/* ------------------------------------------------------------------ */

export interface SchedulerHandle {
	/** Stop the scheduler and wait for pending jobs to finish. */
	stop(): void;
}

/**
 * Start the cron-based scheduler with morning and afternoon slots.
 *
 * @returns A handle for stopping the scheduler.
 */
export function startScheduler(
	config: Config,
	db: Database,
	whatsapp: WhatsAppClient,
	logger: Logger,
): SchedulerHandle {
	const jobs: cron.ScheduledTask[] = [];

	// Morning run
	const morningJob = cron.schedule(
		config.cronMorning,
		() => {
			void runCheck("morning", config, db, whatsapp, logger);
		},
		{
			timezone: "Europe/Bucharest",
		},
	);
	jobs.push(morningJob);
	logger.info(`Morning cron scheduled: ${config.cronMorning}`);

	// Afternoon run
	const afternoonJob = cron.schedule(
		config.cronAfternoon,
		() => {
			void runCheck("afternoon", config, db, whatsapp, logger);
		},
		{
			timezone: "Europe/Bucharest",
		},
	);
	jobs.push(afternoonJob);
	logger.info(`Afternoon cron scheduled: ${config.cronAfternoon}`);

	return {
		stop() {
			for (const job of jobs) {
				job.stop();
			}
			logger.info("Scheduler stopped");
		},
	};
}
