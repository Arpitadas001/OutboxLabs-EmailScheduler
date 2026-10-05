import { Router, Request, Response } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth';

/**
 * CSV / lead-file parse endpoint.
 *
 * POST /csv/parse
 *   - Accepts multipart/form-data with a `file` field (CSV or .txt).
 *   - Parses every line / cell looking for valid email addresses.
 *   - Returns { validCount, invalidCount, emails, invalidRows }.
 *
 * Design decisions:
 *   - In-memory storage (memoryStorage) — no disk I/O, no temp files.
 *   - 2 MB limit is generous for a list of raw email addresses.
 *   - We accept both:
 *       a) One email per line (simple .txt format).
 *       b) CSV with one or more columns — we scan every cell in every row
 *          and collect the first valid email found per row.
 *       c) CSV with an `email` / `Email` / `EMAIL` header column — we use
 *          that column exclusively when detected.
 *   - Validation: RFC 5321 structural regex (not DNS lookup).
 */

const router = Router();

// ── Multer config ─────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream'];
    if (
      allowed.includes(file.mimetype) ||
      file.originalname.endsWith('.csv') ||
      file.originalname.endsWith('.txt')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .csv and .txt files are accepted'));
    }
  },
});

// ── Email validation ──────────────────────────────────────────────────────────

/**
 * RFC 5321-ish email regex.  We deliberately keep this simple — we're not
 * doing DNS MX record lookups here.  The goal is to catch obvious garbage
 * like "notanemail" or "missing@" while accepting all reasonable addresses.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidEmail(val: string): boolean {
  return EMAIL_RE.test(val.trim());
}

// ── CSV line parser ────────────────────────────────────────────────────────────

/**
 * Split a CSV line respecting quoted fields.
 * "John, Doe","john@example.com",other → ["John, Doe", "john@example.com", "other"]
 */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post(
  '/parse',
  requireAuth,
  upload.single('file'),
  (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded — include a `file` field in the form data.' });
      return;
    }

    const text = req.file.buffer.toString('utf-8');
    // Normalize line endings
    const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const validEmails: string[] = [];
    const invalidRows: string[] = [];

    // Detect header row — does the first non-blank line contain an email-column header?
    let emailColIndex = -1; // -1 = no dedicated column
    const firstNonBlank = rawLines.find((l) => l.trim().length > 0) ?? '';
    const firstCells = splitCsvLine(firstNonBlank);

    const headerIdx = firstCells.findIndex((c) =>
      ['email', 'email address', 'emailaddress', 'e-mail', 'emails'].includes(
        c.replace(/"/g, '').toLowerCase().trim(),
      ),
    );

    if (headerIdx !== -1) {
      emailColIndex = headerIdx;
    }

    const startLine = emailColIndex !== -1 ? 1 : 0; // skip header row if found

    for (let i = startLine; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (!line) continue; // skip blank lines

      if (emailColIndex !== -1) {
        // CSV with a known email column
        const cells = splitCsvLine(line);
        const candidate = (cells[emailColIndex] ?? '').replace(/"/g, '').trim();
        if (isValidEmail(candidate)) {
          validEmails.push(candidate.toLowerCase());
        } else {
          invalidRows.push(`Row ${i + 1}: ${line}`);
        }
      } else {
        // One email per line OR scan all cells for the first valid email
        const cells = splitCsvLine(line);
        const found = cells
          .map((c) => c.replace(/"/g, '').trim())
          .find((c) => isValidEmail(c));

        if (found) {
          validEmails.push(found.toLowerCase());
        } else {
          invalidRows.push(`Row ${i + 1}: ${line}`);
        }
      }
    }

    // Deduplicate while preserving order
    const unique = [...new Set(validEmails)];
    const duplicatesRemoved = validEmails.length - unique.length;

    res.json({
      validCount: unique.length,
      invalidCount: invalidRows.length,
      duplicatesRemoved,
      emails: unique,
      invalidRows: invalidRows.slice(0, 50), // cap at 50 for response size
    });
  },
);

export default router;
