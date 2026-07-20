/**
 * WhatsApp client interface used by the scheduler.
 *
 * The concrete Baileys implementation is provided in Phase 4.
 * This interface allows the scheduler to compile and be tested
 * independently of the WhatsApp dependency.
 */

import type { Logger } from "pino";

export interface WhatsAppClient {
	/** Connect (or reconnect) to WhatsApp Web. */
	connect(): Promise<void>;

	/** Send a text message to the configured recipient. */
	sendMessage(text: string): Promise<boolean>;

	/** Check if the client is currently connected. */
	isConnected(): boolean;

	/** Close the connection gracefully. */
	close(): Promise<void>;
}

/**
 * Factory type for creating a WhatsApp client.
 * Phase 4 replaces this with the real Baileys factory.
 */
export type WhatsAppFactory = (
	toPhones: string[],
	logger: Logger,
) => Promise<WhatsAppClient>;
