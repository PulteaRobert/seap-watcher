/**
 * Tests for fetch orchestration (fetch.ts).
 *
 * Mocks the SEAP client and DB operations to test the orchestration logic
 * without real network or database calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "better-sqlite3";
import type { Config } from "../config.js";
import type { Logger } from "pino";
import type { SeapTender } from "./types.js";

// --- Mocks ---

const mockSearchAboveThreshold = vi.fn();
const mockSearchSubThreshold = vi.fn();
const mockMapTender = vi.fn();
const mockMapDirectAcquisition = vi.fn();
const mockIsBrasovTender = vi.fn();
const mockMatchesTrustedBrasovKeyword = vi.fn();
const mockConfirmCaNoticeCounty = vi.fn();
const mockConfirmDaCounty = vi.fn();
const mockCheckNearThreshold = vi.fn();
const mockUpsertTenders = vi.fn();
const mockGetNewTenders = vi.fn();
const mockLogRun = vi.fn();

vi.mock("./client.js", () => ({
	searchAboveThresholdTenders: (...args: unknown[]) =>
		mockSearchAboveThreshold(...args),
	searchSubThresholdTenders: (...args: unknown[]) =>
		mockSearchSubThreshold(...args),
	mapTender: (...args: unknown[]) => mockMapTender(...args),
	mapDirectAcquisition: (...args: unknown[]) =>
		mockMapDirectAcquisition(...args),
	isBrasovTender: (...args: unknown[]) => mockIsBrasovTender(...args),
	matchesTrustedBrasovKeyword: (...args: unknown[]) =>
		mockMatchesTrustedBrasovKeyword(...args),
	confirmCaNoticeCounty: (...args: unknown[]) =>
		mockConfirmCaNoticeCounty(...args),
	confirmDaCounty: (...args: unknown[]) => mockConfirmDaCounty(...args),
	checkNearThreshold: (...args: unknown[]) => mockCheckNearThreshold(...args),
}));

vi.mock("../db/operations.js", () => ({
	upsertTenders: (...args: unknown[]) => mockUpsertTenders(...args),
	getNewTenders: (...args: unknown[]) => mockGetNewTenders(...args),
	logRun: (...args: unknown[]) => mockLogRun(...args),
}));

// Import AFTER mocks are set up
import { fetchBrasovTenders } from "./fetch.js";

// --- Fixtures ---

const mockConfig: Config = {
	whatsappToPhones: ["40712345678"],
	seapCounty: "Brasov",
	cronMorning: "0 7 * * 1-5",
	cronAfternoon: "0 13 * * 1-5",
	dbPath: ":memory:",
	logLevel: "info",
	maxTendersPerRun: 200,
};

const mockDb = {} as unknown as Database;

const mockInfo = vi.fn();
const mockError = vi.fn();

const mockLogger: Logger = {
	info: mockInfo,
	error: mockError,
	warn: vi.fn(),
	debug: vi.fn(),
	trace: vi.fn(),
	fatal: vi.fn(),
	silent: vi.fn(),
	child: () => mockLogger,
	level: "info",
	isLevelEnabled: () => true,
	setLevel: vi.fn(),
	bindings: () => ({}),
	flush: vi.fn(),
	on: vi.fn(),
	off: vi.fn(),
} as any;

const fixtureRawNotice = {
	caNoticeId: 100239953,
	noticeId: 101347480,
	procedureId: 100323296,
	noticeNo: "SCN1175406",
	sysNoticeTypeId: 17,
	sysNoticeState: { id: 2, text: "Publicat" },
	sysProcedureState: { id: 2, text: "In desfasurare" },
	contractingAuthorityNameAndFN: "21666630 - Directia Fiscala Brasov",
	contractTitle: "Servicii informatice",
	sysAcquisitionContractType: { id: 2, text: "Servicii" },
	sysProcedureType: { id: 20, text: "Procedura simplificata" },
	sysContractAssigmentType: { id: 1, text: "Contract" },
	cpvCodeAndName: "72910000-2 - Servicii IT",
	estimatedValueRon: 220254.3,
	isOnline: true,
	hasLots: false,
	noticeStateDate: "2026-05-19T08:14:27+03:00",
	minTenderReceiptDeadline: "2026-05-29T15:00:00+03:00",
};

const fixtureMappedTender: SeapTender = {
	sicapId: "SCN1175406",
	tier: "above_threshold",
	title: "Servicii informatice",
	authorityName: "Directia Fiscala Brasov",
	authorityCui: "21666630",
	county: "Brasov",
	cpvCode: "72910000-2",
	cpvLabel: "Servicii IT",
	valueRon: 220254.3,
	publicationDate: "2026-05-19T08:14:27+03:00",
	state: "Publicat",
	url: "https://e-licitatie.ro/pub/notices/c-notice/v2/view/100239953",
	deadline: "2026-05-29T15:00:00+03:00",
	type: "Servicii",
};

function resetMocks() {
	mockSearchAboveThreshold.mockReset();
	mockSearchSubThreshold.mockReset();
	mockMapTender.mockReset();
	mockMapDirectAcquisition.mockReset();
	mockIsBrasovTender.mockReset();
	mockMatchesTrustedBrasovKeyword.mockReset();
	mockConfirmCaNoticeCounty.mockReset();
	mockConfirmDaCounty.mockReset();
	mockCheckNearThreshold.mockReset();
	mockUpsertTenders.mockReset();
	mockGetNewTenders.mockReset();
	mockLogRun.mockReset();
	mockInfo.mockReset();
	mockError.mockReset();
}

// --- Tests ---

describe("fetchBrasovTenders", () => {
	beforeEach(() => {
		resetMocks();
	});

	it("fetches, filters, upserts, and returns new tenders (happy path)", async () => {
		// Above-threshold: 1 Brasov tender, 1 non-Brasov tender
		mockSearchAboveThreshold.mockResolvedValueOnce({
			items: [
				fixtureRawNotice,
				{ ...fixtureRawNotice, noticeNo: "NON_BRASOV_1" },
			],
			total: 2,
			searchTooLong: false,
		});

		// Sub-threshold: empty
		mockSearchSubThreshold.mockResolvedValueOnce({
			items: [],
			total: 0,
			searchTooLong: false,
		});

		// mapTender returns our fixture
		mockMapTender.mockReturnValue(fixtureMappedTender);

		// First is Brasov, second is not
		mockIsBrasovTender.mockReturnValueOnce(true).mockReturnValueOnce(false);

		// getNewTenders returns the upserted tender
		mockGetNewTenders.mockReturnValueOnce([fixtureMappedTender]);

		const result = await fetchBrasovTenders(mockConfig, mockDb, mockLogger);

		// Verify API calls
		expect(mockSearchAboveThreshold).toHaveBeenCalledWith(
			200,
			expect.stringContaining("T"),
		);
		expect(mockSearchSubThreshold).toHaveBeenCalledWith(
			200,
			expect.stringContaining("T"),
		);

		// mapTender called twice (one per raw notice)
		expect(mockMapTender).toHaveBeenCalledTimes(2);

		// isBrasovTender called twice
		expect(mockIsBrasovTender).toHaveBeenCalledTimes(2);

		// upsert called with 1 Brasov tender
		expect(mockUpsertTenders).toHaveBeenCalledWith(mockDb, [
			fixtureMappedTender,
		]);

		// Returns new tenders
		expect(result).toHaveLength(1);
		expect(result[0].sicapId).toBe("SCN1175406");

		// Run log written
		expect(mockLogRun).toHaveBeenCalledWith(
			mockDb,
			expect.objectContaining({
				cronSlot: "morning",
				totalFetched: 1,
				newTenders: 1,
				status: "completed",
			}),
		);
	});

	it("returns tenders from both above and sub threshold sources", async () => {
		const subThresholdTender = {
			...fixtureMappedTender,
			sicapId: "DA001",
			tier: "sub_threshold" as const,
		};

		mockSearchAboveThreshold.mockResolvedValueOnce({
			items: [fixtureRawNotice],
			total: 1,
			searchTooLong: false,
		});

		mockSearchSubThreshold.mockResolvedValueOnce({
			items: [{ uniqueIdentificationCode: "DA001" }],
			total: 1,
			searchTooLong: false,
		});

		mockMapTender.mockReturnValueOnce(fixtureMappedTender); // above-threshold
		mockMapDirectAcquisition.mockReturnValueOnce(subThresholdTender); // sub-threshold

		mockIsBrasovTender.mockReturnValue(true); // Both are Brasov
		mockGetNewTenders.mockReturnValueOnce([
			fixtureMappedTender,
			subThresholdTender,
		]);

		const result = await fetchBrasovTenders(mockConfig, mockDb, mockLogger);

		expect(result).toHaveLength(2);
		expect(mockUpsertTenders).toHaveBeenCalledWith(mockDb, [
			fixtureMappedTender,
			subThresholdTender,
		]);
	});

	it("logs run as failed when SEAP API throws", async () => {
		const apiError = new Error("Network timeout");
		mockSearchAboveThreshold.mockRejectedValueOnce(apiError);

		await expect(
			fetchBrasovTenders(mockConfig, mockDb, mockLogger),
		).rejects.toThrow("Network timeout");

		// Run log still written with failed status
		expect(mockLogRun).toHaveBeenCalledWith(
			mockDb,
			expect.objectContaining({
				status: "failed",
				errorMessage: "Network timeout",
				totalFetched: 0,
				newTenders: 0,
			}),
		);

		// Error logged
		expect(mockLogger.error).toHaveBeenCalled();
	});

	it("handles empty results gracefully", async () => {
		mockSearchAboveThreshold.mockResolvedValueOnce({
			items: [],
			total: 0,
			searchTooLong: false,
		});

		mockSearchSubThreshold.mockResolvedValueOnce({
			items: [],
			total: 0,
			searchTooLong: false,
		});

		mockGetNewTenders.mockReturnValueOnce([]);

		const result = await fetchBrasovTenders(mockConfig, mockDb, mockLogger);

		expect(result).toHaveLength(0);
		expect(mockUpsertTenders).not.toHaveBeenCalled();

		// Run log still written
		expect(mockLogRun).toHaveBeenCalledWith(
			mockDb,
			expect.objectContaining({
				totalFetched: 0,
				newTenders: 0,
				status: "completed",
			}),
		);
	});

	it("respects the slot parameter for logging", async () => {
		mockSearchAboveThreshold.mockResolvedValueOnce({
			items: [],
			total: 0,
			searchTooLong: false,
		});
		mockSearchSubThreshold.mockResolvedValueOnce({
			items: [],
			total: 0,
			searchTooLong: false,
		});
		mockGetNewTenders.mockReturnValueOnce([]);

		await fetchBrasovTenders(mockConfig, mockDb, mockLogger, "afternoon");

		expect(mockLogRun).toHaveBeenCalledWith(
			mockDb,
			expect.objectContaining({
				cronSlot: "afternoon",
			}),
		);
	});

	it("sets county on filtered Brasov tenders", async () => {
		const tenderWithoutCounty = {
			...fixtureMappedTender,
			county: "", // mapTender sets county to empty string
		};

		mockSearchAboveThreshold.mockResolvedValueOnce({
			items: [fixtureRawNotice],
			total: 1,
			searchTooLong: false,
		});

		mockSearchSubThreshold.mockResolvedValueOnce({
			items: [],
			total: 0,
			searchTooLong: false,
		});
		mockMapTender.mockReturnValue(tenderWithoutCounty);
		mockIsBrasovTender.mockReturnValue(true);
		mockGetNewTenders.mockReturnValueOnce([tenderWithoutCounty]);

		await fetchBrasovTenders(mockConfig, mockDb, mockLogger);

		// The tender passed to upsert should have county set to config.seapCounty
		const upsertedTenders = (
			mockUpsertTenders.mock.calls[0] as unknown[]
		)[1] as SeapTender[];
		expect(upsertedTenders[0].county).toBe("Brasov");
	});

	it("filters out non-Brasov tenders", async () => {
		mockSearchAboveThreshold.mockResolvedValueOnce({
			items: [
				{ ...fixtureRawNotice, noticeNo: "BRASOV_1" },
				{ ...fixtureRawNotice, noticeNo: "CLUJ_1" },
				{ ...fixtureRawNotice, noticeNo: "BRASOV_2" },
			],
			total: 3,
			searchTooLong: false,
		});

		mockSearchSubThreshold.mockResolvedValueOnce({
			items: [],
			total: 0,
			searchTooLong: false,
		});
		mockMapTender.mockReturnValue(fixtureMappedTender);

		// Brasov, not Brasov, Brasov
		mockIsBrasovTender
			.mockReturnValueOnce(true)
			.mockReturnValueOnce(false)
			.mockReturnValueOnce(true);

		mockGetNewTenders.mockReturnValueOnce([]);

		await fetchBrasovTenders(mockConfig, mockDb, mockLogger);

		// Only 2 Brasov tenders upserted
		expect(mockUpsertTenders).toHaveBeenCalledWith(
			mockDb,
			expect.arrayContaining([
				expect.objectContaining({ sicapId: "SCN1175406" }),
				expect.objectContaining({ sicapId: "SCN1175406" }),
			]),
		);
		expect((mockUpsertTenders.mock.calls[0] as unknown[])[1]).toHaveLength(2);
	});

	it("drops a keyword match when county confirmation explicitly rejects it", async () => {
		mockSearchAboveThreshold.mockResolvedValueOnce({
			items: [fixtureRawNotice],
			total: 1,
			searchTooLong: false,
		});
		mockSearchSubThreshold.mockResolvedValueOnce({
			items: [],
			total: 0,
			searchTooLong: false,
		});
		mockMapTender.mockReturnValue(fixtureMappedTender);
		mockIsBrasovTender.mockReturnValue(true);
		// Keyword matched, but the authoritative lookup says it's NOT Brasov
		mockConfirmCaNoticeCounty.mockResolvedValueOnce(false);
		mockGetNewTenders.mockReturnValueOnce([]);

		await fetchBrasovTenders(mockConfig, mockDb, mockLogger);

		expect(mockUpsertTenders).not.toHaveBeenCalled();
	});

	it("keeps a keyword match when county confirmation can't resolve (fails open)", async () => {
		mockSearchAboveThreshold.mockResolvedValueOnce({
			items: [fixtureRawNotice],
			total: 1,
			searchTooLong: false,
		});
		mockSearchSubThreshold.mockResolvedValueOnce({
			items: [],
			total: 0,
			searchTooLong: false,
		});
		mockMapTender.mockReturnValue(fixtureMappedTender);
		mockIsBrasovTender.mockReturnValue(true);
		// Lookup failed (returns null) — should still keep the tender
		mockConfirmCaNoticeCounty.mockResolvedValueOnce(null);
		mockGetNewTenders.mockReturnValueOnce([fixtureMappedTender]);

		await fetchBrasovTenders(mockConfig, mockDb, mockLogger);

		expect(mockUpsertTenders).toHaveBeenCalledWith(mockDb, [
			fixtureMappedTender,
		]);
	});

	it("logs run even when logRun itself throws (no crash)", async () => {
		mockSearchAboveThreshold.mockResolvedValueOnce({
			items: [fixtureRawNotice],
			total: 1,
			searchTooLong: false,
		});
		mockSearchSubThreshold.mockResolvedValueOnce({
			items: [],
			total: 0,
			searchTooLong: false,
		});
		mockMapTender.mockReturnValue(fixtureMappedTender);
		mockIsBrasovTender.mockReturnValue(true);
		mockGetNewTenders.mockReturnValueOnce([]);

		// logRun throws — should not crash the fetch
		mockLogRun.mockImplementation(() => {
			throw new Error("DB write failed");
		});

		// Should not throw — logRun failure is caught in finally
		await expect(
			fetchBrasovTenders(mockConfig, mockDb, mockLogger),
		).resolves.toBeDefined();
	});
});
