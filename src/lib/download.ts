import { fetchBlob } from '../api/client'

/** Скачать файл с сервера (PDF договора, счёт, скан): с заголовком CRM, как картинки снимков. */
export async function download(path: string, fileName: string): Promise<void> {
  const url = URL.createObjectURL(await fetchBlob(path))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
