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

const VIDEO_NAME = 'Tish-rolik.mp4'

export type VideoResult = 'shared' | 'downloaded' | 'opened' | 'cancelled' | 'retry'

// Ролик в памяти — один на вкладку, а не на каждую клинику: скачиваем заранее (карточка открыта, текст
// ушёл), чтобы по нажатию «Поделиться» вызвать сразу, без ожидания сети
let video: File | null = null
let loading: Promise<File> | null = null

/** Скачать ролик в память заранее (повторный вызов — тот же файл). В Telegram не нужен: там ссылка. */
export function prepareVideo(): Promise<File> {
  if (video) return Promise.resolve(video)
  loading ??= fetchBlob(PROMO_VIDEO).then((blob) => (video = new File([blob], VIDEO_NAME, { type: 'video/mp4' })))
    .catch((e: unknown) => {
      loading = null
      throw e
    })
  return loading
}

/** Тесты: начать с пустой памяти. */
export function forgetVideo(): void {
  video = null
  loading = null
}

/** Умеет ли браузер «Поделиться» файлом (телефон); компьютер — обычно нет, тогда файл скачивается. */
export function canShareFiles(file = new File([''], VIDEO_NAME, { type: 'video/mp4' })): boolean {
  return typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [file] })
}

/** Ролик клинике: где «Поделиться» сработает, где скачается, где откроется ссылка — для подсказки шага 2. */
export function videoWay(): 'share' | 'download' | 'telegram' {
  return telegram() ? 'telegram' : canShareFiles() ? 'share' : 'download'
}

/**
 * «Отправить ролик» отдельным файлом: у незнакомого номера WhatsApp не делает ссылки кликабельными,
 * поэтому видео — вложением. Телефон: системное «Поделиться» с файлом — WhatsApp покажет чаты, тот, куда
 * только что ушёл текст, — первый в «Недавних» (выбрать контакт заранее «Поделиться» не умеет). Компьютер:
 * файл скачивается — прикрепить в WhatsApp Web. В Telegram (Mini App) «Поделиться» файлом нет — ролик
 * открывается в браузере телефона, оттуда «Поделиться».
 *
 * Не async нарочно: Safari на iPhone разрешает navigator.share только сразу по нажатию — долгий await перед
 * ним (скачивание ролика) «протухает» жест и share падает с NotAllowedError. Поэтому ролик готовят заранее
 * ({@link prepareVideo}), а здесь share зовётся синхронно из готового файла. Не успел скачаться — ждём и
 * пробуем; Safari откажет — 'retry': «Ролик готов — нажмите ещё раз».
 */
export function sendVideo(): Promise<VideoResult> {
  if (telegram()) {
    openLink(new URL(PROMO_VIDEO, window.location.origin).href)
    return Promise.resolve('opened')
  }
  return video ? shareOrDownload(video, false) : prepareVideo().then((file) => shareOrDownload(file, true))
}

function shareOrDownload(file: File, late: boolean): Promise<VideoResult> {
  if (canShareFiles(file)) {
    return navigator.share({ files: [file] }).then(() => 'shared' as const, (e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled' as const
      if (late && e instanceof DOMException && e.name === 'NotAllowedError') return 'retry' as const
      throw e
    })
  }
  const href = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = href
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
  return Promise.resolve('downloaded')
}
