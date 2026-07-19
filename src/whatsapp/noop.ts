/**
 * No-op WhatsApp client — logs messages instead of sending them.
 *
 * Used during Phase 3 so the scheduler can be tested without
 * a live Baileys connection. Replaced by the real client in Phase 4.
 */

import type { Logger } from "pino";
import type { WhatsAppClient } from "./types.js";

export class NoOpWhatsAppClient implements WhatsAppClient {
	private _connected = false;

	constructor(
		private _toPhone: string,
		private _logger: Logger,
	) {}

	async connect(): Promise<void> {
		this._connected = true;
		this._logger.info(`[NoOpWhatsApp] Connected (to: ${this._toPhone})`);
	}

	async sendMessage(text: string): Promise<boolean> {
		if (!this._connected) {
			this._logger.error("[NoOpWhatsApp] Not connected — message dropped");
			return false;
		}
		this._logger.info(
			{ to: this._toPhone },
			"[NoOpWhatsApp] Would send:\n" + text,
		);
		return true;
	}

	isConnected(): boolean {
		return this._connected;
	}

	async close(): Promise<void> {
		this._connected = false;
		this._logger.info("[NoOpWhatsApp] Closed");
	}
}

export async function createNoOpClient(
	toPhone: string,
	logger: Logger,
): Promise<WhatsAppClient> {
	return new NoOpWhatsAppClient(toPhone, logger);
}
