import { useEffect, useState } from 'react'

import { fetchBlob } from '../api/client'

/**
 * Картинка с сервера (QR, чек, скриншот) для <img>: с заголовком CRM, URL освобождается сам.
 * null — ещё грузится или path не задан; 'error' — не получилось.
 */
export function useBlobUrl(path: string | null): { url: string; type: string } | null | 'error' {
  const [state, setState] = useState<{ path: string; value: { url: string; type: string } | 'error' } | null>(null)
  useEffect(() => {
    if (!path) return
    let url: string | null = null
    let alive = true
    fetchBlob(path)
      .then((blob) => {
        url = URL.createObjectURL(blob)
        if (alive) setState({ path, value: { url, type: blob.type } })
      })
      .catch(() => alive && setState({ path, value: 'error' }))
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])
  return path && state?.path === path ? state.value : null
}
