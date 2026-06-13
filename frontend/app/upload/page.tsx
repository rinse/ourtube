'use client'

import { useState, ChangeEvent, FormEvent, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Header from '../components/Header'
import { apiFetch } from '../lib/api'
import { uploadVideo, UploadProgress } from '../lib/upload'

const PHASE_LABEL: Record<UploadProgress['phase'], string> = {
  hashing: 'ハッシュ計算中',
  requesting: 'アップロード準備中',
  uploading: 'アップロード中',
  finalizing: '変換開始中',
}

export default function UploadPage() {
  const router = useRouter()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSuggestingTitle, setIsSuggestingTitle] = useState(false)

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setError(null)
      setTitle('')
    }
  }

  // Fetch a title suggestion when a file is selected.
  useEffect(() => {
    if (!selectedFile || title) return
    const fetchTitleSuggestion = async () => {
      setIsSuggestingTitle(true)
      try {
        const response = await apiFetch('/api/suggest-video-title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: selectedFile.name }),
        })
        if (response.ok) {
          const data = await response.json()
          setTitle(data.suggestedTitle)
        }
      } catch (err) {
        console.error('Failed to fetch title suggestion:', err)
      } finally {
        setIsSuggestingTitle(false)
      }
    }
    fetchTitleSuggestion()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile])

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!selectedFile) {
      setError('動画ファイルを選択してください')
      return
    }
    setIsUploading(true)
    setProgress({ phase: 'hashing', fraction: 0 })
    try {
      await uploadVideo(selectedFile, title, setProgress)
      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アップロードに失敗しました')
      console.error('Upload error:', err)
    } finally {
      setIsUploading(false)
      setProgress(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-2">動画をアップロード</h2>
            <p className="text-gray-600">動画ファイルを選択するとブラウザでハッシュ化し、S3へ直接アップロードします</p>
          </div>

          <form onSubmit={handleUpload} className="bg-white rounded-lg shadow-lg p-8 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">動画ファイル</label>
              <div className="flex items-center space-x-3">
                <input type="file" id="fileInput" accept="video/*,.mkv" onChange={handleFileSelect} className="hidden" />
                <label htmlFor="fileInput" className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg cursor-pointer transition-colors font-medium">
                  ファイルを選択
                </label>
                {selectedFile && (
                  <span className="text-sm text-gray-600">{selectedFile.name}</span>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                タイトル（任意）
                {isSuggestingTitle && <span className="ml-2 text-sm text-blue-600">サジェスト中...</span>}
              </label>
              <input
                type="text"
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isSuggestingTitle ? '生成中...' : 'ファイル名を使用します'}
                className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                disabled={isSuggestingTitle}
              />
            </div>

            {progress && (
              <div>
                <div className="flex justify-between text-sm text-gray-600 mb-1">
                  <span>{PHASE_LABEL[progress.phase]}</span>
                  <span>{Math.round(progress.fraction * 100)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
                </div>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-700">{error}</p>
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
                {isUploading ? 'アップロード中...' : 'アップロード'}
              </button>
              <button
                type="button"
                onClick={() => router.push('/')}
                className="px-6 py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
              >
                キャンセル
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
