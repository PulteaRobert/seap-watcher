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
 *   GET  /api-pub/ComboPub/searchCpvs                              — CPV autocomplete
 *   POST /api-pub/NoticeCommon/GetCANoticeList/                     — above-threshold tender search (CAN)
 *   POST /api-pub/DirectAcquisitionCommon/GetDirectAcquisitionList/ — sub-threshold tender search (DA)
 *   GET  /api-pub/C_PUBLIC_CANotice/get/{caNoticeId}                — CA notice detail (has entityId)
 *   GET  /api-pub/PublicDirectAcquisition/getView/{id}               — DA detail (has contractingAuthorityID)
 *   GET  /api-pub/Entity/getCAEntityView/{entityId}                  — authority detail, incl. real county
 *
 * The search endpoints have no county filter, so county membership is
 * matched by keyword against authority name/title (see isBrasovTender).
 * That's fast but can false-positive on same-named localities/facilities
 * in other counties. confirmCaNoticeCounty/confirmDaCounty do an
 * authoritative 2-hop lookup (notice/DA detail -> entity view -> real
 * registered county) — cheap to run only on the small set of tenders that
 * already passed the keyword filter, not on every raw result.
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
    valueRon: raw.ronContractValue ?? undefined,
    publicationDate: raw.noticeStateDate,
    state: raw.sysNoticeState?.text ?? '',
    url: raw.caNoticeId
      ? `${BASE}/pub/notices/ca-notices/view-c/${raw.caNoticeId}`
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

/** HTTP error that preserves status and a parsed Retry-After (ms), so
 * fetchWithRetry can back off according to what the server actually asked
 * for on a 429 instead of blindly using exponential backoff. */
class SeapHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'SeapHttpError';
  }
}

/** Parse a Retry-After header, which per spec is either a delay in whole
 * seconds or an HTTP-date. Returns undefined if absent or unparseable. */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const dateMs = new Date(header).getTime();
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Small delay used to pace sequential requests to the same host (pagination
 * pages, per-tender confirmation lookups) so a run with many matches doesn't
 * fire a burst of back-to-back calls. Jittered to avoid a thundering-herd
 * pattern if multiple instances ever ran concurrently. */
const REQUEST_DELAY_MS = 300;

export function requestDelay(): Promise<void> {
  return sleep(REQUEST_DELAY_MS + Math.random() * REQUEST_DELAY_MS * 0.5);
}

/** Longer pause between successive paginated *chunks* (as opposed to the
 * fine-grained requestDelay between individual pages within a chunk) — a
 * daily scan can walk through dozens of pages to reach the real end of the
 * result set, so this keeps that from reading as a scripted burst.
 * Randomized between 50s and 120s. */
const CHUNK_DELAY_MIN_MS = 50_000;
const CHUNK_DELAY_MAX_MS = 120_000;

export function chunkDelay(): Promise<void> {
  return sleep(
    CHUNK_DELAY_MIN_MS + Math.random() * (CHUNK_DELAY_MAX_MS - CHUNK_DELAY_MIN_MS),
  );
}

/** Hard safety cap on raw pages fetched per search call, in case the API
 * ever fails to signal a short/empty final page — without this a pagination
 * bug on SEAP's end would turn into an infinite loop. Comfortably above any
 * legitimate result-set size we've observed (SEAP's own DA endpoint caps
 * itself at 2000 items / 40 pages). */
const MAX_PAGES_PER_SEARCH = 200;

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { ...HEADERS, ...options?.headers },
  });

  if (!res.ok) {
    const retryAfterMs =
      res.status === 429 ? parseRetryAfterMs(res.headers.get('retry-after')) : undefined;
    throw new SeapHttpError(
      `SEAP HTTP ${res.status} ${res.statusText} for ${url}`,
      res.status,
      retryAfterMs,
    );
  }

  return res.json() as Promise<T>;
}

/** Cap how long a single retry wait can be, even if a Retry-After header asks
 * for longer — a misbehaving/compromised server shouldn't be able to stall a
 * run indefinitely. */
const MAX_RETRY_DELAY_MS = 30_000;

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
        const exponentialDelay = baseDelayMs * 2 ** attempt;
        const retryAfterMs = err instanceof SeapHttpError ? err.retryAfterMs : undefined;
        const delay = Math.min(
          retryAfterMs !== undefined ? Math.max(retryAfterMs, exponentialDelay) : exponentialDelay,
          MAX_RETRY_DELAY_MS,
        );
        await sleep(delay);
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
 * Unlike GetCNoticeList (which ignores sort/filter params and always
 * returns a frozen 2019 snapshot), this endpoint honours
 * startPublicationDate/endPublicationDate server-side, and returns results
 * newest-first — verified empirically against the live API.
 *
 * Paginates in `chunkSize`-item chunks, pausing (chunkDelay) between chunks,
 * until the real end of the result set is reached (a page shorter than the
 * page size) rather than stopping at the first chunk — so a single call
 * walks the whole window instead of only ever seeing the first page's worth.
 */
export async function searchAboveThresholdTenders(
  chunkSize: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<SeapNoticeResponse> {
  const allItems: SeapRawNotice[] = [];
  let searchTooLong = false;
  let totalMatches = 0;
  let totalKnown = false;
  const pageSize = 50;
  let pageIndex = 0;

  outer: while (pageIndex < MAX_PAGES_PER_SEARCH) {
    let chunkCount = 0;

    while (chunkCount < chunkSize) {
      if (pageIndex > 0) await requestDelay();

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
        pageIndex,
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
      searchTooLong = searchTooLong || response.searchTooLong;
      if (!totalKnown) {
        totalMatches = response.total ?? batch.length;
        totalKnown = true;
      }
      pageIndex++;

      if (batch.length === 0) break outer;
      allItems.push(...batch);
      chunkCount += batch.length;

      if (batch.length < pageSize || pageIndex >= MAX_PAGES_PER_SEARCH) break outer;
    }

    // A full chunk came back and more may remain — pace the next chunk well
    // back from the per-page delay before continuing.
    await chunkDelay();
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
 * publicationDate — publicationDateStart/End have no effect on this
 * endpoint, and results are NOT sorted by publicationDate either (verified
 * empirically: fetching without any cap returns items spanning months,
 * out of order, and the server caps `total`/results at 2000 regardless of
 * filters). So `dateFrom`/`dateTo` here only shape the request the server
 * sees; the real publication-window filtering happens client-side below.
 *
 * Paginates in `chunkSize`-item chunks, pausing (chunkDelay) between chunks,
 * continuing until the true end of the (capped) result set is reached —
 * needed for the client-side date filter to have a chance of finding
 * everything in-window, since the matching items aren't concentrated in the
 * first page.
 */
export async function searchSubThresholdTenders(
  chunkSize: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<SeapDaListResponse> {
  const allItems: SeapRawDirectAcquisition[] = [];
  let searchTooLong = false;
  let totalMatches = 0;
  let totalKnown = false;
  const pageSize = 50;
  let pageIndex = 0;

  outer: while (pageIndex < MAX_PAGES_PER_SEARCH) {
    let chunkCount = 0;

    while (chunkCount < chunkSize) {
      if (pageIndex > 0) await requestDelay();

      const body: GetDirectAcquisitionListBody = {
        pageSize,
        showOngoingDa: false,
        cookieContext: null,
        pageIndex,
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
      searchTooLong = searchTooLong || response.searchTooLong;
      if (!totalKnown) {
        totalMatches = response.total ?? batch.length;
        totalKnown = true;
      }
      pageIndex++;

      if (batch.length === 0) break outer;
      chunkCount += batch.length;

      for (const raw of batch) {
        if (dateFrom && raw.publicationDate < dateFrom) continue;
        if (dateTo && raw.publicationDate > dateTo) continue;
        allItems.push(raw);
      }

      if (batch.length < pageSize || pageIndex >= MAX_PAGES_PER_SEARCH) break outer;
    }

    // A full page came back and more may remain — pace the next chunk well
    // back from the per-page delay before continuing.
    await chunkDelay();
  }

  return { items: allItems, searchTooLong, total: totalMatches };
}

/* ------------------------------------------------------------------ */
/*  County filtering (client-side)                                     */
/* ------------------------------------------------------------------ */

/**
 * "Brasov"/"Brașov" itself and authority-name phrases built from it. There's
 * no other Romanian locality with this exact name, so a match here is
 * trusted directly — notably this covers national agencies awarding
 * contracts for local Brasov projects (e.g. CNAIR notices whose authority
 * is nationally registered but whose title says "D.R.D.P. Brasov"), which
 * a per-authority county lookup would incorrectly reject since the awarding
 * entity itself isn't registered in Brasov county.
 */
const TRUSTED_KEYWORDS = [
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
];

/**
 * Individual Brasov county administrative unit names (the 4 municipii minus
 * Brasov itself, 6 orașe, and comune). Unlike TRUSTED_KEYWORDS, several of
 * these are the exact same word as a real locality/name elsewhere in
 * Romania — "victoria" (also Brăila), "zarnesti" (also a Buzău commune),
 * "voila" (also a street name in Prahova), "vulcan" (also a Hunedoara
 * city), "comana" (also Giurgiu), "cristian"/"beclean" (also a common first
 * name / a Bistrița-Năsăud town) — all confirmed via live data, not
 * hypothetical. Matches against this list should be confirmed against the
 * authority's actual registered county (see confirmCaNoticeCounty /
 * confirmDaCounty) before being trusted, unlike TRUSTED_KEYWORDS matches.
 *
 * Matching is whole-word (see containsWholeWord below), so short names
 * don't collide with unrelated words containing them as a substring
 * ("bran" doesn't match inside "membrană", "vulcan" doesn't match inside
 * "vulcanizare", etc.) — but that's a separate concern from the
 * same-name-different-county collisions above.
 */
const AMBIGUOUS_KEYWORDS = [
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

function tenderText(tender: SeapTender | SeapRawNotice): string {
  return [
    (tender as any).authorityName ?? '',
    (tender as any).contractingAuthorityNameAndFN ?? '',
    (tender as any).county ?? '',
    (tender as any).title ?? (tender as any).contractTitle ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Check if a tender is from Brasov county by examining the authority name
 * and other available fields.
 */
export function isBrasovTender(tender: SeapTender | SeapRawNotice): boolean {
  const text = tenderText(tender);
  return [...TRUSTED_KEYWORDS, ...AMBIGUOUS_KEYWORDS].some((kw) =>
    containsWholeWord(text, kw),
  );
}

/**
 * True if the tender matched via an unambiguous "Brasov"/"Brașov" mention
 * (see TRUSTED_KEYWORDS) rather than only via an individual town/comuna
 * name. Callers should skip the county-confirmation lookup when this is
 * true — see the comment on TRUSTED_KEYWORDS for why.
 */
export function matchesTrustedBrasovKeyword(
  tender: SeapTender | SeapRawNotice,
): boolean {
  const text = tenderText(tender);
  return TRUSTED_KEYWORDS.some((kw) => containsWholeWord(text, kw));
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

/* ------------------------------------------------------------------ */
/*  County confirmation (authoritative, via authority lookup)          */
/* ------------------------------------------------------------------ */

function normalizeCounty(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

async function getEntityIdFromCaNotice(caNoticeId: number): Promise<number | null> {
  try {
    const detail = await fetchWithRetry(() =>
      fetchJson<{ entityId: number | null }>(`${BASE}/api-pub/C_PUBLIC_CANotice/get/${caNoticeId}`),
    );
    return detail.entityId ?? null;
  } catch {
    return null;
  }
}

async function getEntityIdFromDa(directAcquisitionId: number): Promise<number | null> {
  try {
    const detail = await fetchWithRetry(() =>
      fetchJson<{ contractingAuthorityID: number | null }>(
        `${BASE}/api-pub/PublicDirectAcquisition/getView/${directAcquisitionId}`,
      ),
    );
    return detail.contractingAuthorityID ?? null;
  } catch {
    return null;
  }
}

async function getEntityCounty(entityId: number): Promise<string | null> {
  try {
    const view = await fetchWithRetry(() =>
      fetchJson<{ county: string | null }>(`${BASE}/api-pub/Entity/getCAEntityView/${entityId}`),
    );
    return view.county ?? null;
  } catch {
    return null;
  }
}

/**
 * Authoritatively confirm whether a CA (above-threshold) notice's
 * contracting authority is registered in `county`, via a 2-hop lookup
 * (notice detail -> entity view -> real county). Meant as a confirmation
 * pass on top of isBrasovTender's keyword match, not a replacement — it's
 * two extra HTTP calls, so only run it on tenders that already matched.
 *
 * Returns `null` (not `false`) if either lookup fails, so callers can fail
 * open and keep the keyword match rather than silently dropping a possibly
 * genuine tender because of a transient network error.
 */
export async function confirmCaNoticeCounty(
  caNoticeId: number,
  county: string,
): Promise<boolean | null> {
  const entityId = await getEntityIdFromCaNotice(caNoticeId);
  if (entityId === null) return null;
  const entityCounty = await getEntityCounty(entityId);
  if (entityCounty === null) return null;
  return normalizeCounty(entityCounty) === normalizeCounty(county);
}

/** Same as {@link confirmCaNoticeCounty}, but for direct-acquisition (DA) records. */
export async function confirmDaCounty(
  directAcquisitionId: number,
  county: string,
): Promise<boolean | null> {
  const entityId = await getEntityIdFromDa(directAcquisitionId);
  if (entityId === null) return null;
  const entityCounty = await getEntityCounty(entityId);
  if (entityCounty === null) return null;
  return normalizeCounty(entityCounty) === normalizeCounty(county);
}

/* ------------------------------------------------------------------ */
/*  Near-threshold detection (contract-splitting red flag)             */
/* ------------------------------------------------------------------ */

/**
 * Romanian direct-acquisition value thresholds (RON, without VAT) — above
 * these, a contract must go through the full above-threshold procedure
 * instead of a simple direct acquisition. "Lucrari" (works) uses the same
 * figure as "Servicii" since no separate works threshold was provided.
 */
const DIRECT_ACQUISITION_THRESHOLDS: Record<string, number> = {
  Furnizare: 270_120,
  Servicii: 900_400,
  Lucrari: 900_400,
};

/** How far below the threshold still counts as "just under" (10%). */
const NEAR_THRESHOLD_MARGIN = 0.1;

/**
 * True if `valueRon` sits within NEAR_THRESHOLD_MARGIN below the
 * direct-acquisition threshold for `contractType` — a common signal of
 * contract splitting to dodge the more rigorous above-threshold procedure.
 */
export function isNearThreshold(
  valueRon: number | undefined,
  contractType: string | undefined,
): boolean {
  if (!valueRon || !contractType) return false;
  const threshold = DIRECT_ACQUISITION_THRESHOLDS[contractType];
  if (!threshold) return false;
  const lowerBound = threshold * (1 - NEAR_THRESHOLD_MARGIN);
  return valueRon >= lowerBound && valueRon <= threshold;
}

async function getDaContractType(directAcquisitionId: number): Promise<string | null> {
  try {
    const detail = await fetchWithRetry(() =>
      fetchJson<{ sysAcquisitionContractType?: { text: string } | null }>(
        `${BASE}/api-pub/PublicDirectAcquisition/getView/${directAcquisitionId}`,
      ),
    );
    return detail.sysAcquisitionContractType?.text ?? null;
  } catch {
    return null;
  }
}

/**
 * Check whether a direct-acquisition tender is near-threshold (see
 * isNearThreshold). Only fetches the DA detail (for the real contract type
 * — the list endpoint doesn't expose it) when the value already falls
 * within a candidate window for *some* threshold, to avoid an extra
 * network call for the common case of a tender nowhere close to either.
 */
export async function checkNearThreshold(
  directAcquisitionId: number,
  valueRon: number | undefined,
): Promise<boolean> {
  if (!valueRon) return false;

  const inAnyCandidateWindow = Object.values(DIRECT_ACQUISITION_THRESHOLDS).some(
    (threshold) => {
      const lowerBound = threshold * (1 - NEAR_THRESHOLD_MARGIN);
      return valueRon >= lowerBound && valueRon <= threshold;
    },
  );
  if (!inAnyCandidateWindow) return false;

  const contractType = await getDaContractType(directAcquisitionId);
  return isNearThreshold(valueRon, contractType ?? undefined);
}
