import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, ApiError, unwrap } from '../api/client'
import { Loading, Spinner } from '../layout/Loading'
import { shortDate } from '../lib/time'
import { kindText, statusText, statusTone, templateStatusText, useClinicWhatsApp, WHATSAPP_KEY, type ClinicWhatsApp } from '../lib/whatsapp'
import { SubHeader } from './SubHeader'

type Kinds = { confirmation: boolean; reminder: boolean; soon: boolean }

const KINDS: [keyof Kinds, string, string][] = [
  ['confirmation', 'Вы записаны', 'Сразу после записи сотрудником или подтверждения заявки: дата, время, врач, адрес.'],
  ['reminder', 'Напоминание накануне', 'Вечером накануне, с кнопками «✅ Приду», «🔁 Перенести», «❌ Отменить» — ответ сразу меняет запись.'],
  ['soon', 'За 2 часа', '«⏰ Ждём вас сегодня в …» с адресом и телефоном.'],
]

const TEMPLATES: [string, string][] = [
  ['CONFIRMATION', 'Вы записаны'], ['REMINDER', 'Напоминание накануне'], ['SOON', 'За 2 часа'],
]

/**
 * «Настройки → WhatsApp» (меняет руководитель): официальный WhatsApp клиники через Tish. Не подключён — что это и как
 * подключить (через владельца Tish). Подключён — номер, какие сообщения слать, статусы шаблонов Meta и последние 20
 * сообщений со статусами. Ни имён, ни номеров пациентов здесь нет.
 */
export function WhatsAppPage({ onBack }: { onBack: () => void }) {
  const client = useQueryClient()
  const wa = useClinicWhatsApp()
  const save = useMutation<ClinicWhatsApp, ApiError, Kinds>({
    mutationFn: (body) => unwrap(api.PUT('/api/clinic/whatsapp', { body })),
    onSuccess: (now) => client.setQueryData(WHATSAPP_KEY, now),
  })
  const submit = useMutation<ClinicWhatsApp, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/clinic/whatsapp/templates')),
    onSuccess: (now) => client.setQueryData(WHATSAPP_KEY, now),
  })
  const refresh = useMutation<ClinicWhatsApp, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/clinic/whatsapp/templates/refresh')),
    onSuccess: (now) => client.setQueryData(WHATSAPP_KEY, now),
  })
  const data = wa.data
  const error = save.error ?? submit.error ?? refresh.error
  return (
    <section className="schedule-main">
      <SubHeader title="WhatsApp" onBack={onBack} />
      {wa.isPending && <Loading />}
      {wa.error && <p className="error">{wa.error.message}</p>}
      {data && !data.connected && <NotConnected data={data} />}
      {data?.connected && (
        <>
          <section className="card-block" aria-label="Подключение">
            <p><strong>Подключён</strong>{data.displayPhone && <> · <span className="num">{data.displayPhone}</span></>}</p>
            <p className="hint small">Пациентам, кого нет в Telegram-боте, Tish пишет сам с этого номера. Кто в боте — получает в Telegram, как раньше.
              В сообщениях нет имени пациента и услуг: только «приём у стоматолога», время, врач, адрес и телефон.</p>
          </section>
          <section className="card-block form" aria-label="Что отправлять">
            <h3>Что отправлять</h3>
            {KINDS.map(([key, title, hint]) => (
              <label key={key} className="check">
                <input type="checkbox" checked={Boolean(data[key])} disabled={save.isPending}
                  onChange={(e) => save.mutate({ confirmation: data.confirmation, reminder: data.reminder, soon: data.soon, [key]: e.target.checked })} />
                <span><strong>{title}</strong><span className="hint"> — {hint}</span></span>
              </label>
            ))}
          </section>
          <section className="card-block" aria-label="Шаблоны">
            <h3>Шаблоны сообщений</h3>
            <p className="hint small">WhatsApp разрешает клинике писать первой только текстами, которые проверила Meta (обычно от минут до суток).
              Пока шаблон не утверждён, это сообщение не уходит. Кыргызский не утверждён — пациенту уйдёт русский.</p>
            <table className="wa-table">
              <thead><tr><th>Сообщение</th><th>Русский</th><th>Кыргызский</th></tr></thead>
              <tbody>
                {TEMPLATES.map(([kind, title]) => (
                  <tr key={kind}>
                    <td>{title}</td>
                    {['ru', 'ky_KG'].map((lang) => {
                      const t = data.templates?.find((x) => x.kind === kind && x.lang === lang)
                      return <td key={lang} className={`tone-${t?.status === 'APPROVED' ? 'ok' : t?.status === 'REJECTED' || t?.status === 'ERROR' ? 'bad' : 'hint'}`}
                        title={t?.reason ?? undefined}>{templateStatusText(t?.status)}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="actions">
              <button type="button" className="btn" disabled={submit.isPending} onClick={() => submit.mutate()}>
                {submit.isPending ? <><Spinner />Отправляем…</> : 'Отправить шаблоны на проверку'}</button>
              <button type="button" className="btn ghost" disabled={refresh.isPending} onClick={() => refresh.mutate()}>Обновить статусы</button>
            </div>
          </section>
          <section className="card-block" aria-label="Последние сообщения">
            <h3>Последние сообщения</h3>
            {!data.recent?.length ? <p className="hint">Сообщений ещё не было.</p> : (
              <table className="wa-table">
                <thead><tr><th>Когда</th><th>Что</th><th>Статус</th></tr></thead>
                <tbody>
                  {data.recent.map((m) => (
                    <tr key={m.id}>
                      <td className="num">{shortDate(m.createdAt!, true)}</td>
                      <td>{kindText(m.kind)}</td>
                      <td className={`tone-${statusTone(m.status)}`}>{statusText(m.status)}{m.status === 'FAILED' && m.errorCode != null && <span className="hint"> · код {m.errorCode}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
      {error && <p className="error" role="alert">{error.message}</p>}
    </section>
  )
}

function NotConnected({ data }: { data: ClinicWhatsApp }) {
  return (
    <section className="card-block" aria-label="Не подключён">
      <p><strong>Не подключён</strong></p>
      <p className="hint">Tish может сам писать пациентам в WhatsApp с номера клиники — официально, через WhatsApp от Meta: «Вы записаны»,
        напоминание накануне с кнопками «Приду / Перенести / Отменить» (ответ сразу меняет запись в расписании) и «Ждём вас» за 2 часа.
        Видно, доставлено ли и прочитано ли сообщение. Пациенты в Telegram-боте получают сообщения там, как сейчас.</p>
      <p className="hint">Нужны: номер для WhatsApp (новая SIM-карта), аккаунт Meta на клинику и карта для оплаты Meta (около $5–10 в месяц).</p>
      <p><strong>Подключение — через владельца Tish.</strong> {data.available ? '' : 'Пока подключение готовится, напоминайте как раньше: «Напомнить в WhatsApp» в карточке приёма.'}</p>
    </section>
  )
}
