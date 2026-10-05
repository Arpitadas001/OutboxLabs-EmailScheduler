import { useEffect, useState } from 'react';

export default function HealthPage() {
  const [health, setHealth] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://localhost:3001/health/dependencies')
      .then(res => res.json())
      .then(data => setHealth(data))
      .catch(err => setError(err.message));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">System Health</h1>
      <div className="bg-white shadow overflow-hidden sm:rounded-lg p-6">
        {error ? (
          <div className="text-red-500">Error: {error}</div>
        ) : health ? (
          <pre className="bg-gray-50 p-4 rounded text-sm">{JSON.stringify(health, null, 2)}</pre>
        ) : (
          <div>Loading...</div>
        )}
      </div>
    </div>
  );
}
