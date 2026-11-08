import type { Schemas } from '../api/client'

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
  return template.split(PLACEHOLDER).join(clinicName)
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
