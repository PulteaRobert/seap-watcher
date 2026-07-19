import { describe, it, expect } from "vitest";
import {
	formatWhatsAppMessage,
	formatNoNewTendersMessage,
	formatErrorMessage,
} from "./message.js";
import type { SeapTender } from "../seap/types.js";

const makeTender = (overrides: Partial<SeapTender> = {}): SeapTender => ({
	sicapId: "DA123456",
	tier: "sub_threshold",
	title: "Test Tender",
	authorityName: "Test Authority",
	county: "Brasov",
	cpvCode: "99999999",
	publicationDate: "2026-07-19T10:00:00Z",
	state: "Publicat",
	url: "https://e-licitatie.ro/test",
	type: "Furnizare",
	...overrides,
});

describe("formatWhatsAppMessage", () => {
	it("includes header with Brasov and date", () => {
		const msg = formatWhatsAppMessage([makeTender()], "morning");
		expect(msg).toContain("SEAP Alert — Brasov");
		expect(msg).toContain("dimineața");
	});

	it("includes tender details (sicapId, title, authority, value, cpv, url)", () => {
		const tender = makeTender({
			sicapId: "DA999999",
			title: "Telefoane industriale",
			authorityName: "Consiliul Județean Brașov",
			valueRon: 16811.2,
			cpvCode: "32552100-8",
			cpvLabel: "Receptoare",
			url: "https://e-licitatie.ro/pub/notices/123",
		});
		const msg = formatWhatsAppMessage([tender], "morning");

		expect(msg).toContain("[DA999999]");
		expect(msg).toContain("Telefoane industriale");
		expect(msg).toContain("Consiliul Județean Brașov");
		expect(msg).toContain("16.811,20 RON");
		expect(msg).toContain("32552100-8");
		expect(msg).toContain("Receptoare");
		expect(msg).toContain("https://e-licitatie.ro/pub/notices/123");
	});

	it('shows "n/a" when value is missing', () => {
		const msg = formatWhatsAppMessage(
			[makeTender({ valueRon: undefined })],
			"morning",
		);
		expect(msg).toContain("n/a");
	});

	it("includes deadline when present", () => {
		const tender = makeTender({ deadline: "2026-07-25T14:00:00Z" });
		const msg = formatWhatsAppMessage([tender], "afternoon");
		expect(msg).toContain("Termen:");
		expect(msg).toContain("2026-07-25");
	});

	it("truncates at 20 tenders with indicator", () => {
		const many = Array.from({ length: 25 }, (_, i) =>
			makeTender({ sicapId: `DA${String(i).padStart(6, "0")}` }),
		);
		const msg = formatWhatsAppMessage(many, "morning");

		// Should contain truncation indicator
		expect(msg).toContain("afisate 20");
		expect(msg).toContain("Total: 25 licitații");
	});

	it("does not truncate for <= 20 tenders", () => {
		const tenders = Array.from({ length: 5 }, (_, i) =>
			makeTender({ sicapId: `DA${String(i).padStart(6, "0")}` }),
		);
		const msg = formatWhatsAppMessage(tenders, "afternoon");

		expect(msg).not.toContain("afisate");
		expect(msg).toContain("Total: 5 licitații");
	});

	it('uses "seara" for afternoon slot', () => {
		const msg = formatWhatsAppMessage([makeTender()], "afternoon");
		expect(msg).toContain("seara");
	});

	it("handles empty tender list", () => {
		const msg = formatWhatsAppMessage([], "morning");
		expect(msg).toContain("Total: 0 licitații noi");
	});

	it("flags near-threshold tenders with a warning marker", () => {
		const tender = makeTender({ sicapId: "DA555555", nearThreshold: true });
		const msg = formatWhatsAppMessage([tender], "morning");

		expect(msg).toContain("⚠️");
		expect(msg).toContain("Aproape de pragul de achiziție directă");
	});

	it("does not show the near-threshold warning for regular tenders", () => {
		const tender = makeTender({ sicapId: "DA555555", nearThreshold: false });
		const msg = formatWhatsAppMessage([tender], "morning");

		expect(msg).not.toContain("Aproape de pragul");
	});
});

describe("formatNoNewTendersMessage", () => {
	it("contains Brasov and slot info", () => {
		const msg = formatNoNewTendersMessage("morning");
		expect(msg).toContain("Brasov");
		expect(msg).toContain("dimineața");
		expect(msg).toContain("Nicio licitație nouă");
	});
});

describe("formatErrorMessage", () => {
	it("includes error details", () => {
		const msg = formatErrorMessage("morning", "SEAP HTTP 500");
		expect(msg).toContain("Eroare SEAP Watcher");
		expect(msg).toContain("SEAP HTTP 500");
	});
});
