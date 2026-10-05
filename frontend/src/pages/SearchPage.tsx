import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchEmails } from '../api/search';

function displayDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

export default function SearchPage() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const results = useQuery({
    queryKey: ['email-search', query, page],
    queryFn: () => searchEmails(query, page),
    enabled: query.length > 0,
    retry: false,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setQuery(input.trim());
  }

  return (
    <div className="dash-page">
      <div className="dash-header">
        <div>
          <h1 className="dash-title">Search emails</h1>
          <p className="dash-sub">Search recipient addresses, subjects, message bodies, and campaign names.</p>
        </div>
      </div>

      <form className="flex flex-col sm:flex-row gap-3 mb-6" onSubmit={submit}>
        <label htmlFor="email-search" className="sr-only">Search emails</label>
        <input
          id="email-search"
          className="form-input flex-1"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Search email, subject, or campaign"
          maxLength={200}
        />
        <button className="btn-primary" type="submit" disabled={!input.trim()}>
          Search
        </button>
      </form>

      {results.isLoading && query && (
        <div className="dash-loading"><div className="spinner" /><span>Searching emails…</span></div>
      )}
      {results.isError && (
        <div className="dash-error" role="alert">
          Email search is unavailable.
          <button className="btn-ghost ml-3" onClick={() => void results.refetch()}>Retry</button>
        </div>
      )}
      {!query && (
        <div className="dash-empty">
          <p className="dash-empty-title">Search across your emails</p>
          <p className="dash-empty-sub">Enter an address, subject, message text, or campaign name.</p>
        </div>
      )}
      {query && results.data && (
        <div className="dash-card">
          {results.data.hits.length === 0 ? (
            <div className="dash-empty">
              <p className="dash-empty-title">No matching emails</p>
              <p className="dash-empty-sub">Try another search phrase.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {results.data.hits.map((email) => (
                <article key={email.id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-gray-100">{email.recipientEmail}</strong>
                    <span className="badge badge-scheduled">{email.status}</span>
                  </div>
                  <h2 className="text-sm font-medium text-gray-200 mt-2">{email.subject}</h2>
                  <p className="text-xs text-gray-500 mt-1">{email.campaignName}</p>
                  <p className="text-sm text-gray-400 mt-3 whitespace-pre-wrap">{email.body}</p>
                  <p className="text-xs text-gray-500 mt-3">
                    Scheduled: {displayDate(email.scheduledAt)}
                    {email.sentAt && ` · Sent: ${displayDate(email.sentAt)}`}
                    {email.failedAt && ` · Failed: ${displayDate(email.failedAt)}`}
                  </p>
                </article>
              ))}
            </div>
          )}
          {results.data.totalPages > 1 && (
            <div className="flex justify-between items-center border-t border-gray-800 p-4 text-sm text-gray-400">
              <span>{results.data.total.toLocaleString()} results · Page {page} of {results.data.totalPages}</span>
              <div className="flex gap-2">
                <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                  Previous
                </button>
                <button
                  className="btn-ghost"
                  disabled={page >= results.data.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
