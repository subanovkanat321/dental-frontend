import type { Schemas } from '../api/client'
import type { ActionItem } from '../layout/ActionMenu'
import { cardStatusOf, type CardStatus } from './status'

type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']
export type Reply = NonNullable<Appointment['reply']>

/**
 * Клиника отмечает приход пациента — «Пришёл» и «В кресле» (V245, «Настройки → Приём → Отметки приёма»). По умолчанию
 * нет: большинству клиник нужен только итог — «Приём состоялся» или «Неявка». Старые отметки у записей видны всегда,
 * выключено — их просто не предлагают.
 */
export function marksArrival(me: Pick<Me, 'clinic'> | null | undefined): boolean {
  return Boolean(me?.clinic?.markArrival)
}

/** Что делает выбор статуса — те же действия, что раньше у отдельных кнопок карточки. */
export type StatusActions = {
  /** Заявку подтвердить, отменённую восстановить (POST …/status SCHEDULED) */
  schedule: () => void
  /** «Приём состоялся» / «Неявка» по ошибке — в запланированные (POST …/undo) */
  reopen: () => void
  /** Ответ пациента: «Подтвердил», «Просит перенести», «Нет ответа» или снять — NONE (POST …/reply) */
  reply: (reply: Reply) => void
  /** «Пришёл» или снять (POST …/arrived, V234) */
  arrive: (arrived: boolean) => void
  /** «В кресле» — «Начать приём» — или снять (POST …/in-chair, V235) */
  seat: (inChair: boolean) => void
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
 * @param started день приёма наступил: «Пришёл», «В кресле», «Состоялся» и «Неявка» — с дня приёма (как на сервере)
 * @param paid оплата или счёт у приёма (видит тот, кому видны деньги): вернуть «Состоялся» нельзя — сначала снять оплату
 * @param arrivals клиника отмечает приход (marksArrival); нет — «Пришёл» и «В кресле» не предлагаем: в списке
 * Записан · Подтвердил · Просит перенести · Нет ответа · Приём состоялся · Неявка · Отменён (старая отметка — только
 * текущим пунктом ✓)
 */
export function statusOptions(a: Appointment, { started, paid, arrivals }: { started: boolean; paid: boolean; arrivals: boolean },
  act: StatusActions): Record<CardStatus, Option> {
  const now = cardStatusOf(a)
  // До прихода — «Записан» или ответ пациента; его меняют пункты списка (reply), как раньше ряд «Подтвердил / Перенос / Нет ответа»
  const waiting = now === 'scheduled' || now === 'confirmed' || now === 'reschedule' || now === 'noanswer'
  const planned = waiting || now === 'arrived' || now === 'chair'
  const answer = (reply: Reply, hint: string): Option => (waiting ? { onSelect: () => act.reply(reply), hint } : null)
  const notYet = started ? undefined : 'с дня приёма'
  const onDay = (run: () => void): Option => ({ onSelect: run, disabled: !started, hint: notYet })
  return {
    request: null,
    scheduled: now === 'request' ? { onSelect: act.schedule, hint: 'подтвердить заявку' }
      : now === 'cancelled' ? { onSelect: act.schedule, hint: 'восстановить — напомните пациенту заново' }
        : now === 'confirmed' ? { onSelect: () => act.reply('NONE'), hint: 'снять «Подтвердил»' }
          : now === 'reschedule' ? { onSelect: () => act.reply('NONE'), hint: 'снять «Просит перенести»' }
          : now === 'noanswer' ? { onSelect: () => act.reply('NONE'), hint: 'снять «Нет ответа»' }
          : now === 'arrived' ? { onSelect: () => act.arrive(false), hint: 'снять «Пришёл»' }
            : now === 'chair' ? { onSelect: () => act.arrive(false), hint: 'снять «Пришёл» и «В кресле»' }
            : now === 'done' && paid ? { onSelect: () => {}, disabled: true, hint: 'вернуть нельзя: сначала «Снять отметку оплаты» в оплате' }
              : now === 'done' || now === 'noshow' ? { onSelect: act.reopen, hint: 'вернуть в запланированные' }
                : null,
    confirmed: answer('CONFIRMED', 'пациент ответил, что придёт'),
    reschedule: answer('RESCHEDULE', 'пациент просит другое время'),
    noanswer: answer('NO_ANSWER', 'не дозвонились, не ответил на напоминание'),
    arrived: !arrivals ? null
      : waiting ? onDay(() => act.arrive(true))
        : now === 'chair' ? { onSelect: () => act.seat(false), hint: 'снять «В кресле» — ждёт приёма' } : null,
    // «В кресле» — приём начался; «Пришёл» сервер поставит сам, если его не отмечали
    chair: arrivals && (waiting || now === 'arrived') ? onDay(() => act.seat(true)) : null,
    done: planned ? onDay(act.done) : now === 'noshow' ? { onSelect: act.done, hint: 'исправить неявку' } : null,
    noshow: planned ? { ...onDay(act.noShow)!, danger: true } : now === 'done' ? { onSelect: act.noShow, danger: true, hint: 'исправить: пациент не пришёл' } : null,
    cancelled: now === 'request' ? { onSelect: act.cancel, danger: true, hint: 'отклонить заявку — пациенту придёт сообщение' }
      : planned ? { onSelect: act.cancel, danger: true, hint: 'время освободится' } : null,
  }
}

/** Следующий шаг приёма одним касанием: заявка → подтвердить, (пришёл, начать приём — если клиника отмечает приход), приём состоялся. */
export type NextStep = { kind: 'confirm' | 'arrive' | 'seat' | 'done'; label: string; icon: string }

/**
 * Какой шаг следующий — одна логика для кнопки рядом с пилюлей статуса в карточке и для меню быстрых действий на
 * записи в расписании: заявка → «Подтвердить»; в день приёма — сразу «Приём состоялся» (клиника не отмечает приход,
 * по умолчанию) или цепочка: до прихода → «Пришёл», пришёл → «Начать приём» (В кресле), в кресле (или время приёма
 * уже прошло — отмечать приход поздно) → «Приём состоялся». Будущий приём — шага нет (статусы «с дня приёма», как на
 * сервере); без прав — тоже.
 *
 * @param started день приёма наступил
 * @param ended время приёма уже прошло
 * @param arrivals клиника отмечает приход (marksArrival)
 */
export function nextStep(a: Appointment, { canEdit, started, ended, arrivals }: { canEdit: boolean; started: boolean; ended: boolean; arrivals: boolean }): NextStep | null {
  if (!canEdit) return null
  if (a.status === 'REQUESTED') return { kind: 'confirm', label: 'Подтвердить', icon: '✅' }
  if (a.status !== 'SCHEDULED' || !started) return null
  if (!arrivals) return { kind: 'done', label: 'Приём состоялся', icon: '✅' }
  if (!a.arrivedAt && !a.inChairAt && !ended) return { kind: 'arrive', label: 'Пришёл', icon: '🟢' }
  if (a.arrivedAt && !a.inChairAt && !ended) return { kind: 'seat', label: 'Начать приём', icon: '💺' }
  return { kind: 'done', label: 'Приём состоялся', icon: '✅' }
}
