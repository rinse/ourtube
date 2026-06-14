'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from '../components/Header';
import { apiFetch } from '../lib/api';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Via apiFetch so the OAC body-hash header is attached (see lib/api.ts).
      // apiFetch won't redirect on 401 while already on /login.
      const res = await apiFetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      if (!res.ok) {
        setError('シークレットが正しくありません');
        return;
      }
      const from = search.get('from') || '/';
      router.push(from);
    } catch {
      setError('ネットワークエラーが発生しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-lg shadow-lg p-8 space-y-6 max-w-md mx-auto">
      <div>
        <label htmlFor="secret" className="block text-sm font-medium text-gray-700 mb-2">アクセスシークレット</label>
        <input
          id="secret"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoFocus
          className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
        />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={busy || !secret}
        className={`w-full py-3 px-6 rounded-lg font-medium transition-colors ${
          busy || !secret ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      >
        {busy ? '確認中...' : 'ログイン'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gray-100">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
