'use client';

import { useState, useEffect } from 'react';

interface ApiResponse {
  message?: string;
  status?: string;
  [key: string]: unknown;
}

export default function ApiTest() {
  const [apiData, setApiData] = useState<ApiResponse | null>(null);
  const [healthData, setHealthData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Test main API endpoint
        const apiResponse = await fetch('/api');
        const apiResult = await apiResponse.json();
        setApiData(apiResult);

        // Test health endpoint
        const healthResponse = await fetch('/api/health');
        const healthResult = await healthResponse.json();
        setHealthData(healthResult);

        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="p-4 border rounded-lg">
        <h3 className="text-lg font-semibold mb-2">Backend Connection Test</h3>
        <p>Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border rounded-lg border-red-500">
        <h3 className="text-lg font-semibold mb-2 text-red-600">Backend Connection Test</h3>
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="p-4 border rounded-lg border-green-500">
      <h3 className="text-lg font-semibold mb-2 text-green-600">Backend Connection Test</h3>
      <div className="space-y-2">
        <div>
          <strong>API Endpoint (/api):</strong>
          <pre className="bg-gray-100 p-2 rounded text-sm overflow-x-auto">
            {JSON.stringify(apiData, null, 2)}
          </pre>
        </div>
        <div>
          <strong>Health Endpoint (/api/health):</strong>
          <pre className="bg-gray-100 p-2 rounded text-sm overflow-x-auto">
            {JSON.stringify(healthData, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}