import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const ConfigSchema = z.object({
	whatsappToPhone: z
		.string()
		.min(8)
		.describe("WhatsApp recipient in E.164 format"),
	seapCounty: z.string().default("Brasov").describe("County to monitor"),
	cronMorning: z.string().default("0 7 * * 1-5").describe("Morning cron (EET)"),
	cronAfternoon: z
		.string()
		.default("0 13 * * 1-5")
		.describe("Afternoon cron (EET)"),
	dbPath: z
		.string()
		.default("./data/seap-watcher.db")
		.describe("SQLite DB path"),
	logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
	maxTendersPerRun: z.coerce.number().int().min(1).max(2000).default(200),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
	return ConfigSchema.parse({
		whatsappToPhone: process.env.WHATSAPP_TO_PHONE,
		seapCounty: process.env.SEAP_COUNTY,
		cronMorning: process.env.CRON_MORNING,
		cronAfternoon: process.env.CRON_AFTERNOON,
		dbPath: process.env.DB_PATH,
		logLevel: process.env.LOG_LEVEL,
		maxTendersPerRun: process.env.MAX_TENDERS_PER_RUN,
	});
}
