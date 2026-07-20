import pino from "pino";
import { createRequire } from "node:module";
import { Config } from "./config.js";

const VALID_LEVELS = ["debug", "info", "warn", "error"] as const;

// pino-pretty is a devDependency, pruned on the VPS by `npm prune
// --production`. Only request the pretty transport if it's actually
// resolvable, so a manual run without NODE_ENV=production (which the
// systemd unit sets, but an ad-hoc shell won't) degrades to plain JSON
// logging instead of crashing.
function prettyTransportAvailable(): boolean {
	try {
		createRequire(import.meta.url).resolve("pino-pretty");
		return true;
	} catch {
		return false;
	}
}

export function createLogger(level: (typeof VALID_LEVELS)[number] = "info") {
	const isDev = process.env.NODE_ENV !== "production";
	const usePretty = isDev && prettyTransportAvailable();

	return pino({
		level,
		transport: usePretty
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
