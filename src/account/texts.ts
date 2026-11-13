import type { Schemas } from '../api/client'
import { shortDate } from '../lib/time'

/** Подписи и разбор текста раздела «Аккаунт» — как в приложении (state.js бэкенда). */

type Billing = Schemas['ClinicBillingBilling']

/** Оплата клиники одной строкой: бесплатно — спокойно; 7 дней и меньше — жёлтое; отсрочка и пауза — красное. */
export function billingLine(b?: Billing | null): { text: string; tone: 'hint' | 'ok' | 'wait' | 'bad' } {
  if (!b || b.state === 'FREE') return { text: 'бесплатно (пилот)', tone: 'hint' }
  const until = b.paidUntil ? shortDate(`${b.paidUntil}T12:00:00Z`) : ''
  if (b.state === 'PAUSED') return { text: `новые записи на паузе — оплата закончилась ${until}`, tone: 'bad' }
  if (b.state === 'GRACE') return { text: `оплата закончилась ${until}, пауза с ${b.pausesOn ? shortDate(`${b.pausesOn}T12:00:00Z`) : ''}`, tone: 'bad' }
  if (b.daysLeft === 0) return { text: `оплачено до ${until} — последний день`, tone: 'wait' }
  return { text: `оплачено до ${until}`, tone: (b.daysLeft ?? 99) <= 7 ? 'wait' : 'ok' }
}

export const PAY_PERIOD_TEXT: Record<number, string> = { 1: '1 месяц', 3: '3 месяца', 6: '6 месяцев', 12: 'Год' }

type Block = { type: 'heading' | 'note' | 'item' | 'para'; text: string }

/**
 * Текст договора (простая разметка шаблона) → блоки: «#» — заголовок, «> » — примечание,
 * «- » — пункт, остальное — абзац; «**жирный**» — просто текст. Без HTML.
 */
export function agreementBlocks(body: string): Block[] {
  return body.split('\n').map((raw) => raw.trimEnd()).filter((line) => line.trim() !== '').map((line) => {
    const text = line.replace(/\*\*(.+?)\*\*/g, '$1')
    if (/^#{1,3} /.test(text)) return { type: 'heading', text: text.replace(/^#{1,3} /, '') }
    if (text.startsWith('> ')) return { type: 'note', text: text.slice(2) }
    if (/^\s*- /.test(text)) return { type: 'item', text: text.replace(/^\s*- /, '') }
    return { type: 'para', text: text.trim() }
  })
}

/** Как на сервере: {{clinic.name}} → значение; чего нет — линия для заполнения от руки. */
export function fillAgreement(body: string, values: Record<string, unknown>): string {
  return body.replace(/\{\{\s*([a-z.]+)\s*\}\}/g, (_, key: string) => {
    const v = values[key]
    return v != null && String(v).trim() ? String(v).trim() : '________________'
  })
}

export type AgreementForm = {
  clinicName: string; clinicInn: string; clinicAddress: string; signerName: string; signerPosition: string; signerBasis: string
}

/** Значения для подстановки в договор — как на сервере (Agreements.values). */
export function agreementValues(platform: Record<string, unknown> | undefined, f: AgreementForm, date: string): Record<string, unknown> {
  return {
    ...platform, date,
    'clinic.name': f.clinicName, 'clinic.inn': f.clinicInn, 'clinic.address': f.clinicAddress,
    'signer.name': f.signerName, 'signer.position': f.signerPosition, 'signer.basis': f.signerBasis,
  }
}

/**
 * Тип обращения в «Написать в Tish» — одна форма для всего (раньше три кнопки: вопрос, проблема, идея). Ключи — Kind
 * бэкенда (SupportTickets); порядок — как в выборе формы. Тип видит и владелец платформы («Платформа → Обращения»).
 */
export const TICKET_KINDS: Record<string, { title: string; emoji: string; hint: string }> = {
  QUESTION: { title: 'Вопрос', emoji: '❓', hint: 'Что хотите узнать или как сделать?' },
  PROBLEM: { title: 'Что-то не работает', emoji: '⚠️', hint: 'Что делали, что ожидали и что случилось — и на каком экране' },
  IDEA: { title: 'Идея', emoji: '💡', hint: 'Что сделать удобнее или добавить?' },
}

/** Тип обращения одной строкой: «⚠️ Что-то не работает». */
export function ticketKind(kind?: string | null): string {
  const k = TICKET_KINDS[kind ?? 'QUESTION'] ?? TICKET_KINDS.QUESTION!
  return `${k.emoji} ${k.title}`
}

export const TICKET_STATUS: Record<string, [string, string]> = { OPEN: ['ждёт ответа', 's-wait'], ANSWERED: ['есть ответ', 's-ok'], CLOSED: ['закрыто', 's-quiet'] }
