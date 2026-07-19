import { describe, it, expect } from "vitest";
import { computeDiff, alertableTenders } from "./engine.js";
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

describe("computeDiff", () => {
	it("returns all tenders as new when stored is empty", () => {
		const current = [
			makeTender({ sicapId: "A" }),
			makeTender({ sicapId: "B" }),
		];
		const result = computeDiff(current, []);

		expect(result.new).toHaveLength(2);
		expect(result.modified).toHaveLength(0);
		expect(result.unchanged).toBe(0);
	});

	it("returns no new tenders when all already stored and unchanged", () => {
		const tender = makeTender({ sicapId: "A" });
		const result = computeDiff([tender], [tender]);

		expect(result.new).toHaveLength(0);
		expect(result.modified).toHaveLength(0);
		expect(result.unchanged).toBe(1);
	});

	it("detects modified tenders when significant fields change", () => {
		const original = makeTender({
			sicapId: "A",
			valueRon: 1000,
			state: "Publicat",
		});
		const modified = makeTender({
			sicapId: "A",
			valueRon: 2000,
			state: "In curs",
		});
		const result = computeDiff([modified], [original]);

		expect(result.new).toHaveLength(0);
		expect(result.modified).toHaveLength(1);
		expect(result.unchanged).toBe(0);
	});

	it("ignores non-significant field changes (title, authorityName)", () => {
		const original = makeTender({ sicapId: "A", title: "Original Title" });
		const updated = makeTender({ sicapId: "A", title: "Changed Title" });
		const result = computeDiff([updated], [original]);

		expect(result.new).toHaveLength(0);
		expect(result.modified).toHaveLength(0);
		expect(result.unchanged).toBe(1);
	});

	it("handles mixed new, modified, and unchanged", () => {
		const stored = [
			makeTender({ sicapId: "A", valueRon: 100 }),
			makeTender({ sicapId: "B" }),
			makeTender({ sicapId: "C" }),
		];
		const current = [
			makeTender({ sicapId: "A", valueRon: 200 }), // modified
			makeTender({ sicapId: "B" }), // unchanged
			makeTender({ sicapId: "D" }), // new
		];
		const result = computeDiff(current, stored);

		expect(result.new).toHaveLength(1);
		expect(result.new[0].sicapId).toBe("D");
		expect(result.modified).toHaveLength(1);
		expect(result.modified[0].sicapId).toBe("A");
		expect(result.unchanged).toBe(1);
	});

	it("handles empty current list", () => {
		const result = computeDiff([], [makeTender({ sicapId: "A" })]);

		expect(result.new).toHaveLength(0);
		expect(result.modified).toHaveLength(0);
		expect(result.unchanged).toBe(0);
	});
});

describe("alertableTenders", () => {
	it("returns new and modified tenders", () => {
		const stored = [
			makeTender({ sicapId: "A", valueRon: 100 }),
			makeTender({ sicapId: "B" }),
		];
		const current = [
			makeTender({ sicapId: "A", valueRon: 200 }), // modified
			makeTender({ sicapId: "B" }), // unchanged
			makeTender({ sicapId: "C" }), // new
		];
		const alertable = alertableTenders(current, stored);

		expect(alertable).toHaveLength(2);
		const ids = alertable.map((t) => t.sicapId);
		expect(ids).toContain("A");
		expect(ids).toContain("C");
	});

	it("returns empty when nothing changed", () => {
		const tenders = [
			makeTender({ sicapId: "A" }),
			makeTender({ sicapId: "B" }),
		];
		const alertable = alertableTenders(tenders, tenders);

		expect(alertable).toHaveLength(0);
	});
});
