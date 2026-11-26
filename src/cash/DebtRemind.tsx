import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Loading } from '../layout/Loading'
import { haptic, openLink } from '../lib/telegram'
import { whatsappUrl } from '../lib/texts'
import { dayMonth } from '../lib/debt'
import { todayIn } from '../lib/time'
import './debtors.css'

type Debt = Schemas['PaymentQueryDebt']

/**
 * «Напомнить о долге»: текст с суммой с сервера (свой шаблон клиники — «Настройки → Сообщения пациентам → Напоминание о долге»), как он
 * уйдёт пациенту, и кнопки: «📤 В Telegram» — бот отправит сам, «WhatsApp» — откроется с этим текстом. Текст здесь
 * не правят: сумма — только с сервера. Напоминали меньше 3 дней назад — кнопок нет, вместо них — когда можно снова.
 */
export function DebtRemindForm({ patientId, name, onDone }: { patientId: number; name?: string; onDone: () => void }) {
  const client = useQueryClient()
  const draft = useQuery({
    queryKey: ['debt-reminder', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/debt-reminder', { params: { path: { patientId } } })),
    gcTime: 0,
    retry: false,
  })
  const [sent, setSent] = useState('')
  const send = useMutation<Schemas['DebtRemindersSent'], ApiError, 'TELEGRAM' | 'WHATSAPP'>({
    mutationFn: (channel) => unwrap(api.POST('/api/patients/{patientId}/debt-reminder', {
      params: { path: { patientId } }, body: { channel },
    })),
    onSuccess: (result, channel) => {
      haptic('success')
      const phone = draft.data?.phone
      if (channel === 'WHATSAPP' && phone && result.text) openLink(whatsappUrl(phone, result.text))
      setSent(channel === 'TELEGRAM' ? 'Напоминание отправлено в Telegram' : 'Открыли WhatsApp с текстом напоминания')
      void client.invalidateQueries({ queryKey: ['debts'] })
    },
    onError: () => haptic('error'),
  })
  if (draft.isPending) return <Loading />
  if (draft.error) {
    return <div className="debt-remind"><p className="error" role="alert">{draft.error.message}</p>
      <button type="button" className="btn small" onClick={onDone}>Закрыть</button></div>
  }
  if (sent) {
    return <div className="debt-remind debt-sent"><p className="tone-ok" role="status">✅ {sent}</p>
      <button type="button" className="btn small" onClick={onDone}>Готово</button></div>
  }
  const d = draft.data
  const early = d.nextAt != null
  return (
    <form className="form debt-remind" aria-label={`Напоминание о долге${name ? `: ${name}` : ''}`} onSubmit={(e) => e.preventDefault()}>
      <p className="hint small">Так увидит пациент{d.lang === 'KY' ? ' (на кыргызском — выбрал в боте)' : ''}. Текст — в «Настройки → Сообщения пациентам → Напоминание о долге».</p>
      <p className="debt-bubble">{d.text}</p>
      {d.qr && d.telegram && <p className="hint small">📎 В Telegram следом уйдёт картинка QR для оплаты; в WhatsApp — ссылка на неё.</p>}
      {early ? (
        <p className="tone-wait" role="status">Уже напоминали {dayMonth(d.remindedAt!)} — снова можно с {dayMonth(d.nextAt!)}.
          Часто о деньгах писать неловко 🙏</p>
      ) : d.remindedAt && <p className="hint small">Последний раз напоминали {dayMonth(d.remindedAt)}.</p>}
      <div className="actions">
        {!early && d.telegram && (
          <button type="button" className="btn primary" disabled={send.isPending} onClick={() => send.mutate('TELEGRAM')}>📤 В Telegram</button>
        )}
        {!early && d.phone && (
          <button type="button" className={d.telegram ? 'btn' : 'btn primary'} disabled={send.isPending} onClick={() => send.mutate('WHATSAPP')}>WhatsApp</button>
        )}
        <button type="button" className="btn ghost" onClick={onDone}>{early ? 'Закрыть' : 'Отмена'}</button>
      </div>
      {!early && !d.telegram && !d.phone && <p className="hint small">Ни Telegram, ни телефона — напомните при встрече или позвоните.</p>}
      {send.error && <p className="error" role="alert">{send.error.message}</p>}
    </form>
  )
}

/**
 * «Обещал оплатить до…»: срок у всех долгов пациента, которые видит сотрудник. В этот день вечером, если долг не
 * закрыт, договорившемуся придёт задача «Проверить оплату».
 */
export function DebtPromiseForm({ patientId, dueOn, onDone }: { patientId: number; dueOn?: string; onDone: () => void }) {
  const client = useQueryClient()
  const [date, setDate] = useState(dueOn ?? '')
  const save = useMutation<Debt[], ApiError, string | null>({
    mutationFn: (value) => unwrap(api.PUT('/api/patients/{patientId}/debt-due', {
      params: { path: { patientId } }, body: { dueOn: value ?? undefined },
    })),
    onSuccess: () => {
      haptic('success')
      void client.invalidateQueries({ queryKey: ['debts'] })
      onDone()
    },
  })
  return (
    <form className="form debt-promise" aria-label="Обещал оплатить до" onSubmit={(e) => { e.preventDefault(); if (date) save.mutate(date) }}>
      <label className="field"><span>Обещал оплатить до</span>
        <input type="date" value={date} min={todayIn()} onChange={(e) => { save.reset(); setDate(e.target.value) }} /></label>
      <p className="hint small">В этот день, если долг не оплачен, вам придёт задача «Проверить оплату».</p>
      <div className="actions">
        <button type="submit" className="btn primary" disabled={!date || save.isPending}>Сохранить</button>
        {dueOn && <button type="button" className="btn" disabled={save.isPending} onClick={() => save.mutate(null)}>Убрать срок</button>}
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
      </div>
      {save.error && <p className="error" role="alert">{save.error.fieldErrors.dueOn ?? save.error.message}</p>}
    </form>
  )
}
