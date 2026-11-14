import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { useCallback, useState, type ReactNode } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { TicketPanel } from '../account/TicketThread'
import { agreementBlocks, ticketKind, TICKET_STATUS } from '../account/texts'
import { shortDate } from '../lib/time'
import { SaveBar } from '../layout/SaveBar'
import { useClose } from '../lib/useClose'
import { useDirty } from '../lib/unsaved'
import { EmptyState } from '../layout/EmptyState'
import { Loading } from '../layout/Loading'
import { audienceText, type Audience } from './agreementTarget'
import { AudiencePicker } from './AudiencePicker'
import { SubHelp } from '../layout/PageHead'
import { rowOpen } from '../lib/rowClick'

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
        {list.error && <p className="error">{list.error.message}</p>}
        {list.isPending ? <Loading /> : list.data?.length ? (
          <section className="card-block">
            {/* Итог — в карточке над таблицей, а не одной строкой-шапкой над ней; нет обращений — его и не нужно */}
            <p className={open ? 'tone-wait strong' : 'hint'}>{open ? `Ждут ответа: ${open}` : 'Все обращения отвечены.'}</p>
            <table className="table" aria-label="Обращения клиник">
              <thead><tr><th>Клиника</th><th>Обращение</th><th>Статус</th><th>Обновлено</th></tr></thead>
              <tbody>
                {list.data.map((t) => {
                  const [status, cls] = TICKET_STATUS[t.status ?? 'OPEN'] ?? ['', 's-quiet']
                  return (
                    <tr key={t.id} {...rowOpen(() => setOpened(t.id), t.id === opened && 'active')}>
                      <td><button type="button" className="row-link" onClick={() => setOpened(t.id)}>{t.clinicName}</button></td>
                      <td>{t.viaBot ? (t.escalated ? '💬 Помощь — бот передал вам' : '💬 Помощь — ответил бот') : ticketKind(t.kind)}<span className="hint"> · {t.preview}</span></td>
                      <td><span className={`chip small ${cls}`}>{status}</span></td>
                      <td className="hint nowrap">{t.updatedAt ? shortDate(t.updatedAt) : ''} · {t.author}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        ) : <EmptyState fill title="Обращений пока нет" />}
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
        <form className="form narrow" aria-label="Сообщение клиникам"
          onSubmit={(e) => { e.preventDefault(); void ask(`Отправить руководителям клиник (${count})? Отменить нельзя.`, { ok: 'Отправить' }).then((ok) => ok && send.mutate()) }}>
          <p className="hint small">Придёт в бот руководителям клиник с подписью «Сообщение от команды Tish». Не пишите сюда данные пациентов.</p>
          <label className="field"><span>Текст · {text.length} / 2000</span>
            <textarea rows={6} maxLength={2000} required value={text} placeholder="Например: в субботу с 23:00 до 23:30 — плановые работы, приложение может не открываться"
              onChange={(e) => { send.reset(); setText(e.target.value) }} /></label>
          <div className="segments" role="group" aria-label="Кому">
            <button type="button" aria-pressed={all} onClick={() => setAll(true)}>Всем клиникам ({list.length})</button>
            <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>Выбрать</button>
          </div>
          {!all && (
            <div className="checks">
              {list.map((c) => <label key={c.id} className="check"><input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} /> {c.name}</label>)}
            </div>
          )}
          {send.error && <p className="error" role="alert">{send.error.fieldErrors.text ?? send.error.fieldErrors.clinicIds ?? send.error.message}</p>}
          {send.isSuccess && <p className="tone-ok" role="status">Отправлено: дошло {send.data.delivered} из {send.data.recipients}</p>}
          <button type="submit" className="btn primary" disabled={send.isPending || !text.trim() || !count}>Отправить руководителям</button>
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
    onSuccess: (v) => void client.invalidateQueries({ queryKey: ['platform-agreements'] }).then(() => setOpened(v.id)),
  })
  const openedVersion = versions.find((v) => v.id === opened)
  return (
    <>
      <section className="schedule-main">
        {header}
        <SubHelp title="Договор">Неопубликованную версию видите только вы. Опубликованную видят руководители клиник, которым она адресована (всем или выбранным),
            и подписывают её в «Настройки → Договор с Tish»; менять текст нельзя — выпустите новую. Какую версию подписать конкретной клинике — в её карточке
            («Клиники → клиника → Договор»). Перед публикацией — показать юристу.</SubHelp>
        {/* Версий ещё нет — пустое состояние с одной кнопкой, а не пустая карточка с кнопкой в углу */}
        {!list.isPending && !list.error && !versions.length ? (
          <EmptyState fill title="Договора с клиниками пока нет"
            action={<button type="button" className="btn primary" disabled={start.isPending} onClick={() => start.mutate()}>Начать с шаблона</button>}>
            {start.error ? <span className="error">{start.error.message}</span> : 'Начните с готового шаблона: поправьте текст, покажите юристу и опубликуйте.'}
          </EmptyState>
        ) : (
        <section className="card-block">
          {list.error && <p className="error">{list.error.message}</p>}
          {versions.length > 0 && (
            <table className="table" aria-label="Версии договора">
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} {...rowOpen(() => setOpened(v.id), v.id === opened && 'active')}>
                    <td><button type="button" className="row-link" onClick={() => setOpened(v.id)}>Версия {v.version} · {v.title}</button></td>
                    <td className={v.publishedAt ? 'tone-ok' : 'tone-wait'}>{v.publishedAt ? `опубликована ${shortDate(v.publishedAt)} · ${audienceText(v)} · подписали: ${v.acceptances}` : 'не опубликована — клиники не видят'}</td>
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
        )}
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
  const clinics = useQuery({ queryKey: ['platform-clinics'], queryFn: () => unwrap(api.GET('/api/platform/clinics')) })
  const [audience, setAudience] = useState<Audience>({ all: v.forAll !== false, clinicIds: v.clinicIds ?? [] })
  const { dirty, commit } = useDirty({ title, body })
  const save = useMutation<Version, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/agreements/{id}', { params: { path: { id: v.id } }, body: { title, body } })),
    onSuccess: () => {
      commit()
      void refresh()
    },
  })
  const publish = useMutation<Version, ApiError>({
    mutationFn: async () => {
      await unwrap(api.PUT('/api/platform/agreements/{id}', { params: { path: { id: v.id } }, body: { title, body } }))
      return unwrap(api.POST('/api/platform/agreements/{id}/publish', { params: { path: { id: v.id } }, body: audience }))
    },
    onSuccess: () => {
      // Публикация сохранила и текст
      commit()
      void refresh()
    },
  })
  const saveAudience = useMutation<Version, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/agreements/{id}/audience', { params: { path: { id: v.id } }, body: audience })),
    onSuccess: () => {
      setDone('Адресаты версии сохранены')
      void refresh()
      void client.invalidateQueries({ queryKey: ['platform-agreement-statuses'] })
    },
  })
  const pdf = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/platform/agreements/{id}/pdf/send', { params: { path: { id: v.id } } })),
    onSuccess: () => setDone('PDF отправлен в чат с ботом'),
  })
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/platform/agreements/{id}', { params: { path: { id: v.id } } })),
    onSuccess: () => {
      void refresh()
      onClose()
    },
  })
  const error = publish.error ?? saveAudience.error ?? pdf.error ?? remove.error
  const picker = (
    <section className="form">
      <h3>Кому адресована</h3>
      <AudiencePicker clinics={clinics.data ?? []} value={audience} onChange={(a) => { setDone(''); saveAudience.reset(); publish.reset(); setAudience(a) }} />
    </section>
  )
  const audienceCount = audience.all ? 'всем клиникам' : `клиникам: ${audience.clinicIds.length}`
  return (
    <aside className="panel wide" aria-label="Версия договора">
      <header className="panel-head">
        <div>
          <h2>Версия {v.version}{v.publishedAt ? '' : ' · не опубликована'}</h2>
          {v.publishedAt && <span className="hint">Опубликована {shortDate(v.publishedAt)} · {audienceText(v)} · подписали: {v.acceptances} · отпечаток {(v.sha256 ?? '').slice(0, 16)}…</span>}
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>
      {v.publishedAt ? (
        <>
          <div className="agreement-text">
            <h3>{v.title}</h3>
            {agreementBlocks(v.body ?? '').map((b, i) => <p key={i} className={b.type === 'note' ? 'hint' : b.type === 'heading' ? 'strong' : undefined}>{b.type === 'item' ? `• ${b.text}` : b.text}</p>)}
          </div>
          {picker}
          <p className="hint">Убрали клинику — она перестанет видеть требование подписать эту версию; её подпись, если была, останется в истории.</p>
          <button type="button" className="btn" disabled={saveAudience.isPending || (!audience.all && !audience.clinicIds.length)}
            onClick={() => saveAudience.mutate()}>Сохранить адресатов</button>
        </>
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
          {picker}
          <div className="actions">
            <button type="button" className="btn primary" disabled={publish.isPending || (!audience.all && !audience.clinicIds.length)}
              onClick={() => void ask(`Опубликовать версию ${v.version} — ${audienceCount}? Они увидят её и будут подписывать.`).then((ok) => ok && publish.mutate())}>Опубликовать — {audienceCount}</button>
          </div>
        </div>
      )}
      <button type="button" className="btn" disabled={pdf.isPending} onClick={() => pdf.mutate()}>
        {v.publishedAt ? 'Пустой экземпляр — PDF в бот' : 'Как будет выглядеть — PDF в бот'}</button>
      {error && <p className="error" role="alert">{error.message}</p>}
      {done && <p className="tone-ok" role="status">{done}</p>}
      <div className="danger-zone">
        {v.acceptances > 0 && <p className="hint">Её подписали клиник: {v.acceptances} — отметки о подписи удалятся вместе с ней.</p>}
        <button type="button" className="btn danger" disabled={remove.isPending}
          onClick={() => void ask(`Удалить версию ${v.version}?`).then((ok) => ok && remove.mutate())}>Удалить эту версию</button>
      </div>
    </aside>
  )
}
