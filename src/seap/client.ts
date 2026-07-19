/**
 * SEAP (e-licitatie.ro) API client.
 *
 * Uses the undocumented public API reverse-engineered from the live SEAP
 * frontend's own JS bundle (app-pub) and cross-checked against upbeside/sicap-parser.
 *
 * Note: `NoticeCommon/GetCNoticeList/` — despite the name similarity — ignores
 * sort/filter parameters entirely and always returns a fixed, frozen ~3000-item
 * snapshot from 2019 regardless of what's sent. The correct endpoint for a real,
 * currently-filtered search is `GetCANoticeList/`, which honours
 * startPublicationDate/endPublicationDate server-side.
 *
 * Endpoints:
 *   GET  /api-pub/ComboPub/searchCpvs                          — CPV autocomplete
 *   POST /api-pub/NoticeCommon/GetCANoticeList/                 — above-threshold tender search (CAN)
 *   POST /api-pub/DirectAcquisitionCommon/GetDirectAcquisitionList/ — sub-threshold tender search (DA)
 */

import type {
	SeapNoticeResponse,
	SeapRawNotice,
	SeapDaListResponse,
	SeapRawDirectAcquisition,
	SeapTender,
} from './types.js';

const BASE = 'https://e-licitatie.ro';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json;charset=UTF-8',
  Accept: 'application/json, text/plain, */*',
  'User-Agent': USER_AGENT,
  Origin: BASE,
  Referer: `${BASE}/pub/notices/contract-notices/list/0/0`,
  Culture: 'ro-RO',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Parse "CUI - Authority Name" → { cui, name }. */
function parseAuthority(raw: string): { cui: string | undefined; name: string } {
  const sep = raw.indexOf(' - ');
  if (sep === -1) return { cui: undefined, name: raw.trim() || '' };
  return {
    cui: raw.slice(0, sep).trim(),
    name: raw.slice(sep + 3).trim(),
  };
}

/** Parse "CODE - Label (Rev.N)" → { code, label }. */
function parseCpv(raw: string): { code: string; label: string } {
  const sep = raw.indexOf(' - ');
  if (sep === -1) return { code: raw.trim() || '', label: '' };
  return {
    code: raw.slice(0, sep).trim(),
    label: raw.slice(sep + 3).trim(),
  };
}

/** Map a raw SEAP notice to our normalised SeapTender. */
export function mapTender(raw: SeapRawNotice, tier: SeapTender['tier']): SeapTender {
  const authority = parseAuthority(raw.contractingAuthorityNameAndFN);
  const cpv = parseCpv(raw.cpvCodeAndName);

  return {
    sicapId: raw.noticeNo,
    tier,
    title: raw.contractTitle ?? '',
    authorityName: authority.name,
    authorityCui: authority.cui,
    county: '', // populated via client-side filter when county info is available
    cpvCode: cpv.code,
    cpvLabel: cpv.label || undefined,
    valueRon: raw.estimatedValueRon ?? undefined,
    publicationDate: raw.noticeStateDate,
    state: raw.sysNoticeState?.text ?? '',
    url: raw.cNoticeId
      ? `${BASE}/pub/notices/c-notice/v2/view/${raw.cNoticeId}`
      : `${BASE}/pub/notices/contract-notices/list/0/0`,
    deadline: raw.minTenderReceiptDeadline ?? undefined,
    type: raw.sysAcquisitionContractType?.text ?? '',
  };
}

/** Map a raw direct-acquisition (DA) record to our normalised SeapTender. */
export function mapDirectAcquisition(raw: SeapRawDirectAcquisition): SeapTender {
  const cpv = parseCpv(raw.cpvCode);

  return {
    sicapId: raw.uniqueIdentificationCode,
    tier: 'sub_threshold',
    title: raw.directAcquisitionName ?? '',
    authorityName: raw.contractingAuthority ?? '',
    authorityCui: undefined,
    county: '', // populated via client-side filter when county info is available
    cpvCode: cpv.code,
    cpvLabel: cpv.label || undefined,
    valueRon: raw.estimatedValueRon ?? undefined,
    publicationDate: raw.publicationDate,
    state: raw.sysDirectAcquisitionState?.text ?? '',
    url: `${BASE}/pub/direct-acquisition/view/${raw.directAcquisitionId}`,
    deadline: raw.supplierDecisionDeadline ?? undefined,
    type: 'Achizitie directa',
  };
}

/* ------------------------------------------------------------------ */
/*  HTTP helpers with retry                                            */
/* ------------------------------------------------------------------ */

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...options?.headers },
  });

  if (!res.ok) {
    throw new Error(`SEAP HTTP ${res.status} ${res.statusText} for ${url}`);
  }

  return res.json() as Promise<T>;
}

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        const delay = baseDelayMs * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

/* ------------------------------------------------------------------ */
/*  CPV autocomplete                                                   */
/* ------------------------------------------------------------------ */

export interface CpvOption {
  cpvId: number;
  code: string;
  name: string;
}

/** Search CPV codes by keyword via SEAP's autocomplete endpoint. */
export async function searchCpvs(keyword: string, limit = 10): Promise<CpvOption[]> {
  const params = new URLSearchParams({
    filter: keyword,
    pageIndex: '0',
    pageSize: String(limit),
    parentId: '',
  });
  const url = `${BASE}/api-pub/ComboPub/searchCpvs?${params.toString()}`;

  const response = await fetchWithRetry(() => fetchJson<Record<string, unknown>>(url));

  const items = (response as any).items ?? [];
  return items.map((item: any) => {
    const text = (item.text ?? '').trim();
    const space = text.indexOf(' ');
    const code = space === -1 ? text : text.slice(0, space);
    const name = space === -1 ? '' : text.slice(space + 1).trim();
    return { cpvId: item.id, code, name };
  });
}

/* ------------------------------------------------------------------ */
/*  Above-threshold tender search (CAN / licitatii publice)            */
/* ------------------------------------------------------------------ */

interface GetCANoticeListBody {
  sysNoticeTypeIds: number[];
  sortProperties: unknown[];
  pageSize: number;
  sysNoticeStateId: null;
  contractingAuthorityId: null;
  winnerId: null;
  cPVCategoryId: null;
  sysContractAssigmentTypeId: null;
  cPVId: null;
  assignedUserId: null;
  sysAcquisitionContractTypeId: null;
  pageIndex: number;
  startPublicationDate: string | null;
  endPublicationDate: string | null;
}

/**
 * Search above-threshold tenders via SEAP's GetCANoticeList endpoint.
 * Returns all pages up to `maxResults`. Unlike GetCNoticeList (which ignores
 * sort/filter params and always returns a frozen 2019 snapshot), this endpoint
 * honours startPublicationDate/endPublicationDate server-side.
 */
export async function searchAboveThresholdTenders(
  maxResults: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<SeapNoticeResponse> {
  const allItems: SeapRawNotice[] = [];
  let searchTooLong = false;
  let totalMatches = 0;
  const pageSize = 50;

  for (let page = 0; allItems.length < maxResults; page++) {
    const body: GetCANoticeListBody = {
      sysNoticeTypeIds: [],
      sortProperties: [],
      pageSize,
      sysNoticeStateId: null,
      contractingAuthorityId: null,
      winnerId: null,
      cPVCategoryId: null,
      sysContractAssigmentTypeId: null,
      cPVId: null,
      assignedUserId: null,
      sysAcquisitionContractTypeId: null,
      pageIndex: page,
      startPublicationDate: dateFrom ?? null,
      endPublicationDate: dateTo ?? null,
    };

    const response = await fetchWithRetry<SeapNoticeResponse>(() =>
      fetchJson<SeapNoticeResponse>(
        `${BASE}/api-pub/NoticeCommon/GetCANoticeList/`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      ),
    );

    const batch = response.items ?? [];
    if (batch.length === 0) break;

    searchTooLong = searchTooLong || response.searchTooLong;
    if (page === 0) totalMatches = response.total ?? batch.length;

    for (const raw of batch) {
      allItems.push(raw);
      if (allItems.length >= maxResults) break;
    }

    if (batch.length < pageSize) break;
  }

  return { items: allItems, searchTooLong, total: totalMatches };
}

/* ------------------------------------------------------------------ */
/*  Sub-threshold tender search (DA / achizitii directe)               */
/* ------------------------------------------------------------------ */

interface GetDirectAcquisitionListBody {
  pageSize: number;
  showOngoingDa: boolean;
  cookieContext: null;
  pageIndex: number;
  sysDirectAcquisitionStateId: null;
  publicationDateStart: null;
  publicationDateEnd: null;
  finalizationDateStart: string | null;
  finalizationDateEnd: string | null;
  cpvCategoryId: null;
  contractingAuthorityId: null;
  supplierId: null;
  cpvCodeId: null;
}

/**
 * Search sub-threshold tenders (achizitii directe) via SEAP's
 * DirectAcquisitionCommon/GetDirectAcquisitionList endpoint. Date filtering
 * here is by finalizationDate (when the acquisition closed), not
 * publicationDate — publicationDateStart/End have no effect on this endpoint.
 */
export async function searchSubThresholdTenders(
  maxResults: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<SeapDaListResponse> {
  const allItems: SeapRawDirectAcquisition[] = [];
  let searchTooLong = false;
  let totalMatches = 0;
  const pageSize = 50;

  for (let page = 0; allItems.length < maxResults; page++) {
    const body: GetDirectAcquisitionListBody = {
      pageSize,
      showOngoingDa: false,
      cookieContext: null,
      pageIndex: page,
      sysDirectAcquisitionStateId: null,
      publicationDateStart: null,
      publicationDateEnd: null,
      finalizationDateStart: dateFrom ?? null,
      finalizationDateEnd: dateTo ?? null,
      cpvCategoryId: null,
      contractingAuthorityId: null,
      supplierId: null,
      cpvCodeId: null,
    };

    const response = await fetchWithRetry<SeapDaListResponse>(() =>
      fetchJson<SeapDaListResponse>(
        `${BASE}/api-pub/DirectAcquisitionCommon/GetDirectAcquisitionList/`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      ),
    );

    const batch = response.items ?? [];
    if (batch.length === 0) break;

    searchTooLong = searchTooLong || response.searchTooLong;
    if (page === 0) totalMatches = response.total ?? batch.length;

    for (const raw of batch) {
      allItems.push(raw);
      if (allItems.length >= maxResults) break;
    }

    if (batch.length < pageSize) break;
  }

  return { items: allItems, searchTooLong, total: totalMatches };
}

/* ------------------------------------------------------------------ */
/*  County filtering (client-side)                                     */
/* ------------------------------------------------------------------ */

/**
 * Brasov county authority keywords for client-side filtering.
 * SEAP does not expose a county filter in its public API, so we filter by
 * matching known Brasov county administrative unit names (the 4 municipii,
 * 6 orașe, and comune) plus common authority-name patterns. Deliberately
 * scoped to Brasov county only — do not add place names from other
 * counties, even ones that sound similar or are geographically close.
 *
 * Matching is whole-word (see containsWholeWord below), so short names no
 * longer collide with unrelated words containing them as a substring
 * ("bran" no longer matches inside "membrană", "vulcan" no longer matches
 * inside "vulcanizare", etc.). That does NOT protect against a handful of
 * these being the exact same word as a real locality/name elsewhere in
 * Romania — "victoria" (also Brăila), "vulcan" (also a Hunedoara city),
 * "comana" (also Giurgiu), "cristian"/"beclean" (also a common first name /
 * a Bistrița-Năsăud town) — those are included anyway for recall; expect
 * an occasional false positive from one of those exact collisions.
 */
const BRASOV_KEYWORDS = [
  // Authority-name patterns
  'brașov',
  'brasov',
  'bj brasov',
  'consiliul județean brașov',
  'consiliul judecen brasov',
  'prefectura brașov',
  'prefectura brasov',
  'primăria brașov',
  'primaria brasov',
  'municipiul brașov',
  'municipiul brasov',
  'orașul brasov',
  'comuna brasov',
  // Municipii
  'codlea',
  'fagaras',
  'făgăraș',
  'sacele',
  'săcele',
  // Orașe
  'ghimbav',
  'predeal',
  'rupea',
  'rasnov',
  'râșnov',
  'victoria',
  'zarnesti',
  'zărnești',
  // Comune
  'apata',
  'apața',
  'augustin',
  'beclean',
  'bod',
  'bran',
  'budila',
  'bunești',
  'bunesti',
  'cata',
  'cața',
  'cincu',
  'comana',
  'comăna',
  'cristian',
  'crizbav',
  'dragus',
  'drăguș',
  'dumbravita',
  'dumbrăvița',
  'feldioara',
  'fundata',
  'hoghiz',
  'holbav',
  'homorod',
  'harseni',
  'hârseni',
  'halchiu',
  'hălchiu',
  'harman',
  'hărman',
  'jibert',
  'lisa',
  'moieciu',
  'mandra',
  'mândra',
  'maierus',
  'măieruș',
  'ormenis',
  'ormeniș',
  'poiana marului',
  'poiana mărului',
  'prejmer',
  'parau',
  'părău',
  'racos',
  'racoș',
  'recea',
  'sambata de sus',
  'sâmbăta de sus',
  'sanpetru',
  'sânpetru',
  'teliu',
  'ticusu',
  'ticușu',
  'tarlungeni',
  'tărlungeni',
  'ucea',
  'ungra',
  'vama buzăului',
  'vama buzaului',
  'vistea',
  'viștea',
  'voila',
  'vulcan',
  'sercaia',
  'șercaia',
  'sinca',
  'șinca',
  'soars',
  'șoarș',
];

/**
 * Check if a tender is from Brasov county by examining the authority name
 * and other available fields.
 */
export function isBrasovTender(tender: SeapTender | SeapRawNotice): boolean {
  const text = [
    (tender as any).authorityName ?? '',
    (tender as any).contractingAuthorityNameAndFN ?? '',
    (tender as any).county ?? '',
    (tender as any).title ?? (tender as any).contractTitle ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return BRASOV_KEYWORDS.some((kw) => containsWholeWord(text, kw));
}

/**
 * Check whether `keyword` appears in `text` as a whole word/phrase (not as
 * a substring inside a longer word) — e.g. "bran" must not match inside
 * "membrana", "vulcan" must not match inside "vulcanizare". Uses Unicode
 * property escapes so Romanian diacritics (ă, â, î, ș, ț) count as word
 * characters for boundary purposes.
 */
function containsWholeWord(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
  return pattern.test(text);
}
