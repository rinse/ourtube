import { ReactNode } from 'react';

interface HeaderProps {
  children?: ReactNode;
}

export default function Header({ children }: HeaderProps) {
  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">Video Streaming Service</h1>
          {children}
        </div>
      </div>
    </header>
  );
}