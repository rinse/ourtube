import Link from 'next/link';

interface HeaderProps {
  uploadLink?: boolean;
}

export default function Header({ uploadLink = false }: HeaderProps) {
  return (
    <header className="bg-white shadow-none sm:shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-2xl font-bold text-gray-900 hover:text-gray-700 transition-colors">
              OurTube
            </Link>
            <Link href="/playlists" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
              プレイリスト
            </Link>
          </div>
          {uploadLink && (
            <Link
              href="/upload"
              className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
            >
              + Upload
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
