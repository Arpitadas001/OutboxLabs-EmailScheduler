import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { createCampaign, type CreateCampaignPayload } from '../api/campaigns';
import { parseCsv, type ParseResult } from '../api/csv';

function toLocalDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  const labels = ['Content', 'Leads', 'Schedule'];
  return (
    <div className="compose-steps">
      {labels.map((label, i) => {
        const step = i + 1;
        const done    = step < current;
        const active  = step === current;
        return (
          <div key={label} className="compose-step-item">
            <div className={`compose-step-circle ${done ? 'done' : active ? 'active' : ''}`}>
              {done ? (
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <span>{step}</span>
              )}
            </div>
            <span className={`compose-step-label ${active ? 'active' : done ? 'done' : ''}`}>{label}</span>
            {i < total - 1 && <div className={`compose-step-line ${done ? 'done' : ''}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Content ───────────────────────────────────────────────────────────

interface Step1Data {
  subject: string;
  body: string;
}

function Step1({
  data, onChange, onNext,
}: {
  data: Step1Data;
  onChange: (d: Step1Data) => void;
  onNext: () => void;
}) {
  const [errors, setErrors] = useState<Partial<Step1Data>>({});

  function validate() {
    const e: Partial<Step1Data> = {};
    if (!data.subject.trim()) e.subject = 'Subject is required.';
    if (!data.body.trim()) e.body = 'Body is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  return (
    <div className="compose-step-content">
      <h2 className="compose-step-title">Email Content</h2>
      <p className="compose-step-desc">Write the subject line and body for your campaign emails.</p>

      <div className="form-group">
        <label htmlFor="subject" className="form-label">Subject line</label>
        <input
          id="subject"
          type="text"
          className={`form-input ${errors.subject ? 'input-error' : ''}`}
          placeholder="Your subject line…"
          value={data.subject}
          maxLength={998}
          onChange={(e) => onChange({ ...data, subject: e.target.value })}
        />
        {errors.subject && <p className="form-error">{errors.subject}</p>}
        <p className="form-hint">{data.subject.length}/998 characters</p>
      </div>

      <div className="form-group">
        <label htmlFor="body" className="form-label">Email body</label>
        <textarea
          id="body"
          className={`form-textarea ${errors.body ? 'input-error' : ''}`}
          rows={10}
          placeholder="Write your email body here…"
          value={data.body}
          onChange={(e) => onChange({ ...data, body: e.target.value })}
        />
        {errors.body && <p className="form-error">{errors.body}</p>}
        <p className="form-hint">{data.body.length} characters</p>
      </div>

      <div className="compose-nav">
        <div />
        <button id="step1-next" className="btn-primary" onClick={() => validate() && onNext()}>
          Next: Upload Leads →
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Leads / CSV ───────────────────────────────────────────────────────

function Step2({
  parseResult, onFileSelect, isParsing, parseError,
  onBack, onNext,
}: {
  parseResult: ParseResult | null;
  onFileSelect: (file: File) => void;
  isParsing: boolean;
  parseError: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect],
  );

  const canProceed = parseResult && parseResult.validCount > 0;

  return (
    <div className="compose-step-content">
      <h2 className="compose-step-title">Upload Leads</h2>
      <p className="compose-step-desc">
        Upload a CSV or TXT file containing recipient email addresses. We'll validate them automatically.
      </p>

      {/* Drop zone */}
      <div
        id="csv-dropzone"
        className={`dropzone ${dragging ? 'dragging' : ''} ${isParsing ? 'parsing' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelect(f); }}
        />
        {isParsing ? (
          <div className="dropzone-content">
            <div className="spinner" />
            <p>Parsing file…</p>
          </div>
        ) : (
          <div className="dropzone-content">
            <svg className="w-10 h-10 text-gray-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-gray-300 font-medium">Drop your CSV or TXT file here</p>
            <p className="text-gray-500 text-sm mt-1">or click to browse · max 2 MB</p>
          </div>
        )}
      </div>

      {/* Parse error */}
      {parseError && (
        <div className="alert-error">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {parseError}
        </div>
      )}

      {/* Parse results */}
      {parseResult && !isParsing && (
        <div className="parse-results">
          <div className="parse-stat valid">
            <span className="parse-count">{parseResult.validCount.toLocaleString()}</span>
            <span className="parse-stat-label">Valid emails</span>
          </div>
          <div className="parse-stat invalid">
            <span className="parse-count">{parseResult.invalidCount.toLocaleString()}</span>
            <span className="parse-stat-label">Invalid / skipped</span>
          </div>
          {parseResult.duplicatesRemoved > 0 && (
            <div className="parse-stat dedup">
              <span className="parse-count">{parseResult.duplicatesRemoved.toLocaleString()}</span>
              <span className="parse-stat-label">Duplicates removed</span>
            </div>
          )}
        </div>
      )}

      {/* Invalid row list */}
      {parseResult && parseResult.invalidRows.length > 0 && (
        <details className="invalid-rows">
          <summary className="invalid-rows-summary">
            Show invalid rows ({parseResult.invalidRows.length}{parseResult.invalidCount > 50 ? '+' : ''})
          </summary>
          <ul className="invalid-rows-list">
            {parseResult.invalidRows.map((r, i) => (
              <li key={i} className="invalid-row">{r}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="compose-nav">
        <button id="step2-back" className="btn-ghost" onClick={onBack}>← Back</button>
        <button
          id="step2-next"
          className="btn-primary"
          disabled={!canProceed}
          onClick={() => canProceed && onNext()}
        >
          Next: Schedule →
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Schedule & Config ─────────────────────────────────────────────────

interface Step3Data {
  name: string;
  startAt: string;
  delaySeconds: number;
  hourlyLimit: number;
}

function Step3({
  data, onChange, onBack, onSubmit, isSubmitting, submitError,
}: {
  data: Step3Data;
  onChange: (d: Step3Data) => void;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  submitError: string | null;
}) {
  const [errors, setErrors] = useState<Partial<Record<keyof Step3Data, string>>>({});

  function validate() {
    const e: Partial<Record<keyof Step3Data, string>> = {};
    if (!data.name.trim()) e.name = 'Campaign name is required.';
    if (!data.startAt) e.startAt = 'Start time is required.';
    else if (new Date(data.startAt) < new Date()) e.startAt = 'Start time must be in the future.';
    if (data.delaySeconds < 0) e.delaySeconds = 'Delay must be ≥ 0.';
    if (data.hourlyLimit < 1) e.hourlyLimit = 'Hourly limit must be ≥ 1.';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // Default startAt: 5 minutes from now, as local datetime-local string
  const minDatetime = toLocalDateTimeValue(new Date(Date.now() + 2 * 60 * 1000));

  return (
    <div className="compose-step-content">
      <h2 className="compose-step-title">Schedule &amp; Configure</h2>
      <p className="compose-step-desc">Set the campaign name, launch time, and sending limits.</p>

      {submitError && (
        <div className="alert-error mb-4">
          <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {submitError}
        </div>
      )}

      <div className="form-group">
        <label htmlFor="camp-name" className="form-label">Campaign name</label>
        <input
          id="camp-name"
          type="text"
          className={`form-input ${errors.name ? 'input-error' : ''}`}
          placeholder="My October Campaign"
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
        />
        {errors.name && <p className="form-error">{errors.name}</p>}
      </div>

      <div className="form-group">
        <label htmlFor="start-at" className="form-label">Start at (local time)</label>
        <input
          id="start-at"
          type="datetime-local"
          className={`form-input ${errors.startAt ? 'input-error' : ''}`}
          min={minDatetime}
          value={data.startAt}
          onChange={(e) => onChange({ ...data, startAt: e.target.value })}
        />
        {errors.startAt && <p className="form-error">{errors.startAt}</p>}
      </div>

      <div className="form-row">
        <div className="form-group">
          <label htmlFor="delay" className="form-label">
            Delay between emails
            <span className="form-label-unit">(seconds)</span>
          </label>
          <input
            id="delay"
            type="number"
            min={0}
            max={3600}
            className={`form-input ${errors.delaySeconds ? 'input-error' : ''}`}
            value={data.delaySeconds}
            onChange={(e) => onChange({ ...data, delaySeconds: Number(e.target.value) })}
          />
          {errors.delaySeconds && <p className="form-error">{errors.delaySeconds}</p>}
          <p className="form-hint">Min gap between individual sends in this campaign.</p>
        </div>

        <div className="form-group">
          <label htmlFor="hourly-limit" className="form-label">
            Hourly send limit
            <span className="form-label-unit">(per sender)</span>
          </label>
          <input
            id="hourly-limit"
            type="number"
            min={1}
            max={1000}
            className={`form-input ${errors.hourlyLimit ? 'input-error' : ''}`}
            value={data.hourlyLimit}
            onChange={(e) => onChange({ ...data, hourlyLimit: Number(e.target.value) })}
          />
          {errors.hourlyLimit && <p className="form-error">{errors.hourlyLimit}</p>}
          <p className="form-hint">Max emails per Ethereal sender account per hour.</p>
        </div>
      </div>

      <div className="compose-nav">
        <button id="step3-back" className="btn-ghost" onClick={onBack} disabled={isSubmitting}>
          ← Back
        </button>
        <button
          id="step3-submit"
          className="btn-primary"
          onClick={() => validate() && onSubmit()}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <div className="spinner-sm" />
              Scheduling…
            </>
          ) : (
            '🚀 Schedule Campaign'
          )}
        </button>
      </div>
    </div>
  );
}

// ── Success screen ─────────────────────────────────────────────────────────────

function SuccessScreen({ campaignName, emailCount }: { campaignName: string; emailCount: number }) {
  return (
    <div className="compose-success">
      <div className="success-icon">🎉</div>
      <h2 className="success-title">Campaign Scheduled!</h2>
      <p className="success-body">
        <strong>{campaignName}</strong> has been created with{' '}
        <strong>{emailCount.toLocaleString()} emails</strong> queued for delivery.
      </p>
      <div className="success-actions">
        <Link to="/" id="success-goto-dash" className="btn-primary">Go to Dashboard</Link>
        <button
          id="success-new-campaign"
          className="btn-ghost"
          onClick={() => window.location.reload()}
        >
          Create Another
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ComposePage() {
  const [step, setStep] = useState(1);

  // Step 1 state
  const [step1, setStep1] = useState<{ subject: string; body: string }>({
    subject: '', body: '',
  });

  // Step 2 state
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Step 3 state — default startAt 5 min from now
  const defaultStart = toLocalDateTimeValue(new Date(Date.now() + 5 * 60 * 1000));
  const [step3, setStep3] = useState<{
    name: string; startAt: string; delaySeconds: number; hourlyLimit: number;
  }>({ name: '', startAt: defaultStart, delaySeconds: 5, hourlyLimit: 50 });

  // Submit mutation
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; count: number } | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: (payload: CreateCampaignPayload) => createCampaign(payload),
    onSuccess: (campaign) => {
      setCreated({ name: campaign.name, count: campaign.totalEmails });
    },
    onError: (err: Error & { response?: { data?: { error?: string } } }) => {
      setSubmitError(
        err.response?.data?.error ?? err.message ?? 'Failed to create campaign.',
      );
    },
  });

  // CSV file handler
  async function handleFile(file: File) {
    setParseError(null);
    setParseResult(null);
    setIsParsing(true);
    try {
      const result = await parseCsv(file);
      setParseResult(result);
      if (result.validCount === 0) {
        setParseError('No valid email addresses found in the uploaded file.');
      }
    } catch (err: unknown) {
      const e = err as Error & { response?: { data?: { error?: string } } };
      setParseError(e.response?.data?.error ?? e.message ?? 'Failed to parse file.');
    } finally {
      setIsParsing(false);
    }
  }

  function handleSubmit() {
    if (!parseResult || parseResult.validCount === 0) return;
    setSubmitError(null);

    // Convert local datetime-local value to UTC ISO string
    const startAtISO = new Date(step3.startAt).toISOString();

    mutate({
      name: step3.name,
      subject: step1.subject,
      body: step1.body,
      emails: parseResult.emails,
      startAt: startAtISO,
      delaySeconds: step3.delaySeconds,
      hourlyLimit: step3.hourlyLimit,
    });
  }

  if (created) {
    return (
      <div className="compose-page">
        <SuccessScreen campaignName={created.name} emailCount={created.count} />
      </div>
    );
  }

  return (
    <div className="compose-page">
      <div className="compose-header">
        <h1 className="dash-title">New Campaign</h1>
        <p className="dash-sub">Complete the three steps below to schedule your email campaign.</p>
      </div>

      <div className="compose-card">
        <StepIndicator current={step} total={3} />

        <div className="compose-body">
          {step === 1 && (
            <Step1 data={step1} onChange={setStep1} onNext={() => setStep(2)} />
          )}
          {step === 2 && (
            <Step2
              parseResult={parseResult}
              onFileSelect={handleFile}
              isParsing={isParsing}
              parseError={parseError}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <Step3
              data={step3}
              onChange={setStep3}
              onBack={() => setStep(2)}
              onSubmit={handleSubmit}
              isSubmitting={isPending}
              submitError={submitError}
            />
          )}
        </div>
      </div>
    </div>
  );
}
