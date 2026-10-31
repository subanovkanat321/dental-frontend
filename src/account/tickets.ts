import { resizePhoto } from '../medical/thumb'

/**
 * Тело обращения — полями формы, а не в адресе: текст не попадает в логи сервера и прокси.
 * Скриншот — до 1600 px: текст на экране читается, а файл лёгкий.
 */
export async function ticketForm(fields: Record<string, string>, file: File | null): Promise<FormData> {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  if (file) form.append('file', await resizePhoto(file, 1600, 0.85), 'screenshot.jpg')
  return form
}
