/**
 * Retry wrapper for WhatsApp message delivery with exponential backoff.
 */

import type { WhatsAppClient } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Send a WhatsApp message with retry logic.
 *
 * Retries up to `maxRetries` times with increasing backoff:
 * 2s, 4s, 6s … This handles transient Baileys disconnects
 * without dropping the alert.
 *
 * @returns `true` if the message was delivered, `false` otherwise.
 */
export async function sendWithRetry(
	client: WhatsAppClient,
	message: string,
	maxRetries: number = 3,
): Promise<boolean> {
	for (let i = 0; i < maxRetries; i++) {
		const ok = await client.sendMessage(message);
		if (ok) return true;

		// Backoff before next attempt (skip sleep on last iteration)
		if (i < maxRetries - 1) {
			await sleep(2000 * (i + 1));
		}
	}
	return false;
}
