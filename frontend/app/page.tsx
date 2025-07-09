import VideoList from './components/VideoList';
import Header from './components/Header';
import Link from 'next/link';

export default function Home() {
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
        <VideoList />
      </main>
    </div>
  );
}