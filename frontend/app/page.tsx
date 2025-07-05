import VideoPlayer from './components/VideoPlayer';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-4">
            <h1 className="text-2xl font-bold text-gray-900">Video Streaming Service</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-xl font-semibold text-gray-800">Sample Video</h2>
            <p className="text-gray-600 text-sm mt-1">HLS streaming test with mobile support</p>
          </div>
          
          <VideoPlayer src="/videos/sample.hls/sample.m3u8" />
          
          <div className="p-4">
            <h3 className="font-semibold text-gray-800 mb-2">Video Details</h3>
            <p className="text-gray-600 text-sm">
              This is a sample HLS video stream. The player supports:
            </p>
            <ul className="mt-2 text-sm text-gray-600 list-disc list-inside">
              <li>HLS adaptive streaming</li>
              <li>Mobile portrait layout</li>
              <li>Fullscreen with landscape orientation</li>
              <li>Native browser controls</li>
            </ul>
          </div>
        </div>

        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Instructions</h2>
          <div className="space-y-2 text-sm text-gray-600">
            <p>• Tap the video to play/pause</p>
            <p>• Use the fullscreen button to enter landscape mode</p>
            <p>• The player automatically handles HLS streaming</p>
            <p>• Works on both desktop and mobile devices</p>
          </div>
        </div>
      </main>
    </div>
  );
}