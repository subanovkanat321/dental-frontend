import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Loading } from '../layout/Loading'
import { statusText } from '../lib/whatsapp'

type View = Schemas['WhatsAppAdminPlatformView']
type Connection = Schemas['WhatsAppAdminConnectionView']

const KEY = ['platform-whatsapp']

/** Коды ошибок, которые стоит знать в лицо (без номеров и текстов — только код). */
const CODES: Record<number, string> = {
  [-1]: 'приём уже начался — поздно',
  [-2]: 'WhatsApp клиники выключен',
  [-3]: 'нет токена клиники на сервере',
  0: 'сеть или сервер Meta',
  131026: 'номера нет в WhatsApp',
  131047: 'окно 24 ч закрыто',
  132000: 'параметры шаблона',
  132001: 'шаблон не найден или не утверждён',
  130429: 'лимит скорости Meta',
  131056: 'слишком часто одному номеру',
  190: 'токен недействителен',
}

/**
 * «Платформа → Здоровье → WhatsApp» (только владелец платформы): включён ли WhatsApp Cloud API на сервере, принимает
 * ли webhook, чей токен задан, сообщения за сутки по статусам и ошибки по кодам Meta; подключения клиник — ID из
 * кабинета Meta (не секрет). Токен и App Secret сюда не приходят — только «задан ли».
 */
export function WhatsAppHealth() {
  const client = useQueryClient()
  const view = useQuery<View, ApiError>({ queryKey: KEY, queryFn: () => unwrap(api.GET('/api/platform/whatsapp')) })
  const [editing, setEditing] = useState<Partial<Connection> | null>(null)
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
              <tr><th scope="row">Webhook</th>
                <td className={v.webhookReady ? 'tone-ok' : 'tone-wait'}>{v.webhookReady ? `принимает: ${v.webhookPath}` : 'нет WHATSAPP_APP_SECRET или WHATSAPP_VERIFY_TOKEN'}</td></tr>
              <tr><th scope="row">Токен</th>
                <td className={v.tokenClinicId != null ? 'tone-ok' : 'tone-wait'}>{v.tokenClinicId != null ? `задан для клиники №${v.tokenClinicId}` : 'не задан (WHATSAPP_TOKEN и WHATSAPP_CLINIC_ID)'}</td></tr>
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
            <table className="wa-table" aria-label="Подключения клиник">
              <thead><tr><th>Клиника</th><th>Номер</th><th>Состояние</th><th /></tr></thead>
              <tbody>
                {v.connections!.map((c) => (
                  <tr key={c.clinicId}>
                    <td>{c.clinicName} <span className="hint">№{c.clinicId}</span></td>
                    <td className="num">{c.displayPhone ?? '—'}<div className="hint small">ID {c.phoneNumberId ?? '—'} · WABA {c.wabaId ?? '—'}</div></td>
                    <td className={c.enabled && c.tokenOnServer ? 'tone-ok' : 'tone-wait'}>
                      {c.enabled ? 'включено' : 'выключено'}{c.tokenOnServer ? '' : ' · токена нет'}</td>
                    <td><button type="button" className="link" onClick={() => setEditing(c)}>Изменить</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              <p className="hint small">Токен вводится не здесь: только в .env на сервере (WHATSAPP_TOKEN, WHATSAPP_CLINIC_ID).</p>
              <div className="actions">
                <button type="submit" className="btn primary" disabled={!editing.clinicId || save.isPending}>Сохранить</button>
                <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Отмена</button>
              </div>
              {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
            </form>
          ) : (
            <div className="actions"><button type="button" className="btn" onClick={() => setEditing({ enabled: false })}>Подключить клинику</button></div>
          )}
        </>
      )}
    </section>
  )
}
