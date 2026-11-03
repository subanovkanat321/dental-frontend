import { useEffect, useState } from 'react'

import { fetchBlob } from '../api/client'

/** Миниатюра с сервера — через blob (нужен заголовок сайта), ссылка освобождается при уходе. */
export function Thumb({ path, alt }: { path: string; alt: string }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    let url: string | undefined
    let alive = true
    fetchBlob(path).then((blob) => {
      if (!alive) return
      url = URL.createObjectURL(blob)
      setSrc(url)
    }).catch(() => {})
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])
  return src ? <img src={src} alt={alt} /> : <span className="thumb-wait" aria-hidden="true">🩻</span>
}
