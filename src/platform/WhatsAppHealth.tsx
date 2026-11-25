import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Loading } from '../layout/Loading'
import { shortDate } from '../lib/time'
import { statusText } from '../lib/whatsapp'

type View = Schemas['WhatsAppAdminPlatformView']
type Connection = Schemas['WhatsAppAdminConnectionView']
type SecretField = NonNullable<Schemas['WhatsAppControllerSecrets']['clear']>[number]

const KEY = ['platform-whatsapp']

/** Коды ошибок, которые стоит знать в лицо (без номеров и текстов — только код). */
const CODES: Record<number, string> = {
  [-1]: 'приём уже начался — поздно',
  [-2]: 'WhatsApp клиники выключен',
  [-3]: 'нет токена клиники',
  0: 'сеть или сервер Meta',
  131026: 'номера нет в WhatsApp',
  131047: 'окно 24 ч закрыто',
  132000: 'параметры шаблона',
  132001: 'шаблон не найден или не утверждён',
  130429: 'лимит скорости Meta',
  131056: 'слишком часто одному номеру',
  190: 'токен недействителен',
}

const SECRETS: { field: SecretField; key: 'token' | 'appSecret' | 'verifyToken'; label: string; hint: string }[] = [
  { field: 'TOKEN', key: 'token', label: 'Постоянный токен', hint: 'шаг 5 инструкции' },
  { field: 'APP_SECRET', key: 'appSecret', label: 'App Secret', hint: 'шаг 6.1: Настройки приложения → Основное' },
  { field: 'VERIFY_TOKEN', key: 'verifyToken', label: 'Verify token', hint: 'шаг 6.2: та же строка, что в Meta → Webhook' },
]

const when = (instant?: string) => (instant ? shortDate(instant, true) : '—')

/** Задан ли секрет и откуда: из Tish (база, зашифрован), из .env (клиника пилота) или нет. Значение не приходит никогда. */
function secretState(c: Connection, field: SecretField): { text: string; ok: boolean } {
  if (c.unreadable?.includes(field)) return { text: 'не расшифровывается — впишите заново', ok: false }
  const set = field === 'TOKEN' ? c.tokenSet : field === 'APP_SECRET' ? c.appSecretSet : c.verifyTokenSet
  if (set) return { text: 'задан', ok: true }
  if (c.envClinic) return { text: 'из .env', ok: true }
  return { text: 'не задан', ok: false }
}

/**
 * «Платформа → Здоровье → WhatsApp» (только владелец платформы, ADR 0007 бэкенда): включён ли WhatsApp Cloud API на
 * сервере, есть ли ключ шифрования секретов, сообщения за сутки и ошибки по кодам Meta; по каждой клинике — ID из
 * кабинета Meta (не секрет), заданы ли её токен / App Secret / verify token, адрес webhook для Meta, последнее сообщение
 * пациента и ошибки webhook. Секреты — только записать: сервер их не отдаёт, форма очищается после сохранения.
 */
export function WhatsAppHealth() {
  const client = useQueryClient()
  const view = useQuery<View, ApiError>({ queryKey: KEY, queryFn: () => unwrap(api.GET('/api/platform/whatsapp')) })
  const [editing, setEditing] = useState<Partial<Connection> | null>(null)
  const [secretsFor, setSecretsFor] = useState<Connection | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  // Список клиник — только когда открыли форму подключения
  const clinics = useQuery({ queryKey: ['platform-clinics'], queryFn: () => unwrap(api.GET('/api/platform/clinics')), enabled: editing != null })
  const save = useMutation<View, ApiError, Partial<Connection>>({
    mutationFn: (c) => unwrap(api.PUT('/api/platform/whatsapp/connection', {
      body: { clinicId: c.clinicId!, wabaId: c.wabaId ?? '', phoneNumberId: c.phoneNumberId ?? '', displayPhone: c.displayPhone ?? '', enabled: Boolean(c.enabled) },
    })),
    onSuccess: (now) => {
      client.setQueryData(KEY, now)
      setEditing(null)
    },
  })
  const copy = async (c: Connection) => {
    try {
      await navigator.clipboard.writeText(webhookUrl(c))
      setCopied(c.clinicId)
    } catch {
      setCopied(null)
    }
  }
  const v = view.data
  const total = Object.values(v?.last24h ?? {}).reduce((a, b) => a + b, 0)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (editing?.clinicId) save.mutate(editing)
  }
  return (
    <section className="card-block" aria-label="WhatsApp">
      <h2>WhatsApp</h2>
      {view.isPending && <Loading />}
      {view.error && <p className="error">{view.error.message}</p>}
      {v && (
        <>
          <table className="table" aria-label="WhatsApp на сервере">
            <tbody>
              <tr><th scope="row">На сервере</th>
                <td className={v.enabled ? 'tone-ok' : 'tone-wait'}>{v.enabled ? `включён · Graph API ${v.graphVersion}` : 'выключен (WHATSAPP_ENABLED)'}</td></tr>
              <tr><th scope="row">Ключ секретов</th>
                <td className={v.secretsKey ? 'tone-ok' : 'tone-wait'}>{v.secretsKey ? 'задан — секреты клиник хранятся зашифрованными' : 'нет WHATSAPP_SECRETS_KEY — секреты клиник не сохранить'}</td></tr>
              {(v.tokenClinicId != null || v.webhookReady) && (
                <tr><th scope="row">Пилот (.env)</th>
                  <td>{v.tokenClinicId != null ? `токен клиники №${v.tokenClinicId}` : 'токена нет'}
                    {v.webhookReady ? ` · общий адрес ${v.webhookPath} принимает` : ''}</td></tr>
              )}
              <tr><th scope="row">За сутки</th>
                <td>{total === 0 ? 'сообщений не было' : Object.entries(v.last24h ?? {}).map(([s, n]) => `${statusText(s)} ${n}`).join(' · ')}</td></tr>
              {(v.failures?.length ?? 0) > 0 && (
                <tr><th scope="row">Ошибки</th>
                  <td className="tone-bad">{v.failures!.map((f) => `клиника №${f.clinicId}: код ${f.code ?? '?'}${f.code != null && CODES[f.code] ? ` (${CODES[f.code]})` : ''} — ${f.count}`).join('; ')}</td></tr>
              )}
            </tbody>
          </table>
          <h3>Подключения клиник</h3>
          {!v.connections?.length && <p className="hint">Пока ни одной. Инструкция — docs/research/whatsapp-setup.md.</p>}
          {Boolean(v.connections?.length) && (
            <ul className="wa-clinics" aria-label="Подключения клиник">
              {v.connections!.map((c) => (
                <li key={c.clinicId} aria-label={`${c.clinicName ?? 'Клиника'} №${c.clinicId}`}>
                  <div className="wa-clinic-head">
                    <span className="strong">{c.clinicName}</span> <span className="hint">№{c.clinicId}</span>
                    <span className={c.enabled && c.tokenOnServer && c.webhookReady ? 'tone-ok' : 'tone-wait'}>
                      {' · '}{c.enabled ? 'включено' : 'выключено'}{c.tokenOnServer ? '' : ' · токена нет'}</span>
                  </div>
                  <div className="num">{c.displayPhone ?? '—'} <span className="hint small">ID {c.phoneNumberId ?? '—'} · WABA {c.wabaId ?? '—'}</span></div>
                  <div className="small">
                    {SECRETS.map((s, i) => {
                      const st = secretState(c, s.field)
                      return <span key={s.field}>{i > 0 && ' · '}{s.label}: <span className={st.ok ? 'tone-ok' : 'tone-wait'}>{st.text}</span></span>
                    })}
                  </div>
                  <div className="small">
                    Webhook: <code className="wa-url">{webhookUrl(c)}</code>{' '}
                    <button type="button" className="btn small" onClick={() => void copy(c)} aria-label={`Скопировать адрес webhook клиники №${c.clinicId}`}>
                      {copied === c.clinicId ? 'Скопировано' : 'Скопировать'}</button>
                    <div className={c.webhookReady ? 'tone-ok' : 'tone-wait'}>{c.webhookReady ? 'принимает' : 'не принимает: нужны App Secret и verify token'}</div>
                  </div>
                  <div className="small hint">
                    Последнее сообщение пациента: {when(c.lastInboundAt)}
                    {c.webhookErrors > 0 && <span className="tone-bad"> · ошибок webhook с запуска: {c.webhookErrors} (последняя {when(c.lastWebhookErrorAt)}) — проверьте адрес и App Secret</span>}
                  </div>
                  <div className="actions">
                    <button type="button" className="link" onClick={() => { setSecretsFor(null); setEditing(c) }}>Изменить</button>
                    <button type="button" className="link" onClick={() => { setEditing(null); setSecretsFor(c) }}>Секреты</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {secretsFor && (
            <SecretsForm key={secretsFor.clinicId} connection={secretsFor} keyPresent={v.secretsKey}
              onDone={(now) => { client.setQueryData(KEY, now); setSecretsFor(null) }} onCancel={() => setSecretsFor(null)} />
          )}
          {editing ? (
            <form className="form" onSubmit={submit} aria-label="Подключение клиники">
              <label>Клиника
                <select value={editing.clinicId ?? ''} onChange={(e) => setEditing({ ...editing, clinicId: Number(e.target.value) || undefined })}>
                  <option value="">— выберите —</option>
                  {clinics.data?.map((c) => <option key={c.id} value={c.id}>{c.name} (№{c.id})</option>)}
                </select>
              </label>
              <label>WABA ID (WhatsApp Business Account)
                <input inputMode="numeric" value={editing.wabaId ?? ''} onChange={(e) => setEditing({ ...editing, wabaId: e.target.value })} /></label>
              <label>Phone number ID
                <input inputMode="numeric" value={editing.phoneNumberId ?? ''} onChange={(e) => setEditing({ ...editing, phoneNumberId: e.target.value })} /></label>
              <label>Номер для людей
                <input value={editing.displayPhone ?? ''} placeholder="+996 555 12 34 56" onChange={(e) => setEditing({ ...editing, displayPhone: e.target.value })} /></label>
              <label className="check"><input type="checkbox" checked={Boolean(editing.enabled)} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
                Включено — Tish пишет пациентам клиники</label>
              <p className="hint small">Токен, App Secret и verify token — кнопкой «Секреты» в строке клиники после сохранения.</p>
              <div className="actions">
                <button type="submit" className="btn primary" disabled={!editing.clinicId || save.isPending}>Сохранить</button>
                <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Отмена</button>
              </div>
              {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
            </form>
          ) : (
            !secretsFor && <div className="actions"><button type="button" className="btn" onClick={() => setEditing({ enabled: false })}>Подключить клинику</button></div>
          )}
        </>
      )}
    </section>
  )
}

/** Полный адрес webhook клиники для Meta: API на том же домене, что и CRM. */
function webhookUrl(c: Connection): string {
  return `${window.location.origin}${c.webhookPath ?? `/api/whatsapp/webhook/${c.clinicId}`}`
}

/**
 * Секреты клиники — только запись: поля-пароли пустые (что задано, сервер не отдаёт), пустое поле — не менять,
 * галочка «стереть» — убрать. Значения живут только в состоянии формы и уходят одним PUT; после ответа форма закрывается.
 */
function SecretsForm({ connection, keyPresent, onDone, onCancel }: {
  connection: Connection, keyPresent: boolean, onDone: (v: View) => void, onCancel: () => void,
}) {
  const [values, setValues] = useState({ token: '', appSecret: '', verifyToken: '' })
  const [clear, setClear] = useState<SecretField[]>([])
  const save = useMutation<View, ApiError, void>({
    mutationFn: () => unwrap(api.PUT('/api/platform/whatsapp/secrets', {
      body: {
        clinicId: connection.clinicId,
        token: values.token.trim() || undefined,
        appSecret: values.appSecret.trim() || undefined,
        verifyToken: values.verifyToken.trim() || undefined,
        clear,
      },
    })),
    onSuccess: (now) => {
      setValues({ token: '', appSecret: '', verifyToken: '' })
      onDone(now)
    },
  })
  const changed = clear.length > 0 || Object.values(values).some((x) => x.trim() !== '')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (changed) save.mutate()
  }
  return (
    <form className="form" onSubmit={submit} aria-label="Секреты клиники" autoComplete="off">
      <h3>Секреты: {connection.clinicName} <span className="hint">№{connection.clinicId}</span></h3>
      <p className="hint small">Из приложения Meta этой клиники. Не пересылайте их в чат — вписывайте только здесь. Пустое поле — не менять.</p>
      {!keyPresent && <p className="error" role="alert">На сервере нет WHATSAPP_SECRETS_KEY — сохранить не получится. Добавьте ключ в .env (openssl rand -base64 32) и перезапустите Tish.</p>}
      {SECRETS.map((s) => {
        const st = secretState(connection, s.field)
        const removing = clear.includes(s.field)
        const stored = s.field === 'TOKEN' ? connection.tokenSet : s.field === 'APP_SECRET' ? connection.appSecretSet : connection.verifyTokenSet
        return (
          <div key={s.field}>
            <label>{s.label} <span className="hint small">({st.text}; {s.hint})</span>
              <input type="password" autoComplete="new-password" spellCheck={false} disabled={removing}
                value={values[s.key]} placeholder={stored ? 'задан — впишите новый, чтобы заменить' : ''}
                onChange={(e) => setValues({ ...values, [s.key]: e.target.value })} /></label>
            {stored && (
              <label className="check"><input type="checkbox" checked={removing}
                onChange={(e) => {
                  setClear(e.target.checked ? [...clear, s.field] : clear.filter((f) => f !== s.field))
                  if (e.target.checked) setValues({ ...values, [s.key]: '' })
                }} />
                Стереть {s.label.toLowerCase()}{connection.envClinic ? ' (тогда — из .env)' : ''}</label>
            )}
            {save.error?.fieldErrors[s.key] && <p className="error">{save.error.fieldErrors[s.key]}</p>}
          </div>
        )
      })}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={!changed || save.isPending}>Сохранить</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
      </div>
      {save.error && Object.keys(save.error.fieldErrors).length === 0 && <p className="error" role="alert">{save.error.message}</p>}
    </form>
  )
}
