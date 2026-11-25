'use client'

import { useState, ChangeEvent, FormEvent } from 'react'
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

type Item = {
  id: number
  file: File
  title: string
  isSuggestingTitle: boolean
  progress: UploadProgress | null
  done: boolean
  error: string | null
}

let nextId = 0

async function suggestTitle(fileName: string): Promise<string | null> {
  try {
    const response = await apiFetch('/api/suggest-video-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName }),
    })
    if (response.ok) return (await response.json()).suggestedTitle
  } catch (err) {
    console.error('Failed to fetch title suggestion:', err)
  }
  return null
}

export default function UploadPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const update = (id: number, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    const next = files.map((file) => ({
      id: nextId++,
      file,
      title: '',
      isSuggestingTitle: true,
      progress: null,
      done: false,
      error: null,
    }))
    setItems(next)
    for (const it of next) {
      suggestTitle(it.file.name).then((title) =>
        setItems((prev) =>
          prev.map((p) =>
            p.id === it.id ? { ...p, isSuggestingTitle: false, title: p.title || title || '' } : p,
          ),
        ),
      )
    }
  }

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault()
    setIsUploading(true)
    let failed = false
    // One at a time: parallel PUTs would just split the same uplink bandwidth.
    for (const it of items) {
      if (it.done) continue
      update(it.id, { error: null, progress: { phase: 'hashing', fraction: 0 } })
      try {
        await uploadVideo(it.file, it.title, (progress) => update(it.id, { progress }))
        update(it.id, { done: true, progress: null })
      } catch (err) {
        failed = true
        console.error('Upload error:', err)
        update(it.id, {
          error: err instanceof Error ? err.message : 'アップロードに失敗しました',
          progress: null,
        })
      }
    }
    setIsUploading(false)
    if (!failed) router.push('/')
  }

  const pending = items.filter((it) => !it.done).length
  const canSubmit = !isUploading && pending > 0

  return (
    <div className="min-h-screen bg-gray-100">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-2">動画をアップロード</h2>
            <p className="text-gray-600">動画ファイルを選択するとブラウザでハッシュ化し、S3へ直接アップロードします（複数選択可）</p>
          </div>

          <form onSubmit={handleUpload} className="bg-white rounded-lg shadow-lg p-8 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">動画ファイル</label>
              <input type="file" id="fileInput" accept="video/*,.mkv" multiple onChange={handleFileSelect} className="hidden" disabled={isUploading} />
              <label htmlFor="fileInput" className="inline-block px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg cursor-pointer transition-colors font-medium">
                ファイルを選択
              </label>
            </div>

            {items.map((it) => (
              <div key={it.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
                <p className="text-sm text-gray-600 break-all">{it.file.name}</p>
                <div>
                  <label htmlFor={`title-${it.id}`} className="block text-sm font-medium text-gray-700 mb-1">
                    タイトル（任意）
                    {it.isSuggestingTitle && <span className="ml-2 text-sm text-blue-600">サジェスト中...</span>}
                  </label>
                  <input
                    type="text"
                    id={`title-${it.id}`}
                    value={it.title}
                    onChange={(e) => update(it.id, { title: e.target.value })}
                    placeholder={it.isSuggestingTitle ? '生成中...' : 'ファイル名を使用します'}
                    className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                    disabled={it.isSuggestingTitle || it.done || isUploading}
                  />
                </div>

                {it.progress && (
                  <div>
                    <div className="flex justify-between text-sm text-gray-600 mb-1">
                      <span>{PHASE_LABEL[it.progress.phase]}</span>
                      <span>{Math.round(it.progress.fraction * 100)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${Math.round(it.progress.fraction * 100)}%` }} />
                    </div>
                  </div>
                )}

                {it.done && <p className="text-sm text-green-700">アップロード完了</p>}

                {it.error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-700">{it.error}</p>
                  </div>
                )}
              </div>
            ))}

            <div className="flex space-x-4 pt-4">
              <button
                type="submit"
                disabled={!canSubmit}
                className={`flex-1 py-3 px-6 rounded-lg font-medium transition-colors ${
                  canSubmit ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {isUploading ? 'アップロード中...' : pending > 1 ? `${pending} 件をアップロード` : 'アップロード'}
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
