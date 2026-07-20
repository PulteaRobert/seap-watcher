import { z } from "zod";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";

// Resolve relative to the project root (one level above this file's
// directory — src/ in dev, dist/ when compiled) rather than process.cwd(),
// so config loads correctly no matter what directory the process was
// launched from (e.g. a manual `node dist/index.js` run outside the
// systemd unit's WorkingDirectory).
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
dotenv.config({ path: resolve(projectRoot, ".env") });

/** Resolve a possibly-relative path against the project root, not cwd. */
function resolveFromRoot(path: string): string {
	return isAbsolute(path) ? path : resolve(projectRoot, path);
}

const ConfigSchema = z.object({
	whatsappToPhones: z
		.string()
		.min(8)
		.transform((s) =>
			s
				.split(",")
				.map((p) => p.trim())
				.filter((p) => p.length > 0),
		)
		.refine((arr) => arr.length > 0, {
			message: "WHATSAPP_TO_PHONE must contain at least one phone number",
		})
		.describe(
			"WhatsApp recipients in E.164 format, comma-separated for multiple numbers",
		),
	seapCounty: z.string().default("Brasov").describe("County to monitor"),
	cronSchedule: z
		.string()
		.default("0 17 * * 1-5")
		.describe("Daily check cron expression (EET)"),
	dbPath: z
		.string()
		.default("./data/seap-watcher.db")
		.transform(resolveFromRoot)
		.describe("SQLite DB path"),
	sessionPath: z
		.string()
		.default("./session")
		.transform(resolveFromRoot)
		.describe("Baileys WhatsApp session directory"),
	logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
	maxTendersPerRun: z.coerce.number().int().min(1).max(2000).default(200),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
	return ConfigSchema.parse({
		whatsappToPhones: process.env.WHATSAPP_TO_PHONE,
		seapCounty: process.env.SEAP_COUNTY,
		cronSchedule: process.env.CRON_SCHEDULE,
		dbPath: process.env.DB_PATH,
		sessionPath: process.env.SESSION_PATH,
		logLevel: process.env.LOG_LEVEL,
		maxTendersPerRun: process.env.MAX_TENDERS_PER_RUN,
	});
}
