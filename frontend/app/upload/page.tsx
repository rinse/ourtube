'use client'

import { useState, ChangeEvent, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function UploadPage() {
  const router = useRouter()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [filePath, setFilePath] = useState('')
  const [title, setTitle] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setFilePath(file.name)
      setError(null)
    }
  }

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!selectedFile) {
      setError('Please select a video file')
      return
    }

    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append('video', selectedFile)
      formData.append('title', title || selectedFile.name.replace(/\.[^/.]+$/, ''))

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Upload failed')
      }

      await response.json()
      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload video')
      console.error('Upload error:', err)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-4 flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Video Streaming Service</h1>
            <Link
              href="/"
              className="flex items-center space-x-2 text-blue-600 hover:text-blue-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back to Videos</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Upload New Video</h2>
            <p className="text-gray-600">Choose a video file to upload and convert to HLS format</p>
          </div>
          
          <form onSubmit={handleUpload} className="bg-white rounded-lg shadow-lg p-8 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Video File
              </label>
              <div className="space-y-3">
                <input
                  type="text"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="Enter file path or select a file"
                  className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
                <div className="flex items-center space-x-3">
                  <input
                    type="file"
                    id="fileInput"
                    accept="video/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <label
                    htmlFor="fileInput"
                    className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg cursor-pointer transition-colors font-medium"
                  >
                    Choose File
                  </label>
                  {selectedFile && (
                    <span className="text-sm text-gray-600">
                      Selected: {selectedFile.name}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                Video Title (optional)
              </label>
              <input
                type="text"
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter video title (uses filename if empty)"
                className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}

            <div className="flex space-x-4 pt-4">
              <button
                type="submit"
                disabled={isUploading || !selectedFile}
                className={`flex-1 py-3 px-6 rounded-lg font-medium transition-colors ${
                  isUploading || !selectedFile
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isUploading ? 'Uploading...' : 'Upload Video'}
              </button>
              <button
                type="button"
                onClick={() => router.push('/')}
                className="px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}