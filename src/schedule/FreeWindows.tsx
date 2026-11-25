import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useSettings } from '../api/settings'
import { contactPhone } from '../lib/guardian'
import { freeSlotText, whatsappUrl } from '../lib/texts'
import { openLink } from '../lib/telegram'
import { plural } from '../lib/plural'
import { dateOf, minutesOf, shortDate, timeOf } from '../lib/time'
import { AttentionDialog } from './AttentionDialog'
import { fitsText, useFreeWindows, waitingCount, windowTitle, WINDOWS_KEY, type FreeWindow } from './windowsModel'

type Match = Schemas['WaitlistWindowsMatch']

/**
 * Подсказка в «Сводке дня»: «Освободилось 15:00–16:00 · подходят 2 пациента из листа ожидания» и «Предложить» — первые три
 * окна; «Предложить» открывает список с кнопками у каждого пациента.
 */
export function FreeWindowsHint({ windows, doctorName, onOffer }: { windows: FreeWindow[]; doctorName: (id: number) => string; onOffer: () => void }) {
  const open = windows.filter((w) => waitingCount(w) > 0).slice(0, 3)
  if (!open.length) return null
  return (
    <section className="ds-block fw-hint" aria-label="Освободилось окно">
      <h2 className="ds-title">Окна для листа ожидания</h2>
      {open.map((w) => (
        <div key={`${w.doctorId}-${w.start}`} className="fw-window">
          <span className="fw-window-head"><strong className="num">{windowTitle(w)}</strong><span className="hint small">{doctorName(w.doctorId)}</span></span>
          <span className="hint small">{fitsText(waitingCount(w))}</span>
          <button type="button" className="btn small primary" onClick={onOffer}>Предложить</button>
        </div>
      ))}
    </section>
  )
}

/** Окно со списком всех окон и «Предложить» у каждого подходящего пациента. */
export function FreeWindowsDialog({ doctorName, onBook, onClose }: {
  doctorName: (id: number) => string
  /** «Записать сюда» — «Новая запись» на это время: там «Подходит из листа ожидания» */
  onBook?: (doctorId: number, date: string, minutes: number) => void
  onClose: () => void
}) {
  const windows = useFreeWindows()
  // Окон больше двух — каждое свёрнуто строкой «время · врач · сколько подходят ›», раскрыть — пациенты и кнопки
  // (владелец 2026-11-25: «6 окон — каждое занимает весь экран в телефоне»). Одно-два — сразу раскрыты
  const [opened, setOpened] = useState<string | null>(null)
  const fold = (windows.data?.length ?? 0) > 2
  return (
    <AttentionDialog title="🔔 Окна для листа ожидания" labelId="free-windows-title" onClose={onClose}>
      {/* Коротко: на телефоне длинное пояснение занимало четверть экрана (владелец 2026-11-25: «окна неудобно в телефоне») */}
      <p className="hint small fw-lead">Сегодня и завтра · кто подходит по своему «Когда удобно». Пациент записывается сам кнопкой в боте или вы — «Записать».</p>
      {windows.isPending && <p className="hint">Загружаем…</p>}
      {windows.error && <p className="error" role="alert">{windows.error.message}</p>}
      {windows.data && !windows.data.length && <p className="tone-ok" role="status">Подходящих окон нет ✓</p>}
      <div className="attention-scroll">
        {windows.data?.map((w) => {
          const key = `${w.doctorId}-${w.start}`
          return <WindowCard key={key} w={w} doctorName={doctorName}
            collapsed={fold && opened !== key} onToggle={fold ? () => setOpened(opened === key ? null : key) : undefined}
            onBook={onBook && (() => { onClose(); onBook(w.doctorId, dateOf(w.start), minutesOf(w.start)) })} />
        })}
      </div>
    </AttentionDialog>
  )
}

/** Одно окно: заголовок и пациенты с «Предложить: В бот / WhatsApp». Тоже — в карточке отменённого приёма. */
export function WindowCard({ w, doctorName, onBook, collapsed = false, onToggle }: {
  w: FreeWindow
  doctorName: (id: number) => string
  onBook?: () => void
  /** Свёрнуто строкой: время, врач, сколько подходят — нажать, чтобы раскрыть */
  collapsed?: boolean
  onToggle?: () => void
}) {
  if (onToggle && collapsed) {
    return (
      <section className="fw-window folded" aria-label={windowTitle(w)}>
        <button type="button" className="fw-fold" aria-expanded={false} onClick={onToggle}>
          <span className="fw-window-head">
            <strong className="num">{windowTitle(w)}</strong>
            {/* Коротко — одной строкой: «Айгерим Т. · подходят 3» */}
            <span className="hint small">{doctorName(w.doctorId)} · {waitingCount(w) ? `${plural(waitingCount(w), 'подходит', 'подходят', 'подходят')} ${waitingCount(w)}` : 'все отказались'}</span>
          </span>
          <span className="fw-fold-caret" aria-hidden="true">›</span>
        </button>
      </section>
    )
  }
  return (
    <section className="fw-window" aria-label={windowTitle(w)}>
      {onToggle && <button type="button" className="link fw-unfold" aria-expanded onClick={onToggle}>Свернуть</button>}
      {/* «Записать на 14:00» — сразу в шапке окна (раньше — ссылкой в самом низу, после всех пациентов) */}
      <div className="fw-window-top">
        <span className="fw-window-head">
          <strong className="num">{windowTitle(w)}</strong>
          <span className="hint small">{doctorName(w.doctorId)} · {waitingCount(w) ? fitsText(waitingCount(w)) : 'все из листа отказались'}</span>
        </span>
        {onBook && <button type="button" className="btn small fw-book" onClick={onBook}>Записать на {timeOf(w.start)}</button>}
      </div>
      <ul className="fw-list">
        {w.matches.map((m) => <MatchRow key={m.entryId} m={m} doctorId={w.doctorId} />)}
      </ul>
    </section>
  )
}

function MatchRow({ m, doctorId }: { m: Match; doctorId: number }) {
  const client = useQueryClient()
  const settings = useSettings()
  const [done, setDone] = useState<'TELEGRAM' | 'WHATSAPP' | null>(null)
  const offer = useMutation<unknown, ApiError, 'TELEGRAM' | 'WHATSAPP'>({
    mutationFn: (channel) => unwrap(api.POST('/api/waitlist/{id}/offer', { params: { path: { id: m.entryId } }, body: { doctorId, startAt: m.startAt, channel } })),
    onSuccess: (_r, channel) => {
      setDone(channel)
      void client.invalidateQueries({ queryKey: WINDOWS_KEY })
      void client.invalidateQueries({ queryKey: ['waitlist'] })
    },
  })
  const whatsapp = () => {
    // Отметка «предложили» — не ждём ответа: WhatsApp открывается сразу
    offer.mutate('WHATSAPP')
    openLink(whatsappUrl(contactPhone(m.patient) ?? '', freeSlotText(m.patient.fullName, m.startAt, settings.data?.clinicSignature)))
  }
  const state = m.declined ? 'отказался' : done ? (done === 'TELEGRAM' ? '✓ отправили в бот' : '✓ WhatsApp открыт')
    : m.offeredAt ? `предложили ${timeOf(m.offeredAt)}${m.offeredVia === 'WHATSAPP' ? ' · WhatsApp' : ' · в бот'}` : null
  return (
    <li>
      <span className="fw-who">
        <strong>{m.patient.fullName}</strong>
        <span className="hint small">с {timeOf(m.startAt)} · {m.durationMinutes} мин{m.upcomingAt ? ` · записан ${shortDate(m.upcomingAt, true)}` : ''}
          {state && <> · <span className={m.declined ? 'tone-bad' : 'tone-ok'}>{state}</span></>}</span>
        {offer.error && <span className="error small" role="alert">{offer.error.message}</span>}
      </span>
      {!m.declined && (
        <span className="fw-actions">
          {m.patient.telegram && (
            <button type="button" className="btn small primary" disabled={offer.isPending}
              aria-label={`Предложить в бот: ${m.patient.fullName}`} onClick={() => offer.mutate('TELEGRAM')}>В бот</button>
          )}
          {contactPhone(m.patient) && (
            <button type="button" className={m.patient.telegram ? 'btn small' : 'btn small primary'} disabled={offer.isPending || !settings.data}
              aria-label={`Предложить в WhatsApp: ${m.patient.fullName}`} onClick={whatsapp}>💬 WhatsApp</button>
          )}
        </span>
      )}
    </li>
  )
}

/**
 * В карточке отменённого приёма (сегодня или завтра): «Освободилось 15:00–16:00 · подходят 2 пациента из листа ожидания» и
 * «Предложить» у каждого — то же окно, что в «🔔 Окна».
 */
export function FreedHere({ appointment: a, me }: { appointment: Schemas['AppointmentView']; me: Schemas['BookingViewsMe'] }) {
  const windows = useFreeWindows()
  const w = windows.data?.find((x) => x.doctorId === a.doctorId && x.start < a.endAt && x.end > a.startAt && waitingCount(x) > 0)
  if (!w) return null
  const name = (id: number) => (me.doctors ?? []).find((d) => d.id === id)?.fullName ?? ''
  return <WindowCard w={w} doctorName={name} />
}
