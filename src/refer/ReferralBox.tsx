import './referral.css'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { shortDate } from '../lib/time'
import { referralKey, whatsAppUrl, type ReferralCard } from './referral'

type Patient = Schemas['PatientView']

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

const CHANNEL: Record<NonNullable<ReferralCard['channel']>, string> = { SITE: 'по ссылке на сайте', BOT: 'по ссылке в боте', STAFF: 'отметили вручную' }


/**
 * «🎁 Приведи друга» в карточке пациента («Прочее», 2026-11-24): «Пригласил: …» (нажать — его карточка; выбрать вручную —
 * поиском), «Привёл друзей: 3 · пришли 2» с именами и бонусы за друзей. Ссылку для друзей — «⋯ → Ссылка «Приведи друга»»
 * (link — открыта сразу). Программа выключена и связей нет — блок только с «Пригласил: выбрать».
 */
export function ReferralBox({ patient, canEdit, link, onCloseLink, onOpenPatient }: {
  patient: Patient
  canEdit: boolean
  /** Показать ссылку для друзей (открыли из «⋯») */
  link: boolean
  onCloseLink: () => void
  onOpenPatient?: (id: number) => void
}) {
  const client = useQueryClient()
  const card = useQuery({
    queryKey: referralKey(patient.id),
    queryFn: () => unwrap(api.GET('/api/patients/{id}/referral', { params: { path: { id: patient.id } } })),
  })
  const [picking, setPicking] = useState(false)
  const refresh = (now: ReferralCard) => {
    client.setQueryData(referralKey(patient.id), now)
    void client.invalidateQueries({ queryKey: ['referral-card'] })
    setPicking(false)
  }
  const clear = useMutation<ReferralCard, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/patients/{id}/referral', { params: { path: { id: patient.id } } })),
    onSuccess: refresh,
  })
  if (card.isPending || card.error) return null
  const c = card.data
  const name = (id: number, text: string) => onOpenPatient
    ? <button type="button" className="link" onClick={() => onOpenPatient(id)}>{text}</button> : <b>{text}</b>
  return (
    <section className="referral-box" aria-label="Приведи друга">
      <h3>🎁 Приведи друга</h3>
      {link && c.enabled && <ReferralLink patient={patient} onClose={onCloseLink} />}
      {link && !c.enabled && <p className="hint" role="status">«Приведи друга» выключено — включает руководитель в «Настройки → Привлечение пациентов → Приведи друга».</p>}
      {c.inviterId != null ? (
        <p>Пригласил: {name(c.inviterId, c.inviterName ?? 'пациент')}
          <span className="hint small"> · {c.channel ? CHANNEL[c.channel] : ''}{c.referredAt ? `, ${shortDate(c.referredAt)}` : ''}</span>
          {canEdit && <> · <button type="button" className="link" onClick={() => setPicking(true)}>Изменить</button>
            {' '}· <button type="button" className="link" disabled={clear.isPending}
              onClick={() => void ask(`Убрать «Пригласил: ${c.inviterName}»?`).then((ok) => ok && clear.mutate())}>Убрать</button></>}
        </p>
      ) : canEdit && !picking && (
        <p className="hint">Пригласил: — · <button type="button" className="link" onClick={() => setPicking(true)}>выбрать, кто посоветовал</button></p>
      )}
      {picking && <InviterPick patient={patient} onDone={refresh} onCancel={() => setPicking(false)} />}
      {c.invited > 0 && (
        <div className="referral-friends">
          <p>Привёл друзей: <b className="num">{c.invited}</b>{c.came > 0 && <span className="hint"> · пришли {c.came}</span>}
            {c.rewardsAvailable > 0 && <span className="tone-ok"> · 🎁 бонусов: {c.rewardsAvailable}</span>}
            {c.rewardsUsed > 0 && <span className="hint"> · использовано {c.rewardsUsed}</span>}</p>
          <div className="family-members">
            {c.friends.map((f) => onOpenPatient
              ? <button key={f.patientId} type="button" className="chip" onClick={() => onOpenPatient(f.patientId)}>{f.fullName}{f.came ? ' ✓' : ''}</button>
              : <span key={f.patientId} className="chip">{f.fullName}{f.came ? ' ✓' : ''}</span>)}
          </div>
        </div>
      )}
      {clear.error && <p className="error" role="alert">{errorText(clear.error)}</p>}
    </section>
  )
}

/** Личная ссылка пациента: «Отправить в WhatsApp» (на номер пациента, текст для друга) и «Скопировать». */
function ReferralLink({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const link = useQuery({
    queryKey: ['referral-link', patient.id],
    queryFn: () => unwrap(api.GET('/api/patients/{id}/referral/link', { params: { path: { id: patient.id } } })),
    retry: false,
  })
  const [lang, setLang] = useState<'RU' | 'KY'>('RU')
  const [copied, setCopied] = useState(false)
  if (link.isPending) return <p className="hint">Готовим ссылку…</p>
  if (link.error) return <p className="error" role="alert">{link.error.message}</p>
  const l = link.data
  const text = lang === 'RU' ? l.textRu : l.textKy
  const intro = lang === 'RU' ? 'Ваша ссылка «Приведи друга» — перешлите друзьям:' : 'Сиздин «Досуңду чакыр» шилтемеңиз — досторуңузга жөнөтүңүз:'
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    }
    catch {
      setCopied(false)
    }
  }
  return (
    <div className="referral-link" role="group" aria-label="Ссылка «Приведи друга»">
      <div className="bd-lang hint small">
        <span>Текст для друга:</span>
        <span className="segments" role="group" aria-label="Язык текста">
          {(['RU', 'KY'] as const).map((x) => (
            <button key={x} type="button" aria-pressed={lang === x} onClick={() => setLang(x)}>{x === 'RU' ? 'Русский' : 'Кыргызча'}</button>
          ))}
        </span>
      </div>
      <p className="bd-preview-text" aria-label="Текст для друга">{text}</p>
      <div className="actions">
        {patient.phone && <a className="btn primary" href={whatsAppUrl(patient.phone, `${intro}\n\n${text}`)} target="_blank" rel="noopener noreferrer">
          Отправить в WhatsApp</a>}
        <button type="button" className="btn" onClick={() => void copy()}>{copied ? '✓ Скопировано' : 'Скопировать'}</button>
        <button type="button" className="link" onClick={onClose}>Скрыть</button>
      </div>
      <p className="hint small">В ссылке нет ни имени, ни телефона пациента — друг не узнает, кто его пригласил.</p>
    </div>
  )
}

/** «Пригласил: …» вручную — найти пациента по имени или номеру. */
export function InviterPick({ patient, onDone, onCancel }: { patient: Patient; onDone: (c: ReferralCard) => void; onCancel: () => void }) {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])
  const found = useQuery({
    queryKey: ['patients', 'search', search],
    queryFn: () => unwrap(api.POST('/api/patients/search', { body: { query: search } })),
    enabled: search.length >= 2,
  })
  const set = useMutation<ReferralCard, ApiError, number>({
    mutationFn: (inviterId) => unwrap(api.PUT('/api/patients/{id}/referral', { params: { path: { id: patient.id } }, body: { inviterId } })),
    onSuccess: onDone,
  })
  const list = (found.data ?? []).filter((p) => p.id !== patient.id).slice(0, 6)
  return (
    <div className="patient-pick">
      <input type="search" autoFocus aria-label="Кто пригласил" placeholder="Имя или номер того, кто посоветовал" value={query}
        onChange={(e) => setQuery(e.target.value)} />
      {list.length > 0 && (
        <ul className="found">
          {list.map((p) => (
            <li key={p.id}><button type="button" disabled={set.isPending} onClick={() => set.mutate(p.id)}>{p.fullName}</button></li>
          ))}
        </ul>
      )}
      {search.length >= 2 && found.isSuccess && !list.length && <p className="hint">Не нашли такого пациента.</p>}
      {set.error && <p className="error" role="alert">{errorText(set.error)}</p>}
      <button type="button" className="link" onClick={onCancel}>Отмена</button>
    </div>
  )
}

/**
 * «Пригласил (необязательно)» в форме нового пациента: найти того, кто посоветовал; сохранится вместе с карточкой.
 * Выбрали — чип с именем и «✕».
 */
export function InviterField({ value, onChange }: {
  value: { id: number; fullName: string } | null
  onChange: (v: { id: number; fullName: string } | null) => void
}) {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])
  const found = useQuery({
    queryKey: ['patients', 'search', search],
    queryFn: () => unwrap(api.POST('/api/patients/search', { body: { query: search } })),
    enabled: search.length >= 2 && value == null,
  })
  if (value) {
    return (
      <p className="field-line">Пригласил: <span className="chip">{value.fullName}
        <button type="button" className="link" aria-label="Убрать, кто пригласил" onClick={() => onChange(null)}> ✕</button></span></p>
    )
  }
  const list = (found.data ?? []).slice(0, 5)
  return (
    <div className="field">
      <span>Пригласил (необязательно)</span>
      <input type="search" aria-label="Пригласил" placeholder="Кто посоветовал клинику — имя или номер" value={query} autoComplete="off"
        onChange={(e) => setQuery(e.target.value)} />
      {list.length > 0 && (
        <ul className="found">
          {list.map((p) => <li key={p.id}><button type="button" onClick={() => { onChange({ id: p.id, fullName: p.fullName }); setQuery('') }}>{p.fullName}</button></li>)}
        </ul>
      )}
    </div>
  )
}
