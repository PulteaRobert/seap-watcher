/**
 * Tests for WhatsApp send-with-retry helper.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { WhatsAppClient } from "./types.js";
import { sendWithRetry } from "./send.js";

/* ------------------------------------------------------------------ */
/*  Test doubles                                                      */
/* ------------------------------------------------------------------ */

interface MockWhatsAppClient extends WhatsAppClient {
	callCount: number;
	shouldFail: number;
}

function createMockClient(): MockWhatsAppClient {
	// eslint-disable-next-line no-loop-func
	const state = { callCount: 0, shouldFail: 0 };

	return {
		get callCount() {
			return state.callCount;
		},
		get shouldFail() {
			return state.shouldFail;
		},
		set shouldFail(v: number) {
			state.shouldFail = v;
		},
		connect: vi.fn().mockResolvedValue(undefined),
		waitUntilConnected: vi.fn().mockResolvedValue(true),
		sendMessage: vi.fn().mockImplementation(async () => {
			state.callCount++;
			if (state.callCount <= state.shouldFail) return false;
			return true;
		}),
		isConnected: vi.fn().mockReturnValue(true),
		close: vi.fn().mockResolvedValue(undefined),
	} as MockWhatsAppClient;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("sendWithRetry", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns true on first attempt when client succeeds", async () => {
		const client = createMockClient();
		const result = await sendWithRetry(client, "Hello world");

		expect(result).toBe(true);
		expect(client.callCount).toBe(1);
	});

	// Retry tests involve real sleep() calls — allow enough time
	it("retries and eventually succeeds", async () => {
		const client = createMockClient();
		client.shouldFail = 2; // fail twice, then succeed

		const result = await sendWithRetry(client, "Hello world");

		expect(result).toBe(true);
		expect(client.callCount).toBe(3);
	}, 10_000);

	it("returns false after exhausting all retries", async () => {
		const client = createMockClient();
		client.shouldFail = 10; // always fail

		const result = await sendWithRetry(client, "Hello world");

		expect(result).toBe(false);
		expect(client.callCount).toBe(3); // default maxRetries = 3
	}, 10_000);

	it("respects custom maxRetries", async () => {
		const client = createMockClient();
		client.shouldFail = 5; // always fail

		const result = await sendWithRetry(client, "Hello world", 5);

		expect(result).toBe(false);
		expect(client.callCount).toBe(5);
	}, 25_000); // 5 retries: 2+4+6+8 = 20s of sleep

	it("waits between retries with exponential backoff", async () => {
		vi.useFakeTimers();

		const client = createMockClient();
		client.shouldFail = 2; // fail twice, succeed on 3rd

		const promise = sendWithRetry(client, "Hello world");

		// After first failure, wait 2s
		await vi.advanceTimersByTimeAsync(2000);
		// After second failure, wait 4s
		await vi.advanceTimersByTimeAsync(4000);

		const result = await promise;
		expect(result).toBe(true);
		expect(client.callCount).toBe(3);

		vi.useRealTimers();
	});
});
