import { useEffect, useState } from 'react';
import api from '../api/client';

export default function HealthPage() {
  const [health, setHealth] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Record<string, string>>('/health/dependencies')
      .then(response => setHealth(response.data))
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
