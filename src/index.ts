/**
 * SEAP Brasov Tender Watcher — main entry point.
 *
 * Bootstrap: load config, init DB, init WhatsApp, start scheduler.
 */

import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { initDatabase, closeDatabase } from "./db/database.js";
import { startScheduler, runCheck } from "./scheduler.js";
import { createBaileysClient } from "./whatsapp/client.js";
import { createNoOpClient } from "./whatsapp/noop.js";

async function main(): Promise<void> {
	// 1. Load config
	const config = loadConfig();
	const logger = createLogger(config.logLevel);

	logger.info({ county: config.seapCounty }, "SEAP Watcher starting...");

	// 2. Initialise database
	const db = initDatabase(config.dbPath, logger);

	// 3. Initialise WhatsApp client
	//    Use NO_OP_WHATSAPP=1 for development without a live Baileys connection
	const useNoOp = process.env.NO_OP_WHATSAPP === "1";

	let whatsapp;
	if (useNoOp) {
		whatsapp = await createNoOpClient(config.whatsappToPhones, logger);
	} else {
		whatsapp = await createBaileysClient(
			config.whatsappToPhones,
			logger,
			config.sessionPath,
		);
	}
	await whatsapp.connect();

	// 4. Check for --run-once flag (instant manual run)
	const runOnce = process.argv.includes("--run-once");
	if (runOnce) {
		logger.info("Manual run triggered (--run-once)");
		await runCheck("manual", config, db, whatsapp, logger);
		logger.info("Manual run complete — exiting");
		await whatsapp.close();
		closeDatabase(db);
		process.exit(0);
	}

	// 5. Start the scheduler
	const scheduler = startScheduler(config, db, whatsapp, logger);

	logger.info("Scheduler active. Waiting for cron triggers...");

	// 6. Graceful shutdown
	const shutdown = async (signal: string) => {
		logger.info(`${signal} received — shutting down...`);
		scheduler.stop();
		await whatsapp.close();
		closeDatabase(db);
		process.exit(0);
	};

	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
	console.error("Fatal error in SEAP Watcher:", err);
	process.exit(1);
});
