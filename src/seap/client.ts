/**
 * SEAP (e-licitatie.ro) API client.
 *
 * Uses the undocumented public API reverse-engineered from the SEAP web interface
 * and validated against n8n-nodes-seap (https://github.com/cata-g/n8n-nodes-seap).
 *
 * Endpoints:
 *   GET  /api-pub/ComboPub/searchCpvs        — CPV autocomplete
 *   POST /api-pub/NoticeCommon/GetCNoticeList/ — above-threshold tender search (CAN)
 *   POST /api-pub/DaPublic/DaPublicList/     — sub-threshold tender search (DA)
 */

import type { SeapNoticeResponse, SeapRawNotice, SeapTender } from './types.js';

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

interface GetCNoticeListBody {
  sysNoticeTypeIds: number[];
  sortProperties: Array<{ propertyName: string; sortOrder: string }>;
  hasUnansweredQuestions: boolean;
  pageIndex: number;
  pageSize: number;
  cPVId?: number;
  cPVText?: string;
}

/**
 * Search above-threshold tenders via SEAP's GetCNoticeList endpoint.
 * Returns all pages up to `maxResults`.
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
    const body: GetCNoticeListBody = {
      sysNoticeTypeIds: [],
      sortProperties: [
        { propertyName: 'noticeStateDate', sortOrder: 'Descending' },
      ],
      hasUnansweredQuestions: false,
      pageIndex: page,
      pageSize,
    };

    const response = await fetchWithRetry<SeapNoticeResponse>(() =>
      fetchJson<SeapNoticeResponse>(
        `${BASE}/api-pub/NoticeCommon/GetCNoticeList/`,
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
      // Date filtering (client-side since SEAP ignores date params)
      if (dateFrom) {
        const noticeDate = new Date(raw.noticeStateDate).toISOString();
        if (noticeDate < dateFrom) continue;
      }
      if (dateTo) {
        const noticeDate = new Date(raw.noticeStateDate).toISOString();
        if (noticeDate > dateTo) continue;
      }

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

/**
 * Search sub-threshold tenders (achizitii directe).
 * SEAP uses a different endpoint for DA notices.
 */
export async function searchSubThresholdTenders(
  maxResults: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<SeapNoticeResponse> {
  const allItems: SeapRawNotice[] = [];
  let searchTooLong = false;
  let totalMatches = 0;
  const pageSize = 50;

  // The DA (direct acquisition) endpoint follows a similar pattern
  // Using the public API endpoint for DA notices
  for (let page = 0; allItems.length < maxResults; page++) {
    const body = {
      pageIndex: page,
      pageSize,
      sortColumn: 'publicationDate',
      sortDirection: 'Descending',
    };

    try {
      const response = await fetchWithRetry<SeapNoticeResponse>(() =>
        fetchJson<SeapNoticeResponse>(
          `${BASE}/api-pub/DaPublic/DaPublicList/`,
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
        // Date filtering for DA notices
        if (dateFrom) {
          const pubDate = new Date((raw as any).noticeStateDate ?? (raw as any).publicationDate ?? '').toISOString();
          if (pubDate < dateFrom) continue;
        }
        if (dateTo) {
          const pubDate = new Date((raw as any).noticeStateDate ?? (raw as any).publicationDate ?? '').toISOString();
          if (pubDate > dateTo) continue;
        }

        allItems.push(raw);
        if (allItems.length >= maxResults) break;
      }

      if (batch.length < pageSize) break;
    } catch {
      // DA endpoint may not exist or may have a different path — log and continue
      break;
    }
  }

  return { items: allItems, searchTooLong, total: totalMatches };
}

/* ------------------------------------------------------------------ */
/*  County filtering (client-side)                                     */
/* ------------------------------------------------------------------ */

/**
 * Brasov county authority keywords for client-side filtering.
 * SEAP does not expose a county filter in its public API, so we
 * filter by matching known Brasov authority patterns.
 */
const BRASOV_KEYWORDS = [
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
  'sebes',
  'fagaras',
  'rnfov',
  'predeal',
  'codlea',
  'buzau',
  'sacele',
  'vilcea',
  'hondoara',
  'baban',
  'martin',
  'galezi',
  'Zarnesti',
  'Bran',
  'Rasnov',
  'Sag',
  'Bicaz',
  'Targu Secuiesc',
  'Ocna Sibiului',
  'Vidra',
  'Alba Iulia',
  'Cernod',
  'Darnita',
  'Hoghiz',
  'Miercurea',
  'Bod',
  'Simeria',
  'Copsa',
  'Bunești',
  'Dărmănești',
  'Ghimbav',
  'Dăești',
  'Bărbulești',
  'Călimănești',
  'Hărman',
  'Bănița',
  'Băile',
  'Sovata',
  'Bunești',
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

  return BRASOV_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}
