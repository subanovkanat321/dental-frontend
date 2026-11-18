import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { api, unwrap, type Schemas } from '../api/client'
import { useBack } from '../lib/back'
import { agoText } from '../lib/texts'
import { useReviewAsks, useSendReview } from './reviewLinks'
import { dayTitle, dateOf, timeOf } from '../lib/time'
import './askReview.css'

type Appointment = Schemas['AppointmentView']
type Candidate = Schemas['ReviewLinksCandidate']

/**
 * Карточка приёма после «Приём состоялся»: кнопка или почему её нет (просили недавно). Уже оценил, бот спросил
 * сам, приём давно — ничего: лишняя строка в карточке не нужна.
 */
export function AskReview({ appointment: a }: { appointment: Appointment }) {
  const draft = useQuery({
    queryKey: ['review-link', a.id],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/review-link', { params: { path: { id: a.id } } })),
    retry: false,
  })
  const send = useSendReview()
  const d = draft.data
  if (!d) return null
  if (!d.available) {
    return d.reason === 'recent' ? <p className="hint small ask-review-wait" role="note">⭐ {d.message}</p> : null
  }
  return (
    <div className="ask-review">
      <button type="button" className="btn" disabled={send.isPending} onClick={() => send.mutate(a.id)}
        title="Откроется WhatsApp с текстом и ссылкой: пациент оценит приём одним нажатием">
        {d.askedAt ? '⭐ Отправить ссылку ещё раз' : '⭐ Попросить оценку'}
      </button>
      {d.askedAt && <span className="hint small">Попросили {agoText(d.askedAt)}, в {timeOf(d.askedAt)}</span>}
      {send.error && <p className="error" role="alert">{send.error.message}</p>}
    </div>
  )
}

/**
 * «💬 Попросить отзыв у N пациентов без Telegram ›» — тихая строка под расписанием сегодняшнего дня: дело не
 * срочное, в полосе «Требует внимания» «⭐ 4» читалось как оценка 4.
 */
export function ReviewAsksChip({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (!count) return null
  const who = count === 1 ? 'пациента' : 'пациентов'
  return (
    <button type="button" className="link ask-review-line" onClick={onOpen}
      aria-label={`Попросить отзыв у ${count} ${who} без Telegram`}>
      💬 Попросить отзыв у {count} {who} без Telegram ›
    </button>
  )
}

/**
 * Список «Попросите оценку»: по кнопке у каждого — WhatsApp с текстом и ссылкой. Массовой отправки нет: каждое
 * сообщение уходит своим нажатием, как остальные WhatsApp-кнопки.
 */
export function ReviewAsksDialog({ doctorName, onClose }: { doctorName: (id: number) => string; onClose: () => void }) {
  const asks = useReviewAsks(true)
  const send = useSendReview()
  // Отправленные — остаются в списке с «✓», пока окно открыто (сервер их уже не вернёт)
  const [sent, setSent] = useState<Candidate[]>([])
  useBack(onClose)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    box.current?.focus()
    return () => back?.focus?.()
  }, [])
  const rows = [...(asks.data ?? []), ...sent.filter((s) => !asks.data?.some((a) => a.appointmentId === s.appointmentId))]
    .sort((x, y) => x.startAt.localeCompare(y.startAt))
  const done = new Set(sent.map((s) => s.appointmentId))

  return createPortal(
    <div className="ui-select-backdrop confirm-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ask-review-title" className="confirm ask-review-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}>
        <h2 id="ask-review-title">⭐ Попросите оценку</h2>
        <p className="hint">Пациенты без Telegram — бот их не спросит. Откроется WhatsApp с текстом и ссылкой: пациент оценит приём
          одним нажатием и увидит ссылку на отзыв в 2ГИС / Google.</p>
        {asks.isPending && <p className="hint">Загружаем…</p>}
        {asks.error && <p className="error" role="alert">{asks.error.message}</p>}
        {asks.data && rows.length === 0 && <p className="tone-ok" role="status">Всех попросили ✓</p>}
        <ul className="ask-review-list">
          {rows.map((c) => (
            <li key={c.appointmentId}>
              <span className="ask-review-who">
                <strong>{c.patient.fullName}</strong>
                <span className="hint small">{dayTitle(dateOf(c.startAt))}, {timeOf(c.startAt)} · {doctorName(c.doctorId)}</span>
              </span>
              {done.has(c.appointmentId) ? <span className="tone-ok small">✓ WhatsApp открыт</span> : (
                <button type="button" className="btn small" disabled={send.isPending}
                  aria-label={`WhatsApp: попросить оценку — ${c.patient.fullName}`}
                  onClick={() => send.mutate(c.appointmentId, { onSuccess: () => setSent((s) => [...s, c]) })}>WhatsApp</button>
              )}
            </li>
          ))}
        </ul>
        {send.error && <p className="error" role="alert">{send.error.message}</p>}
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
