/**
 * Tests for SEAP API client.
 *
 * Uses mocked fetch to avoid real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SeapRawNotice } from "./types.js";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
let client: typeof import("./client.js");

function resetMock() {
	mockFetch.mockReset();
}

function mockJsonResponse(data: unknown, status = 200) {
	return {
		ok: status < 400,
		status,
		statusText: status < 400 ? "OK" : "Error",
		json: () => Promise.resolve(data),
	};
}

// Fixture: a typical SEAP notice response
const FIXTURE_NOTICE_RESPONSE = {
	total: 3,
	items: [
		{
			caNoticeId: 100239953,
			noticeId: 101347480,
			procedureId: 100323296,
			noticeNo: "SCN1175406",
			sysNoticeTypeId: 17,
			sysNoticeState: { id: 2, text: "Publicat" },
			sysProcedureState: { id: 2, text: "In desfasurare" },
			contractingAuthorityNameAndFN: "21666630 - Directia Fiscala Brasov",
			contractTitle: "Servicii informatice pentru administratia publica",
			sysAcquisitionContractType: { id: 2, text: "Servicii" },
			sysProcedureType: { id: 20, text: "Procedura simplificata" },
			sysContractAssigmentType: {
				id: 1,
				text: "Contract de achizitii publice",
			},
			cpvCodeAndName: "72910000-2 - Servicii de siguranta informatica (Rev.2)",
			estimatedValueRon: 220254.3,
			isOnline: true,
			hasLots: true,
			noticeStateDate: "2026-05-19T08:14:27+03:00",
			minTenderReceiptDeadline: "2026-05-29T15:00:00+03:00",
			maxTenderReceiptDeadline: "2026-05-29T15:00:00+03:00",
			tenderReceiptDeadlineExport: "29.05.2026 15:00",
			estimatedValueExport: "220254,3 RON",
		},
		{
			caNoticeId: 100206019,
			noticeId: 101323448,
			procedureId: 100319361,
			noticeNo: "CN1090827",
			sysNoticeTypeId: 2,
			sysNoticeState: { id: 2, text: "Publicat" },
			sysProcedureState: { id: 2, text: "In desfasurare" },
			contractingAuthorityNameAndFN: "13624359 - UM 0929 Bucuresti",
			contractTitle: "Furnizare sistem integrat de securitate",
			sysAcquisitionContractType: { id: 1, text: "Furnizare" },
			sysProcedureType: { id: 1, text: "Licitatie deschisa" },
			sysContractAssigmentType: {
				id: 1,
				text: "Contract de achizitii publice",
			},
			cpvCodeAndName:
				"48000000-8 - Pachete software si sisteme informatice (Rev.2)",
			estimatedValueRon: 98347107.44,
			isOnline: true,
			hasLots: false,
			noticeStateDate: "2026-03-18T13:01:02+02:00",
			minTenderReceiptDeadline: "2026-04-24T15:00:00+03:00",
			tenderReceiptDeadlineExport: "24.04.2026 15:00",
			estimatedValueExport: "98347107,44 RON",
		},
		{
			caNoticeId: 100205890,
			noticeId: 101321902,
			procedureId: 100319152,
			noticeNo: "CN1090700",
			sysNoticeTypeId: 2,
			sysNoticeState: { id: 2, text: "Publicat" },
			sysProcedureState: { id: 2, text: "In desfasurare" },
			contractingAuthorityNameAndFN: "4288306 - Consiliul Județean Brașov",
			contractTitle: "Echipamente laborator calculatoare",
			sysAcquisitionContractType: { id: 1, text: "Furnizare" },
			sysProcedureType: { id: 1, text: "Licitatie deschisa" },
			sysContractAssigmentType: {
				id: 1,
				text: "Contract de achizitii publice",
			},
			cpvCodeAndName: "42997300-4 - Roboti industriali (Rev.2)",
			estimatedValueRon: 375039.49,
			isOnline: true,
			hasLots: true,
			noticeStateDate: "2026-03-16T13:01:14+02:00",
			minTenderReceiptDeadline: "2026-04-20T15:00:00+03:00",
			tenderReceiptDeadlineExport: "20.04.2026 15:00",
			estimatedValueExport: "375039,49 RON",
		},
	],
	searchTooLong: false,
};

async function reloadClient() {
	// Clear module cache and re-import
	vi.resetModules();
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	client = await import("./client.js");
}

describe("SEAP client", () => {
	beforeEach(async () => {
		resetMock();
		await reloadClient();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("mapTender", () => {
		it("maps a raw notice to a SeapTender", () => {
			const raw = FIXTURE_NOTICE_RESPONSE.items[0] as SeapRawNotice;
			const tender = client.mapTender(raw, "above_threshold");

			expect(tender.sicapId).toBe("SCN1175406");
			expect(tender.tier).toBe("above_threshold");
			expect(tender.title).toBe(
				"Servicii informatice pentru administratia publica",
			);
			expect(tender.authorityName).toBe("Directia Fiscala Brasov");
			expect(tender.authorityCui).toBe("21666630");
			expect(tender.cpvCode).toBe("72910000-2");
			expect(tender.cpvLabel).toBe("Servicii de siguranta informatica (Rev.2)");
			expect(tender.valueRon).toBe(220254.3);
			expect(tender.state).toBe("Publicat");
			expect(tender.url).toContain("100239953");
			expect(tender.type).toBe("Servicii");
		});

		it("handles missing optional fields gracefully", () => {
			const raw: SeapRawNotice = {
				caNoticeId: 0,
				noticeId: 0,
				procedureId: 0,
				noticeNo: "TEST001",
				sysNoticeTypeId: 1,
				sysNoticeState: { id: 1, text: "Publicat" },
				sysProcedureState: { id: 1, text: "In desfasurare" },
				contractingAuthorityNameAndFN: "Test Authority",
				contractTitle: "Test Tender",
				sysAcquisitionContractType: { id: 1, text: "Furnizare" },
				sysProcedureType: { id: 1, text: "Licitatie deschisa" },
				sysContractAssigmentType: { id: 1, text: "Contract" },
				cpvCodeAndName: "12345678-9 - Test CPV",
				estimatedValueRon: 0,
				isOnline: false,
				hasLots: false,
				noticeStateDate: "2026-01-01T00:00:00+00:00",
			};

			const tender = client.mapTender(raw, "sub_threshold");
			expect(tender.sicapId).toBe("TEST001");
			expect(tender.authorityCui).toBeUndefined();
			expect(tender.deadline).toBeUndefined();
		});
	});

	describe("mapDirectAcquisition", () => {
		it("maps a raw direct-acquisition record to a SeapTender", () => {
			const raw = {
				directAcquisitionId: 103063481,
				directAcquisitionName: "Anvelopa 185/65R15 88T vara Matador MP47",
				sysDirectAcquisitionState: { id: 7, text: "Oferta acceptata" },
				uniqueIdentificationCode: "DA22780457",
				cpvCode: "34351100-3 - Pneuri pentru autovehicule (Rev.2)",
				publicationDate: "2026-07-16T14:17:43+03:00",
				finalizationDate: "2026-07-17T14:33:57+03:00",
				supplierDecisionDeadline: "2026-07-20T17:00:00+03:00",
				supplier: "RO 6865630 DELTA PLUS TRADING S.R.L.",
				contractingAuthority: "4317975 Unitatea Militara 01714",
				estimatedValueRon: 1132.16,
			};

			const tender = client.mapDirectAcquisition(raw);

			expect(tender.sicapId).toBe("DA22780457");
			expect(tender.tier).toBe("sub_threshold");
			expect(tender.title).toBe("Anvelopa 185/65R15 88T vara Matador MP47");
			expect(tender.authorityName).toBe("4317975 Unitatea Militara 01714");
			expect(tender.cpvCode).toBe("34351100-3");
			expect(tender.cpvLabel).toBe("Pneuri pentru autovehicule (Rev.2)");
			expect(tender.valueRon).toBe(1132.16);
			expect(tender.state).toBe("Oferta acceptata");
			expect(tender.url).toContain("103063481");
			expect(tender.deadline).toBe("2026-07-20T17:00:00+03:00");
		});
	});

	describe("isBrasovTender", () => {
		it("identifies Brasov tenders by authority name", () => {
			const brasovTender = {
				sicapId: "TEST",
				tier: "above_threshold" as const,
				title: "",
				authorityName: "Consiliul Județean Brașov",
				county: "",
				cpvCode: "",
				publicationDate: "",
				state: "",
				url: "",
				type: "",
			};

			expect(client.isBrasovTender(brasovTender)).toBe(true);
		});

		it("identifies Brasov tenders by keyword in title", () => {
			const brasovTender = {
				sicapId: "TEST",
				tier: "above_threshold" as const,
				title: "Proiect in municipiul Brasov",
				authorityName: "Some Authority",
				county: "",
				cpvCode: "",
				publicationDate: "",
				state: "",
				url: "",
				type: "",
			};

			expect(client.isBrasovTender(brasovTender)).toBe(true);
		});

		it("rejects non-Brasov tenders", () => {
			const clujTender = {
				sicapId: "TEST",
				tier: "above_threshold" as const,
				title: "Proiect in Cluj",
				authorityName: "Consiliul Județean Cluj",
				county: "",
				cpvCode: "",
				publicationDate: "",
				state: "",
				url: "",
				type: "",
			};

			expect(client.isBrasovTender(clujTender)).toBe(false);
		});
	});

	describe("searchAboveThresholdTenders", () => {
		it("returns tenders from the SEAP API", async () => {
			mockFetch.mockResolvedValueOnce(
				mockJsonResponse(FIXTURE_NOTICE_RESPONSE),
			);

			const result = await client.searchAboveThresholdTenders(100);

			expect(result.items).toHaveLength(3);
			expect(result.total).toBe(3);
			expect(result.searchTooLong).toBe(false);
			expect(mockFetch).toHaveBeenCalledWith(
				"https://e-licitatie.ro/api-pub/NoticeCommon/GetCANoticeList/",
				expect.objectContaining({
					method: "POST",
				}),
			);
		});

		it("sends the date range as startPublicationDate/endPublicationDate", async () => {
			mockFetch.mockResolvedValueOnce(
				mockJsonResponse(FIXTURE_NOTICE_RESPONSE),
			);

			await client.searchAboveThresholdTenders(
				100,
				"2026-03-20T00:00:00Z",
				"2026-05-20T00:00:00Z",
			);

			const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
			const body = JSON.parse(options.body as string);
			expect(body.startPublicationDate).toBe("2026-03-20T00:00:00Z");
			expect(body.endPublicationDate).toBe("2026-05-20T00:00:00Z");
		});

		it("handles empty responses", async () => {
			mockFetch.mockResolvedValueOnce(
				mockJsonResponse({ total: 0, items: [], searchTooLong: false }),
			);

			const result = await client.searchAboveThresholdTenders(100);

			expect(result.items).toHaveLength(0);
			expect(result.total).toBe(0);
		});

		it("retries on failure", async () => {
			mockFetch
				.mockResolvedValueOnce(mockJsonResponse(null, 500))
				.mockResolvedValueOnce(mockJsonResponse(FIXTURE_NOTICE_RESPONSE));

			const result = await client.searchAboveThresholdTenders(100);

			expect(result.items).toHaveLength(3);
			expect(mockFetch).toHaveBeenCalledTimes(2); // initial + 1 retry
		});
	});

	describe("searchSubThresholdTenders", () => {
		const FIXTURE_DA_RESPONSE = {
			total: 1,
			items: [
				{
					directAcquisitionId: 103063481,
					directAcquisitionName: "Anvelopa 185/65R15 88T vara Matador MP47",
					sysDirectAcquisitionState: { id: 7, text: "Oferta acceptata" },
					uniqueIdentificationCode: "DA22780457",
					cpvCode: "34351100-3 - Pneuri pentru autovehicule (Rev.2)",
					publicationDate: "2026-07-16T14:17:43+03:00",
					contractingAuthority: "4317975 Unitatea Militara 01714",
					estimatedValueRon: 1132.16,
				},
			],
			searchTooLong: false,
		};

		it("calls the GetDirectAcquisitionList endpoint", async () => {
			mockFetch.mockResolvedValueOnce(mockJsonResponse(FIXTURE_DA_RESPONSE));

			const result = await client.searchSubThresholdTenders(100);

			expect(result.items).toHaveLength(1);
			expect(mockFetch).toHaveBeenCalledWith(
				"https://e-licitatie.ro/api-pub/DirectAcquisitionCommon/GetDirectAcquisitionList/",
				expect.objectContaining({ method: "POST" }),
			);
		});

		it("sends the date range as finalizationDateStart/End, not publicationDate", async () => {
			mockFetch.mockResolvedValueOnce(mockJsonResponse(FIXTURE_DA_RESPONSE));

			await client.searchSubThresholdTenders(
				100,
				"2026-07-17T00:00:00Z",
				"2026-07-19T00:00:00Z",
			);

			const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
			const body = JSON.parse(options.body as string);
			expect(body.finalizationDateStart).toBe("2026-07-17T00:00:00Z");
			expect(body.finalizationDateEnd).toBe("2026-07-19T00:00:00Z");
			expect(body.publicationDateStart).toBeNull();
			expect(body.publicationDateEnd).toBeNull();
		});

		it("handles empty responses", async () => {
			mockFetch.mockResolvedValueOnce(
				mockJsonResponse({ total: 0, items: [], searchTooLong: false }),
			);

			const result = await client.searchSubThresholdTenders(100);

			expect(result.items).toHaveLength(0);
			expect(result.total).toBe(0);
		});
	});

	describe("searchCpvs", () => {
		it("returns CPV options from autocomplete", async () => {
			const cpvResponse = {
				total: 2,
				items: [
					{ id: 17197, text: "48219000-6 Software pentru retele (Rev.2)" },
					{ id: 17334, text: "48900000-7 Pachete software (Rev.2)" },
				],
				searchTooLong: false,
			};

			mockFetch.mockResolvedValueOnce(mockJsonResponse(cpvResponse));

			const result = await client.searchCpvs("software", 10);

			expect(result).toHaveLength(2);
			expect(result[0]).toMatchObject({
				cpvId: 17197,
				code: "48219000-6",
				name: "Software pentru retele (Rev.2)",
			});
		});

		it("returns empty array when no CPV matches", async () => {
			mockFetch.mockResolvedValueOnce(
				mockJsonResponse({
					total: 0,
					items: [],
					searchTooLong: false,
				}),
			);

			const result = await client.searchCpvs("nonexistent-cpv", 10);
			expect(result).toHaveLength(0);
		});
	});

	describe("confirmCaNoticeCounty", () => {
		it("returns true when the entity's county matches (diacritic/case-insensitive)", async () => {
			mockFetch
				.mockResolvedValueOnce(mockJsonResponse({ entityId: 6284 }))
				.mockResolvedValueOnce(mockJsonResponse({ county: "Brașov" }));

			const result = await client.confirmCaNoticeCounty(100643523, "Brasov");
			expect(result).toBe(true);
		});

		it("returns false when the entity's county doesn't match", async () => {
			mockFetch
				.mockResolvedValueOnce(mockJsonResponse({ entityId: 6284 }))
				.mockResolvedValueOnce(mockJsonResponse({ county: "Braila" }));

			const result = await client.confirmCaNoticeCounty(100643523, "Brasov");
			expect(result).toBe(false);
		});

		it("returns null (fail open) when the notice detail lookup fails", async () => {
			mockFetch.mockRejectedValue(new Error("network error"));

			const result = await client.confirmCaNoticeCounty(100643523, "Brasov");
			expect(result).toBeNull();
		}, 15000); // exhausts fetchWithRetry's real backoff (~7s)

		it("returns null (fail open) when entityId is missing", async () => {
			mockFetch.mockResolvedValueOnce(mockJsonResponse({ entityId: null }));

			const result = await client.confirmCaNoticeCounty(100643523, "Brasov");
			expect(result).toBeNull();
		});
	});

	describe("confirmDaCounty", () => {
		it("returns true when the authority's county matches", async () => {
			mockFetch
				.mockResolvedValueOnce(
					mockJsonResponse({ contractingAuthorityID: 9193 }),
				)
				.mockResolvedValueOnce(mockJsonResponse({ county: "Brasov" }));

			const result = await client.confirmDaCounty(103063481, "Brasov");
			expect(result).toBe(true);
		});

		it("returns false when the authority's county doesn't match", async () => {
			mockFetch
				.mockResolvedValueOnce(
					mockJsonResponse({ contractingAuthorityID: 9193 }),
				)
				.mockResolvedValueOnce(mockJsonResponse({ county: "Arges" }));

			const result = await client.confirmDaCounty(103063481, "Brasov");
			expect(result).toBe(false);
		});

		it("returns null (fail open) when the DA detail lookup fails", async () => {
			mockFetch.mockRejectedValue(new Error("network error"));

			const result = await client.confirmDaCounty(103063481, "Brasov");
			expect(result).toBeNull();
		}, 15000); // exhausts fetchWithRetry's real backoff (~7s)
	});
});
