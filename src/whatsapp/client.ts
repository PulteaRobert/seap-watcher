/**
 * Real WhatsApp client backed by Baileys (WhatsApp Web automation).
 *
 * Wraps Baileys with session persistence, auto-reconnect, and a clean
 * interface matching {@link WhatsAppClient} from `./types.js`.
 */

import {
	makeWASocket,
	DisconnectReason,
	useMultiFileAuthState,
	fetchLatestBaileysVersion,
	type SocketConfig,
	type BaileysEventMap,
} from "baileys";
import qrcodeTerminal from "qrcode-terminal";
import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import type { WhatsAppClient } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Baileys socket type alias                                         */
/* ------------------------------------------------------------------ */

type BaileysSocket = ReturnType<typeof makeWASocket>;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute an exponential backoff delay (seconds) for the given attempt.
 * Attempt 0 → 5s, attempt 1 → 10s, attempt 2 → 20s, … capped at 60s.
 */
function reconnectDelay(attempt: number): number {
	return Math.min(5 * 2 ** attempt, 60);
}

/* ------------------------------------------------------------------ */
/*  BaileysWhatsAppClient                                             */
/* ------------------------------------------------------------------ */

export class BaileysWhatsAppClient implements WhatsAppClient {
	private _sock: BaileysSocket | null = null;
	private _connected = false;
	private _reconnectAttempts = 0;
	private _closing = false;

	constructor(
		private _toPhones: string[],
		private _logger: Logger,
		private _sessionPath: string = "./session",
		private _maxReconnectAttempts: number = 5,
	) {}

	/* ---- lifecycle -------------------------------------------------- */

	async connect(): Promise<void> {
		if (this._connected) {
			this._logger.debug("WhatsApp already connected");
			return;
		}

		// Ensure session directory exists
		if (!existsSync(this._sessionPath)) {
			mkdirSync(this._sessionPath, { recursive: true });
		}

		const { state, saveCreds } = await useMultiFileAuthState(this._sessionPath);
		const { version } = await fetchLatestBaileysVersion();

		this._logger.info({ version }, "Connecting to WhatsApp (Baileys)");

		this._sock = makeWASocket({
			version,
			auth: state,
		} as SocketConfig);

		// Persist credentials updates (keeps session alive across restarts)
		this._sock.ev.on("creds.update", saveCreds as any);

		this._sock.ev.on(
			"connection.update",
			async (update: BaileysEventMap["connection.update"]) => {
				const { connection, lastDisconnect, qr } = update;

				if (qr) {
					this._logger.info(
						"QR code generated — scan with WhatsApp Web to authenticate",
					);
					qrcodeTerminal.generate(qr, { small: true });
				}

				if (connection === "close") {
					const statusCode = (
						lastDisconnect?.error as
							| { output?: { payload?: number } }
							| undefined
					)?.output?.payload;

					// 405 = account disconnected (logged out on phone) — do NOT reconnect
					const shouldReconnect = statusCode !== 405;

					if (shouldReconnect && !this._closing) {
						if (this._reconnectAttempts < this._maxReconnectAttempts) {
							this._reconnectAttempts++;
							const delay = reconnectDelay(this._reconnectAttempts);

							this._logger.warn(
								{
									attempt: this._reconnectAttempts,
									max: this._maxReconnectAttempts,
									delay,
									statusCode,
								},
								"WhatsApp disconnected — reconnecting",
							);

							await sleep(delay * 1000);
							await this.connect();
						} else {
							this._logger.error(
								{
									attempts: this._reconnectAttempts,
									statusCode,
								},
								"WhatsApp max reconnect attempts reached — giving up",
							);
						}
					}
				} else if (connection === "open") {
					this._connected = true;
					this._reconnectAttempts = 0;
					this._logger.info("WhatsApp connected successfully");
				}
			},
		);

		// Catch messages (log unexpected inbound traffic)
		this._sock.ev.on(
			"messages.upsert",
			(m: BaileysEventMap["messages.upsert"]) => {
				if (m.messages.length > 0) {
					this._logger.debug(
						{ count: m.messages.length },
						"Received inbound WhatsApp message(s)",
					);
				}
			},
		);
	}

	/* ---- messaging -------------------------------------------------- */

	async sendMessage(text: string): Promise<boolean> {
		if (!this._connected || !this._sock) {
			this._logger.error("WhatsApp not connected — message dropped");
			return false;
		}

		// Send to every configured recipient independently — one bad/invalid
		// number shouldn't block delivery to the rest.
		let anySent = false;
		for (const toPhone of this._toPhones) {
			try {
				const jid = `${toPhone}@s.whatsapp.net`;
				await this._sock.sendMessage(jid, { text });
				this._logger.info({ to: toPhone }, "WhatsApp message sent");
				anySent = true;
			} catch (err) {
				this._logger.error({ err, to: toPhone }, "Failed to send WhatsApp message");
			}
		}
		return anySent;
	}

	/* ---- status ----------------------------------------------------- */

	isConnected(): boolean {
		return this._connected;
	}

	/* ---- shutdown --------------------------------------------------- */

	async close(): Promise<void> {
		this._closing = true;

		if (this._sock) {
			try {
				this._sock.end(new Error("Shutting down"));
			} catch {
				// ignore — socket may already be closed
			}
			this._sock = null;
		}

		this._connected = false;
		this._logger.info("WhatsApp client closed");
	}

	/* ---- session housekeeping --------------------------------------- */

	/**
	 * Clean up old auth files. Baileys can leave stale files behind.
	 * Keeps files modified in the last `maxAgeDays` days.
	 */
	static async cleanupSession(
		sessionPath: string,
		maxAgeDays: number = 7,
	): Promise<void> {
		if (!existsSync(sessionPath)) return;

		const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
		const files = readdirSync(sessionPath);

		for (const file of files) {
			const path = join(sessionPath, file);
			try {
				const stats = await import("node:fs").then((m) => m.statSync(path));
				if (stats.mtimeMs < cutoff) {
					await import("node:fs").then((m) => m.unlinkSync(path));
				}
			} catch {
				// ignore permission errors on individual files
			}
		}
	}
}

/* ------------------------------------------------------------------ */
/*  Factory                                                           */
/* ------------------------------------------------------------------ */

export async function createBaileysClient(
	toPhones: string[],
	logger: Logger,
	sessionPath?: string,
): Promise<WhatsAppClient> {
	const client = new BaileysWhatsAppClient(toPhones, logger, sessionPath);
	return client;
}
