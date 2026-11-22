import { upload } from '../api/client'
import type { SheetImage } from './SheetSend'

/**
 * «📷 Отправить листом» у плана лечения: картинка — в бот пациенту (POST …/plan/send-image, multipart, сервер шлёт фото и
 * не хранит его), иначе «Поделиться» или «Скачать». Имя файла — без имени пациента.
 */
export function planImage(patientId: number): SheetImage {
  return {
    fileName: 'plan-lecheniya.png',
    send: (png) => {
      const body = new FormData()
      body.append('image', png, 'plan.png')
      return upload(`/api/patients/${patientId}/plan/send-image`, body)
    },
  }
}
