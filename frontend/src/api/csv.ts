import api from './client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParseResult {
  validCount: number;
  invalidCount: number;
  duplicatesRemoved: number;
  emails: string[];
  invalidRows: string[]; // capped at 50 by the backend
}

// ── API call ──────────────────────────────────────────────────────────────────

/**
 * Upload a CSV/TXT file to POST /csv/parse and return the parsed results.
 * Uses multipart/form-data — axios handles the Content-Type header automatically.
 */
export async function parseCsv(file: File): Promise<ParseResult> {
  const form = new FormData();
  form.append('file', file);

  const res = await api.post<ParseResult>('/csv/parse', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}
