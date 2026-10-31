import { shortDate, somText, todayIn } from './time'

/** Строка долга: срок «доплатит до», просрочен — красным. */
export function debtLine(a: { debtSom?: number; dueOn?: string }, today = todayIn()): { text: string; tone: 'wait' | 'bad' } | null {
  if (!a.debtSom || a.debtSom <= 0) return null
  const sum = `Долг ${somText(a.debtSom)}`
  if (!a.dueOn) return { text: sum, tone: 'wait' }
  const due = shortDate(`${a.dueOn}T12:00:00Z`)
  if (a.dueOn < today) return { text: `${sum} · просрочен с ${due}`, tone: 'bad' }
  if (a.dueOn === today) return { text: `${sum} · доплатит сегодня`, tone: 'wait' }
  return { text: `${sum} · доплатит до ${due}`, tone: 'wait' }
}
