/**
 * SEAP (e-licitatie.ro) tender data types.
 *
 * Based on the actual SEAP API response schema reverse-engineered from
 * n8n-nodes-seap and the live API at https://e-licitatie.ro/api-pub/
 */

/** A single tender notice from SEAP, normalised for our storage. */
export interface SeapTender {
  /** Unique SEAP notice number, e.g. "SCN1175406", "CN1090827" */
  sicapId: string;

  /** Tier: 'above_threshold' (CAN - licitatii publice) or 'sub_threshold' (DA - achizitii directe) */
  tier: 'sub_threshold' | 'above_threshold';

  /** Romanian title of the procurement */
  title: string;

  /** Contracting authority name */
  authorityName: string;

  /** CUI (fiscal code) of the contracting authority */
  authorityCui?: string;

  /** County of the contracting authority, e.g. "Brasov" */
  county: string;

  /** CPV classification code */
  cpvCode: string;

  /** CPV description label */
  cpvLabel?: string;

  /** Estimated value in RON */
  valueRon?: number;

  /** ISO publication date string */
  publicationDate: string;

  /** Notice state, e.g. "Publicat", "In curs", "Atribuita", "Anulata" */
  state: string;

  /** Direct link to the tender on e-licitatie.ro */
  url: string;

  /** Offer submission deadline (ISO date) */
  deadline?: string;

  /** Contract type: "Furnizare", "Lucrare", "Servicii" */
  type: string;
}

/** Raw SEAP API response envelope for notice list queries. */
export interface SeapNoticeResponse {
  total: number;
  items: SeapRawNotice[];
  searchTooLong: boolean;
}

/** A single raw notice item from the SEAP API. */
export interface SeapRawNotice {
  cNoticeId: number;
  noticeId: number;
  procedureId: number;
  noticeNo: string;
  sysNoticeTypeId: number;
  sysNoticeState: { id: number; text: string };
  sysProcedureState: { id: number; text: string };
  contractingAuthorityNameAndFN: string;
  contractTitle: string;
  sysAcquisitionContractType: { id: number; text: string };
  sysProcedureType: { id: number; text: string };
  sysContractAssigmentType: { id: number; text: string };
  cpvCodeAndName: string;
  estimatedValueRon: number;
  isOnline: boolean;
  hasLots: boolean;
  noticeStateDate: string;
  minTenderReceiptDeadline?: string;
  maxTenderReceiptDeadline?: string;
  tenderReceiptDeadlineExport?: string;
  estimatedValueExport?: string;
}

/** Result of a SEAP search operation. */
export interface SeapSearchResult {
  tenders: SeapTender[];
  searchTooLong: boolean;
  totalMatches?: number;
}

/** A run log entry tracking each scheduled fetch. */
export interface RunLog {
  runAt: string;
  cronSlot: 'morning' | 'afternoon' | 'manual';
  totalFetched: number;
  newTenders: number;
  alertedCount: number;
  status: 'completed' | 'failed' | 'partial';
  errorMessage?: string;
}
