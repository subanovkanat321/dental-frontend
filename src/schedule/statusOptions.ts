import type { Schemas } from '../api/client'
import type { ActionItem } from '../layout/ActionMenu'
import { cardStatusOf, type CardStatus } from './status'

type Appointment = Schemas['AppointmentView']

/** Что делает выбор статуса — те же действия, что раньше у отдельных кнопок карточки. */
export type StatusActions = {
  /** Заявку подтвердить, отменённую восстановить (POST …/status SCHEDULED) */
  schedule: () => void
  /** «Приём состоялся» / «Неявка» по ошибке — в запланированные (POST …/undo) */
  reopen: () => void
  /** Ответ пациента: «Подтвердил» или снять (POST …/reply) */
  reply: (confirmed: boolean) => void
  /** «Пришёл» или снять (POST …/arrived, V234) */
  arrive: (arrived: boolean) => void
  done: () => void
  noShow: () => void
  cancel: () => void
}

export type Option = Omit<ActionItem, 'label' | 'icon' | 'checked'> | null

/**
 * Какие статусы можно выбрать и что каждый делает. Нельзя — пункта нет (заявкой приём снова не станет)
 * или он серый с причиной («с дня приёма»). Права, время и оплату окончательно проверяет сервер:
 * его отказ (409) карточка покажет текстом.
 *
 * @param started день приёма наступил: «Пришёл», «Состоялся» и «Неявка» — с дня приёма (как на сервере)
 * @param paid оплата или счёт у приёма (видит тот, кому видны деньги): вернуть «Состоялся» нельзя — сначала снять оплату
 */
export function statusOptions(a: Appointment, { started, paid }: { started: boolean; paid: boolean }, act: StatusActions): Record<CardStatus, Option> {
  const now = cardStatusOf(a)
  const planned = now === 'scheduled' || now === 'confirmed' || now === 'arrived'
  const notYet = started ? undefined : 'с дня приёма'
  const onDay = (run: () => void): Option => ({ onSelect: run, disabled: !started, hint: notYet })
  return {
    request: null,
    scheduled: now === 'request' ? { onSelect: act.schedule, hint: 'подтвердить заявку' }
      : now === 'cancelled' ? { onSelect: act.schedule, hint: 'восстановить — напомните пациенту заново' }
        : now === 'confirmed' ? { onSelect: () => act.reply(false), hint: 'снять «Подтвердил»' }
          : now === 'arrived' ? { onSelect: () => act.arrive(false), hint: 'снять «Пришёл»' }
            : now === 'done' && paid ? { onSelect: () => {}, disabled: true, hint: 'вернуть нельзя: сначала «Снять отметку оплаты» в оплате' }
              : now === 'done' || now === 'noshow' ? { onSelect: act.reopen, hint: 'вернуть в запланированные' }
                : null,
    confirmed: now === 'scheduled' ? { onSelect: () => act.reply(true), hint: 'пациент ответил, что придёт' } : null,
    arrived: now === 'scheduled' || now === 'confirmed' ? onDay(() => act.arrive(true)) : null,
    done: planned ? onDay(act.done) : now === 'noshow' ? { onSelect: act.done, hint: 'исправить неявку' } : null,
    noshow: planned ? { ...onDay(act.noShow)!, danger: true } : now === 'done' ? { onSelect: act.noShow, danger: true, hint: 'исправить: пациент не пришёл' } : null,
    cancelled: now === 'request' ? { onSelect: act.cancel, danger: true, hint: 'отклонить заявку — пациенту придёт сообщение' }
      : planned ? { onSelect: act.cancel, danger: true, hint: 'время освободится' } : null,
  }
}
