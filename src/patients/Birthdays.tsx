import '../schedule/attention.css'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { contactPhone } from '../lib/guardian'
import { whatsappUrl } from '../lib/texts'
import { openLink } from '../lib/telegram'
import { timeOf } from '../lib/time'
import { AttentionDialog } from '../schedule/AttentionDialog'
import { BIRTHDAYS_KEY, notGreeted, useBirthdays } from './birthdaysModel'

type Row = Schemas['BirthdaysRow']
type Lang = Schemas['BirthdaysGreeting']['lang']

/** «🎂 2 дня рождения» в полосе «Требует внимания»: пока кого-то не поздравили. */
export function BirthdaysChip({ rows, compact, onOpen }: { rows: Row[] | undefined; compact?: boolean; onOpen: () => void }) {
  const left = notGreeted(rows)
  if (!left) return null
  return (
    <button type="button" className="stat s-wait" onClick={onOpen} aria-label={`Сегодня день рождения: ${rows!.length} — поздравить`}
      title="Дни рождения сегодня — поздравить">
      🎂 {compact ? <b>{left}</b> : <>Дни рождения: <b>{rows!.length}</b></>}
    </button>
  )
}

export function BirthdaysDialog({ onClose, onOpen }: { onClose: () => void; onOpen?: (patientId: number) => void }) {
  return (
    <AttentionDialog title="🎂 Сегодня день рождения" labelId="birthdays-title" onClose={onClose}>
      <BirthdayList onOpen={onOpen && ((id) => { onClose(); onOpen(id) })} />
    </AttentionDialog>
  )
}

/**
 * Список именинников с «Поздравить»: в бот (пациент в боте) или WhatsApp — готовый тёплый текст на выбранном языке с названием
 * клиники и промокодом (если руководитель его выбрал). Текст собирает сервер; поздравили — «✓» до конца дня.
 */
export function BirthdayList({ onOpen }: { onOpen?: (patientId: number) => void }) {
  const list = useBirthdays()
  const [lang, setLang] = useState<Lang>('RU')
  if (list.isPending) return <p className="hint">Загружаем…</p>
  if (list.error) return <p className="error" role="alert">{list.error.message}</p>
  if (!list.data.items.length) return <p className="hint">Сегодня именинников нет.</p>
  return (
    <div className="attention-scroll">
      <div className="bd-lang hint small">
        <span>Текст в WhatsApp:</span>
        <span className="segments" role="group" aria-label="Язык поздравления">
          {(['RU', 'KY'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l === 'RU' ? 'Русский' : 'Кыргызча'}</button>
          ))}
        </span>
        {list.data.promoCode && <span>· промокод в подарок: <b>{list.data.promoCode}</b></span>}
      </div>
      <ul className="bd-list" aria-label="Сегодня день рождения">
        {list.data.items.map((r) => <BirthdayRow key={r.patient.id} r={r} lang={lang} onOpen={onOpen} />)}
      </ul>
    </div>
  )
}

/** «исполняется 30». */
function ageText(age: number): string {
  return `исполняется ${age}`
}

function BirthdayRow({ r, lang, onOpen }: { r: Row; lang: Lang; onOpen?: (patientId: number) => void }) {
  const client = useQueryClient()
  const greet = useMutation<Schemas['BirthdaysGreeting'], ApiError, 'TELEGRAM' | 'WHATSAPP'>({
    mutationFn: (channel) => unwrap(api.POST('/api/birthdays/{patientId}/greet', { params: { path: { patientId: r.patient.id } }, body: { channel, lang } })),
    onSuccess: (g) => {
      const phone = contactPhone(r.patient)
      if (g.text && phone) openLink(whatsappUrl(phone, g.text))
      void client.invalidateQueries({ queryKey: BIRTHDAYS_KEY })
    },
  })
  const greeted = r.greetedAt ? `✓ поздравили ${timeOf(r.greetedAt)}${r.greetedVia === 'WHATSAPP' ? ' · WhatsApp' : r.greetedVia === 'AUTO' ? ' · бот сам' : ' · в бот'}` : null
  return (
    <li>
      <span className="bd-who">
        {onOpen ? <button type="button" className="link" onClick={() => onOpen(r.patient.id)}><strong>{r.patient.fullName}</strong></button>
          : <strong>{r.patient.fullName}</strong>}
        <span className="hint small">{ageText(r.age)}{greeted && <> · <span className="tone-ok">{greeted}</span></>}</span>
        {greet.error && <span className="error small" role="alert">{greet.error.message}</span>}
      </span>
      {!r.greetedAt && (
        <span className="bd-actions">
          {r.patient.telegram && (
            <button type="button" className="btn small primary" disabled={greet.isPending} aria-label={`Поздравить в бот: ${r.patient.fullName}`}
              onClick={() => greet.mutate('TELEGRAM')}>Поздравить в бот</button>
          )}
          {contactPhone(r.patient) && (
            <button type="button" className={r.patient.telegram ? 'btn small' : 'btn small primary'} disabled={greet.isPending}
              aria-label={`Поздравить в WhatsApp: ${r.patient.fullName}`} onClick={() => greet.mutate('WHATSAPP')}>💬 WhatsApp</button>
          )}
        </span>
      )}
    </li>
  )
}
