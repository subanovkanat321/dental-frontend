/**
 * Снимок перед загрузкой — как в приложении: JPEG не больше size px по длинной стороне. Снимок
 * целиком — 2560, миниатюра для списка — 400 (сервер отдаёт её по ?thumb=true). Фото с телефона
 * в 12 Мп так весит ~1 МБ вместо 5–8 и укладывается в лимит сервера (8 МБ).
 */
export async function resizePhoto(file: Blob, size: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('resize'))), 'image/jpeg', quality))
}
