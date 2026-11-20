import type { Schemas } from '../api/client'
import type { NextStep } from './statusOptions'

type Appointment = Schemas['AppointmentView']

/**
 * Главное действие карточки приёма — одно на состояние (UX-аудит 2026-11-20, «Главное действие по состоянию»):
 * - `step` — следующий шаг цепочки: «Подтвердить» → «Пришёл» → «Начать приём» → «Приём состоялся»;
 * - `remind` — запись на будущий день, ещё не напомнили: «Напомнить» (бот или WhatsApp);
 * - `reply` — напомнили, пациент не ответил: «Подтвердил»;
 * - `pay` — приём состоялся, оплата не отмечена: «Принять оплату»;
 * - `extra` — оплачен с долгом: «Принять доплату»;
 * - `next-visit` — оплачен полностью: «Записать на следующий визит»;
 * - `book-again` — неявка или отмена: «Записать снова».
 * Нет главного — `null`: внизу только «⋯».
 */
export type MainKind = 'step' | 'remind' | 'reply' | 'pay' | 'extra' | 'next-visit' | 'book-again'

export function mainActionKind(a: Appointment, ctx: {
  step: NextStep | null
  /** Оплата не отмечена и вам видны деньги приёма */
  payPending: boolean
  /** Долг за этот приём и вам видны деньги приёма */
  debt: boolean
  /** Можно открыть «Новую запись» на этого пациента */
  canBook: boolean
  /** Есть куда напомнить (бот или номер) и приём ещё не прошёл */
  canRemind: boolean
  /** Регистратура смотрит чужой приём: пациент в кресле — главной нет, «Приём состоялся» отмечает врач */
  waitsDoctor: boolean
}): MainKind | null {
  if (ctx.step) {
    if (ctx.step.kind === 'done' && a.inChairAt && ctx.waitsDoctor) return null
    return 'step'
  }
  switch (a.status) {
    case 'SCHEDULED':
      if (a.arrivedAt || a.inChairAt || a.reply === 'CONFIRMED') return null
      if (a.reminderOpenedAt) return a.reply && a.reply !== 'NONE' && a.reply !== 'NO_ANSWER' ? null : 'reply'
      return ctx.canRemind ? 'remind' : null
    case 'DONE':
      if (ctx.payPending) return 'pay'
      if (ctx.debt) return 'extra'
      return ctx.canBook ? 'next-visit' : null
    case 'NO_SHOW':
    case 'CANCELLED':
      return ctx.canBook ? 'book-again' : null
    default:
      return null
  }
}

/** На компьютере главная — рядом с пилюлей статуса; оплата и следующий визит — в своём блоке ленты (одна кнопка). */
export function mainInFeed(kind: MainKind | null): boolean {
  return kind === 'pay' || kind === 'extra' || kind === 'next-visit'
}
