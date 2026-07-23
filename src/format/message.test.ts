import { describe, it, expect } from "vitest";
import {
	formatWhatsAppMessages,
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

describe("formatWhatsAppMessages", () => {
	it("includes header with Brasov and date", () => {
		const [msg] = formatWhatsAppMessages([makeTender()], "morning");
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
		const [msg] = formatWhatsAppMessages([tender], "morning");

		expect(msg).toContain("[DA999999]");
		expect(msg).toContain("Telefoane industriale");
		expect(msg).toContain("Consiliul Județean Brașov");
		expect(msg).toContain("16.811,20 RON");
		expect(msg).toContain("32552100-8");
		expect(msg).toContain("Receptoare");
		expect(msg).toContain("https://e-licitatie.ro/pub/notices/123");
	});

	it('shows "n/a" when value is missing', () => {
		const [msg] = formatWhatsAppMessages(
			[makeTender({ valueRon: undefined })],
			"morning",
		);
		expect(msg).toContain("n/a");
	});

	it("includes deadline when present", () => {
		const tender = makeTender({ deadline: "2026-07-25T14:00:00Z" });
		const [msg] = formatWhatsAppMessages([tender], "afternoon");
		expect(msg).toContain("Termen:");
		expect(msg).toContain("2026-07-25");
	});

	it("splits into multiple messages when over 10 tenders, without dropping any", () => {
		const many = Array.from({ length: 25 }, (_, i) =>
			makeTender({ sicapId: `DA${String(i).padStart(6, "0")}` }),
		);
		const messages = formatWhatsAppMessages(many, "morning");

		// 25 tenders / 10 per message = 3 parts (10 + 10 + 5)
		expect(messages).toHaveLength(3);
		expect(messages[0]).toContain("partea 1/3");
		expect(messages[2]).toContain("partea 3/3");

		// Every tender's sicapId shows up exactly once across all parts
		for (const t of many) {
			const occurrences = messages.filter((m) => m.includes(`[${t.sicapId}]`));
			expect(occurrences).toHaveLength(1);
		}

		// Each part still reports the grand total, not just its own chunk size
		for (const m of messages) {
			expect(m).toContain("Total: 25 licitații");
		}
	});

	it("does not split or label parts for <= 10 tenders", () => {
		const tenders = Array.from({ length: 5 }, (_, i) =>
			makeTender({ sicapId: `DA${String(i).padStart(6, "0")}` }),
		);
		const messages = formatWhatsAppMessages(tenders, "afternoon");

		expect(messages).toHaveLength(1);
		expect(messages[0]).not.toContain("partea");
		expect(messages[0]).toContain("Total: 5 licitații");
	});

	it('uses "seara" for afternoon slot', () => {
		const [msg] = formatWhatsAppMessages([makeTender()], "afternoon");
		expect(msg).toContain("seara");
	});

	it("handles empty tender list", () => {
		const [msg] = formatWhatsAppMessages([], "morning");
		expect(msg).toContain("Total: 0 licitații noi");
	});

	it("flags near-threshold tenders with a warning marker", () => {
		const tender = makeTender({ sicapId: "DA555555", nearThreshold: true });
		const [msg] = formatWhatsAppMessages([tender], "morning");

		expect(msg).toContain("⚠️");
		expect(msg).toContain("Aproape de pragul de achiziție directă");
	});

	it("does not show the near-threshold warning for regular tenders", () => {
		const tender = makeTender({ sicapId: "DA555555", nearThreshold: false });
		const [msg] = formatWhatsAppMessages([tender], "morning");

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
