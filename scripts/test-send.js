#!/usr/bin/env node
/**
 * Ad-hoc WhatsApp delivery check — connects and sends a marker message to
 * every configured recipient, independent of whether SEAP currently has
 * any new tenders (the normal pipeline only sends when there's something
 * new to alert on).
 *
 * The live systemd service and this script share the same WhatsApp
 * session; running both at once causes a connection conflict. Stop the
 * service first:
 *
 *   sudo systemctl stop seap-watcher
 *   sudo -u seap NODE_ENV=production node scripts/test-send.js
 *   sudo systemctl start seap-watcher
 */
import { loadConfig } from "../dist/config.js";
import { createLogger } from "../dist/logger.js";
import { createBaileysClient } from "../dist/whatsapp/client.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

// Only the first configured recipient — avoids poking the second number's
// session while it's mid-repair.
const [firstPhone] = config.whatsappToPhones;

const client = await createBaileysClient(
	[firstPhone],
	logger,
	config.sessionPath,
);

await client.connect();

// Give Baileys a moment to finish its initial sync before sending.
await new Promise((r) => setTimeout(r, 5000));

const message = `seap-watcher test message — ${new Date().toISOString()}`;
const ok = await client.sendMessage(message);

logger.info(
	{ ok, recipient: firstPhone },
	"Test send complete — check the phone individually",
);

await client.close();
process.exit(ok ? 0 : 1);
