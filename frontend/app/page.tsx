'use client';

import { useState } from 'react';
import VideoList, { SortOption } from './components/VideoList';
import Header from './components/Header';
import Link from 'next/link';

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  return (
    <div className="min-h-screen bg-gray-100">
      <Header>
        <Link
          href="/upload"
          className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
        >
          + Upload
        </Link>
      </Header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="タイトルで検索"
              aria-label="タイトルで検索"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="sort-select" className="text-sm text-gray-600 whitespace-nowrap">
              並び替え
            </label>
            <select
              id="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="text-sm border border-gray-300 rounded-md bg-white text-gray-800 py-2 px-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="newest">新着順</option>
              <option value="oldest">古い順</option>
              <option value="title-asc">タイトル昇順</option>
            </select>
          </div>
        </div>

        <VideoList searchQuery={searchQuery} sortBy={sortBy} />
      </main>
    </div>
  );
}