import { fetchBlob, type Schemas } from '../api/client'
import { openLink, telegram } from '../lib/telegram'

export type OutreachLead = Schemas['SalesFunnelLead']
export type Group = 'FRESH' | 'SENT' | 'FURTHER' | 'DECLINED'

export const PLACEHOLDER = '{клиника}'

/** Группы списка по этапу воронки: не писали, написали, ответили и дальше, отказались. */
export const GROUPS: [Group, string][] = [['FRESH', 'Не писали'], ['SENT', 'Написали'], ['FURTHER', 'Ответили/дальше'], ['DECLINED', 'Отказались']]

export function groupOf(lead: OutreachLead): Group {
  switch (lead.stage) {
    case 'LEAD': return 'FRESH'
    case 'CONTACTED': return 'SENT'
    case 'LOST': return 'DECLINED'
    default: return 'FURTHER'
  }
}

/** Текст первого сообщения клинике: {клиника} → её название (везде, где встретится). */
export function messageFor(template: string, clinicName: string): string {
  // Адрес сайта без https:// (в старом сохранённом тексте) — с https://: так WhatsApp делает его ссылкой
  return template.split(PLACEHOLDER).join(clinicName).replace(/(^|[\s(«"])(tish\.kg(?:\/\S*)?)/g, '$1https://$2')
}

/** Кому можно написать: ещё не писали, не просили не беспокоить, есть телефон или ссылка. */
export function writable(lead: OutreachLead): boolean {
  return lead.stage === 'LEAD' && Boolean(lead.phone || lead.link)
}

/**
 * «Следующая клиника»: первая неписаная после текущей по порядку списка (как загружали), а с конца —
 * снова сначала. Текущая ушла из списка (её отметили, фильтр «Не писали») — первая неписаная.
 */
export function nextLead(leads: OutreachLead[], currentId: number | null): OutreachLead | null {
  const candidates = leads.filter(writable)
  if (!candidates.length) return null
  const from = currentId == null ? -1 : leads.findIndex((l) => l.id === currentId)
  if (from < 0) return candidates[0]!
  return leads.slice(from + 1).find(writable) ?? candidates.find((l) => l.id !== currentId) ?? null
}


/** Публичный промо-ролик (бэкенд, /web/materials/public — без входа) — под этим именем уходит клинике. */
export const PROMO_VIDEO = '/web/materials/public/promo.mp4'

/**
 * «Отправить ролик» отдельным файлом: у незнакомого номера WhatsApp не делает ссылки кликабельными,
 * поэтому видео — вложением. Телефон: системное «Поделиться» с файлом (выбрать WhatsApp и чат клиники).
 * Компьютер: файл скачивается — прикрепить в WhatsApp Web. В Telegram (Mini App) «Поделиться» файлом нет —
 * ролик открывается в браузере телефона, оттуда «Поделиться».
 */
export async function shareVideo(): Promise<'shared' | 'downloaded' | 'opened' | 'cancelled'> {
  if (telegram()) {
    openLink(new URL(PROMO_VIDEO, window.location.origin).href)
    return 'opened'
  }
  const blob = await fetchBlob(PROMO_VIDEO)
  const file = new File([blob], 'Tish-rolik.mp4', { type: 'video/mp4' })
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      throw e
    }
  }
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
  return 'downloaded'
}
