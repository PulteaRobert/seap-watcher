import pino from "pino";
import { Config } from "./config.js";

const VALID_LEVELS = ["debug", "info", "warn", "error"] as const;

export function createLogger(level: (typeof VALID_LEVELS)[number] = "info") {
	const isDev = process.env.NODE_ENV !== "production";

	return pino({
		level,
		transport: isDev
			? {
					target: "pino-pretty",
					options: {
						colorize: true,
						translateTime: "SYS:standard",
						ignore: "pid,hostname",
					},
				}
			: undefined,
	});
}
