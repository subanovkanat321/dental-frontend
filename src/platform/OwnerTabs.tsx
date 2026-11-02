import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type ReactNode } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { TicketPanel } from '../account/TicketThread'
import { agreementBlocks, TICKET_KINDS, TICKET_STATUS } from '../account/texts'
import { shortDate } from '../lib/time'
import { SaveBar } from '../layout/SaveBar'
import { useClose } from '../lib/useClose'
import { useDirty } from '../lib/unsaved'
import { EmptyState } from '../layout/EmptyState'

type Version = Schemas['AgreementsVersion']

/** «Обращения клиник» (владелец): сначала ждущие ответа; переписка — справа. */
export function TicketsTab({ header, onPanel }: { header: ReactNode; onPanel: (open: boolean) => void }) {
  const list = useQuery({ queryKey: ['platform-tickets'], queryFn: () => unwrap(api.GET('/api/platform/support/tickets')) })
  const [opened, setOpenedState] = useState<number | null>(null)
  const setOpened = useCallback((id: number | null) => {
    setOpenedState(id)
    onPanel(id != null)
  }, [onPanel])
  const close = useCallback(() => setOpened(null), [setOpened])
  const open = (list.data ?? []).filter((t) => t.status === 'OPEN').length
  return (
    <>
      <section className="schedule-main">
        {header}
        <section className="card-block">
          <p className={open ? 'tone-wait strong' : 'hint'}>{open ? `Ждут ответа: ${open}` : 'Все обращения отвечены.'}</p>
          {list.error && <p className="error">{list.error.message}</p>}
          {list.isPending ? <p className="hint">Загрузка…</p> : list.data?.length ? (
            <table className="table" aria-label="Обращения клиник">
              <thead><tr><th>Клиника</th><th>Обращение</th><th>Статус</th><th>Обновлено</th></tr></thead>
              <tbody>
                {list.data.map((t) => {
                  const [status, cls] = TICKET_STATUS[t.status ?? 'OPEN'] ?? ['', 's-quiet']
                  return (
                    <tr key={t.id} className={t.id === opened ? 'active' : undefined}>
                      <td><button type="button" className="row-link" onClick={() => setOpened(t.id!)}>{t.clinicName}</button></td>
                      <td>{t.viaBot ? (t.escalated ? '💬 Помощь — бот передал вам' : '💬 Помощь — ответил бот') : TICKET_KINDS[t.kind ?? 'QUESTION']?.title}<span className="hint"> · {t.preview}</span></td>
                      <td><span className={`chip small ${cls}`}>{status}</span></td>
                      <td className="hint nowrap">{t.updatedAt ? shortDate(t.updatedAt) : ''} · {t.author}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : <EmptyState icon="💬" title="Обращений пока нет." />}
        </section>
      </section>
      {opened != null && <TicketPanel key={opened} id={opened} platform onClose={close} />}
    </>
  )
}

/**
 * «Сообщение клиникам» (владелец): в бот админам всех или выбранных клиник — плановые работы,
 * новое в приложении, тарифы. Рассылку не отменить — перед отправкой спрашиваем.
 */
export function BroadcastTab() {
  const client = useQueryClient()
  const clinics = useQuery({ queryKey: ['platform-clinics'], queryFn: () => unwrap(api.GET('/api/platform/clinics')) })
  const history = useQuery({ queryKey: ['platform-broadcasts'], queryFn: () => unwrap(api.GET('/api/platform/broadcasts')) })
  const [text, setText] = useState('')
  const [all, setAll] = useState(true)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const send = useMutation<Schemas['PlatformBroadcastsBroadcast'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/broadcasts', { body: { text, clinicIds: all ? undefined : [...chosen] } })),
    onSuccess: () => {
      setText('')
      void client.invalidateQueries({ queryKey: ['platform-broadcasts'] })
    },
  })
  const list = clinics.data ?? []
  const toggle = (id: number) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }
  const count = all ? list.length : chosen.size
  return (
    <>
      <section className="card-block">
        <h2>Сообщение клиникам</h2>
        <form className="form narrow" aria-label="Сообщение клиникам"
          onSubmit={(e) => { e.preventDefault(); if (window.confirm(`Отправить админам клиник (${count})? Отменить нельзя.`)) send.mutate() }}>
          <p className="hint">Придёт в бот администраторам клиник с подписью «Сообщение от команды Tish». Не пишите сюда данные пациентов.</p>
          <label className="field"><span>Текст · {text.length} / 2000</span>
            <textarea rows={6} maxLength={2000} required value={text} placeholder="Например: в субботу с 23:00 до 23:30 — плановые работы, приложение может не открываться"
              onChange={(e) => { send.reset(); setText(e.target.value) }} /></label>
          <div className="segments" role="group" aria-label="Кому">
            <button type="button" aria-pressed={all} onClick={() => setAll(true)}>Всем клиникам ({list.length})</button>
            <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>Выбрать</button>
          </div>
          {!all && (
            <div className="checks">
              {list.map((c) => <label key={c.id} className="check"><input type="checkbox" checked={chosen.has(c.id!)} onChange={() => toggle(c.id!)} /> {c.name}</label>)}
            </div>
          )}
          {send.error && <p className="error" role="alert">{send.error.fieldErrors.text ?? send.error.fieldErrors.clinicIds ?? send.error.message}</p>}
          {send.isSuccess && <p className="tone-ok" role="status">Отправлено: дошло {send.data.delivered} из {send.data.recipients}</p>}
          <button type="submit" className="btn primary" disabled={send.isPending || !text.trim() || !count}>Отправить админам</button>
        </form>
      </section>
      {(history.data?.length ?? 0) > 0 && (
        <section className="card-block">
          <h2>Отправленные</h2>
          <table className="table" aria-label="Отправленные сообщения">
            <tbody>
              {history.data!.map((b) => (
                <tr key={b.id}>
                  <td>{(b.text ?? '').length > 120 ? `${b.text!.slice(0, 120)}…` : b.text}</td>
                  <td className="hint nowrap">{b.sentAt ? shortDate(b.sentAt, true) : ''} · клиник {b.clinics} · дошло {b.delivered} из {b.recipients}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

/**
 * «Договор с клиниками» (владелец): версии. Черновик правится и публикуется; опубликованную видят
 * админы клиник и подписывают — менять её нельзя, только выпустить новую.
 */
export function AgreementsTab({ header, onPanel }: { header: ReactNode; onPanel: (open: boolean) => void }) {
  const client = useQueryClient()
  const list = useQuery({ queryKey: ['platform-agreements'], queryFn: () => unwrap(api.GET('/api/platform/agreements')) })
  const [opened, setOpenedState] = useState<number | null>(null)
  const setOpened = useCallback((id: number | null) => {
    setOpenedState(id)
    onPanel(id != null)
  }, [onPanel])
  const close = useCallback(() => setOpened(null), [setOpened])
  const versions = list.data ?? []
  const draft = versions.find((v) => !v.publishedAt)
  const start = useMutation<Version, ApiError>({
    mutationFn: async () => {
      const base = versions.find((v) => v.publishedAt) ?? await unwrap(api.GET('/api/platform/agreements/template'))
      return unwrap(api.POST('/api/platform/agreements', { body: { title: base.title, body: base.body } }))
    },
    onSuccess: (v) => void client.invalidateQueries({ queryKey: ['platform-agreements'] }).then(() => setOpened(v.id!)),
  })
  const openedVersion = versions.find((v) => v.id === opened)
  return (
    <>
      <section className="schedule-main">
        {header}
        <section className="card-block">
          <p className="hint">Неопубликованную версию видите только вы. Опубликованную видят админы клиник и подписывают её в «Настройки → Договор»;
            менять её нельзя — выпустите новую. Перед публикацией — показать юристу.</p>
          {list.error && <p className="error">{list.error.message}</p>}
          {versions.length > 0 && (
            <table className="table" aria-label="Версии договора">
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className={v.id === opened ? 'active' : undefined}>
                    <td><button type="button" className="row-link" onClick={() => setOpened(v.id!)}>Версия {v.version} · {v.title}</button></td>
                    <td className={v.publishedAt ? 'tone-ok' : 'tone-wait'}>{v.publishedAt ? `опубликована ${shortDate(v.publishedAt)} · подписали: ${v.acceptances}` : 'не опубликована — клиники не видят'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {start.error && <p className="error">{start.error.message}</p>}
          {!draft && !list.isPending && (
            <button type="button" className="btn primary" disabled={start.isPending} onClick={() => start.mutate()}>
              {versions.length ? 'Новая версия (из действующей)' : 'Начать с шаблона'}</button>
          )}
        </section>
      </section>
      {openedVersion && <VersionPanel key={openedVersion.id} v={openedVersion} onClose={close} />}
    </>
  )
}

function VersionPanel({ v, onClose }: { v: Version; onClose: () => void }) {
  const close = useClose(onClose)
  const client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: ['platform-agreements'] })
  const [title, setTitle] = useState(v.title ?? '')
  const [body, setBody] = useState(v.body ?? '')
  const [done, setDone] = useState('')
  const { dirty, commit } = useDirty({ title, body })
  const save = useMutation<Version, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/agreements/{id}', { params: { path: { id: v.id! } }, body: { title, body } })),
    onSuccess: () => {
      commit()
      void refresh()
    },
  })
  const publish = useMutation<Version, ApiError>({
    mutationFn: async () => {
      await unwrap(api.PUT('/api/platform/agreements/{id}', { params: { path: { id: v.id! } }, body: { title, body } }))
      return unwrap(api.POST('/api/platform/agreements/{id}/publish', { params: { path: { id: v.id! } } }))
    },
    onSuccess: () => {
      // Публикация сохранила и текст
      commit()
      void refresh()
    },
  })
  const pdf = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/agreements/{id}/pdf/send', { params: { path: { id: v.id! } } })),
    onSuccess: () => setDone('PDF отправлен в чат с ботом'),
  })
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/platform/agreements/{id}', { params: { path: { id: v.id! } } })),
    onSuccess: () => {
      void refresh()
      onClose()
    },
  })
  const error = publish.error ?? pdf.error ?? remove.error
  return (
    <aside className="panel wide" aria-label="Версия договора">
      <header className="panel-head">
        <div>
          <h2>Версия {v.version}{v.publishedAt ? '' : ' · не опубликована'}</h2>
          {v.publishedAt && <span className="hint">Опубликована {shortDate(v.publishedAt)} · подписали: {v.acceptances} · отпечаток {(v.sha256 ?? '').slice(0, 16)}…</span>}
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>
      {v.publishedAt ? (
        <div className="agreement-text">
          <h3>{v.title}</h3>
          {agreementBlocks(v.body ?? '').map((b, i) => <p key={i} className={b.type === 'note' ? 'hint' : b.type === 'heading' ? 'strong' : undefined}>{b.type === 'item' ? `• ${b.text}` : b.text}</p>)}
        </div>
      ) : (
        <div className="form">
          <label className="field"><span>Название</span><input value={title} maxLength={200} onChange={(e) => { setDone(''); save.reset(); setTitle(e.target.value) }} /></label>
          {save.error?.fieldErrors.title && <p className="error">{save.error.fieldErrors.title}</p>}
          <label className="field"><span>Текст договора</span>
            <textarea className="agreement-edit" rows={18} value={body} onChange={(e) => { setDone(''); save.reset(); setBody(e.target.value) }} /></label>
          {save.error?.fieldErrors.body && <p className="error">{save.error.fieldErrors.body}</p>}
          <p className="hint">Разметка: «# » — заголовок, «## » — раздел, «- » — пункт, «**…**» — жирное. Подставляются сами: {'{{date}}'}, {'{{clinic.name}}'},
            {' {{clinic.inn}}'}, {'{{clinic.address}}'}, {'{{signer.name}}'}, {'{{signer.position}}'}, {'{{signer.basis}}'} — из формы клиники;
            {' {{platform.name}}'}, {'{{platform.hosting}}'}, {'{{platform.support}}'} — из «Сведений о платформе».</p>
          <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} savedText="Черновик договора сохранён"
            error={save.error && (save.error.fieldErrors.title ?? save.error.fieldErrors.body ?? save.error.message)} onSave={() => save.mutate()} />
          <div className="actions">
            <button type="button" className="btn primary" disabled={publish.isPending}
              onClick={() => window.confirm(`Опубликовать версию ${v.version}? Клиники увидят её и будут подписывать.`) && publish.mutate()}>Опубликовать — клиники увидят</button>
          </div>
        </div>
      )}
      <button type="button" className="btn" disabled={pdf.isPending} onClick={() => pdf.mutate()}>
        {v.publishedAt ? 'Пустой экземпляр — PDF в бот' : 'Как будет выглядеть — PDF в бот'}</button>
      {error && <p className="error" role="alert">{error.message}</p>}
      {done && <p className="tone-ok" role="status">{done}</p>}
      <div className="danger-zone">
        {(v.acceptances ?? 0) > 0 && <p className="hint">Её подписали клиник: {v.acceptances} — отметки о подписи удалятся вместе с ней.</p>}
        <button type="button" className="btn danger" disabled={remove.isPending}
          onClick={() => window.confirm(`Удалить версию ${v.version}?`) && remove.mutate()}>Удалить эту версию</button>
      </div>
    </aside>
  )
}
