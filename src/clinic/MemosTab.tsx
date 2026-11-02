import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { canEditServices } from '../lib/roles'
import { useClose } from '../lib/useClose'

type Me = Schemas['BookingViewsMe']
type Memo = Schemas['CareMemosCareMemoView']

const PHONE = '{телефон}'

/**
 * «Памятки после процедур»: что пациенту делать после удаления, чистки, отбеливания… Стандартные
 * Tish заводит сам при первом открытии — их можно переписать под клинику. Менять — админ и врачи;
 * регистратура и ассистент смотрят (и отдают пациенту с карточки приёма).
 */
export function MemosTab({ me, header, onPanel }: { me: Me; header: ReactNode; onPanel: (open: boolean) => void }) {
  const memos = useQuery({ queryKey: ['care-memos'], queryFn: () => unwrap(api.GET('/api/care-memos')) })
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')) })
  const [opened, setOpenedState] = useState<number | 'new' | null>(null)
  const setOpened = useCallback((next: number | 'new' | null) => {
    setOpenedState(next)
    onPanel(next != null)
  }, [onPanel])
  const close = useCallback(() => setOpened(null), [setOpened])
  const editable = canEditServices(me)
  const nameOf = new Map((services.data ?? []).map((s) => [s.id, s.name]))
  const openedMemo = typeof opened === 'number' ? memos.data?.find((m) => m.id === opened) : undefined

  return (
    <>
      <section className="schedule-main">
        {header}
        <section className="card-block">
          <div className="block-head">
            <p className="hint">Памятку отдают пациенту после приёма: «📤 Отправить пациенту» или «🖨 Печать» на карточке приёма.
              Какая памятка у услуги — в «Настройки → Услуги».</p>
            {editable && <button type="button" className="btn primary" onClick={() => setOpened('new')}>＋ Своя памятка</button>}
          </div>
          {memos.error && <p className="error">{memos.error.message}</p>}
          {memos.isPending ? <p className="hint">Загрузка…</p> : (
            <ul className="memo-list" aria-label="Памятки">
              {(memos.data ?? []).map((m) => (
                <li key={m.id} className={m.active === false ? 'inactive' : undefined}>
                  <button type="button" className="row-link" onClick={() => setOpened(m.id!)}>📋 {m.title}</button>
                  <span className="hint small">
                    {m.active === false ? 'скрыта' : (m.serviceIds ?? []).map((id) => nameOf.get(id)).filter(Boolean).join(', ') || 'ни у одной услуги'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
      {opened === 'new' && <MemoPanel editable onClose={close} />}
      {openedMemo && <MemoPanel key={openedMemo.id} memo={openedMemo} editable={editable} onClose={close} />}
    </>
  )
}

function MemoPanel({ memo: m, editable, onClose }: { memo?: Memo; editable: boolean; onClose: () => void }) {
  useClose(onClose)
  const client = useQueryClient()
  const [form, setForm] = useState({
    title: m?.title ?? '',
    body: m?.body ?? `• \n\nЕсли боль, отёк или кровотечение усиливаются — звоните в клинику: ${PHONE}. Это общие рекомендации — следуйте указаниям вашего врача.`,
    active: m ? m.active !== false : true,
  })
  const [done, setDone] = useState('')
  const save = useMutation<Memo, ApiError>({
    mutationFn: () => unwrap(m
      ? api.PUT('/api/care-memos/{id}', { params: { path: { id: m.id! } }, body: form })
      : api.POST('/api/care-memos', { body: { title: form.title, body: form.body } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['care-memos'] })
      void client.invalidateQueries({ queryKey: ['care-memo'] })
      if (m) setDone('Сохранено')
      else onClose()
    },
  })
  const error = (key: string) => save.error?.fieldErrors[key]
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setDone('')
    save.mutate()
  }
  return (
    <aside className="panel" aria-label={m ? 'Памятка' : 'Новая памятка'}>
      <header className="panel-head">
        <h2>{m ? m.title : 'Новая памятка'}</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      {editable ? (
        <form className="form" onSubmit={submit}>
          <label className="field"><span>Название</span>
            <input value={form.title} required maxLength={100} placeholder="Например: После удаления зуба"
              onChange={(e) => { setDone(''); setForm({ ...form, title: e.target.value }) }} />
          </label>
          {error('title') && <p className="error">{error('title')}</p>}
          <label className="field"><span>Текст для пациента</span>
            <textarea rows={14} maxLength={3500} value={form.body} onChange={(e) => { setDone(''); setForm({ ...form, body: e.target.value }) }} />
          </label>
          <p className="hint small">{PHONE} заменится на телефон клиники из «О клинике».</p>
          {error('body') && <p className="error">{error('body')}</p>}
          {m && <label className="check"><input type="checkbox" checked={form.active}
            onChange={(e) => { setDone(''); setForm({ ...form, active: e.target.checked }) }} /> Предлагать после приёма</label>}
          {save.error && !error('title') && !error('body') && <p className="error" role="alert">{save.error.message}</p>}
          {done && <p className="tone-ok" role="status">{done}</p>}
          <button type="submit" className="btn primary" disabled={save.isPending}>{m ? 'Сохранить' : 'Добавить'}</button>
        </form>
      ) : (
        <>
          <p className="hint">Памятки меняют администратор и врачи.</p>
          <p className="memo-text">{m?.body}</p>
        </>
      )}
    </aside>
  )
}

/** «Памятка после процедуры» в карточке услуги: какую предложить на приёме с этой услугой. */
export function ServiceMemo({ serviceId }: { serviceId: number }) {
  const client = useQueryClient()
  const memos = useQuery({ queryKey: ['care-memos'], queryFn: () => unwrap(api.GET('/api/care-memos')) })
  const links = useQuery({ queryKey: ['care-memo-links'], queryFn: () => unwrap(api.GET('/api/care-memos/links')) })
  const save = useMutation<Schemas['CareMemosLink'], ApiError, number | null>({
    mutationFn: (memoId) => unwrap(api.PUT('/api/care-memos/links/{serviceTypeId}', {
      params: { path: { serviceTypeId: serviceId } }, body: { memoId: memoId ?? undefined },
    })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['care-memo-links'] })
      void client.invalidateQueries({ queryKey: ['care-memos'] })
      void client.invalidateQueries({ queryKey: ['care-memo'] })
    },
  })
  if (!memos.data || !links.data) return null
  const current = links.data.find((l) => l.serviceTypeId === serviceId)?.memoId ?? null
  return (
    <section className="sub-form">
      <label className="field"><span>📋 Памятка после процедуры</span>
        <select value={current ?? ''} disabled={save.isPending} onChange={(e) => save.mutate(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Без памятки</option>
          {memos.data.filter((m) => m.active !== false || m.id === current).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
      </label>
      <p className="hint small">Предложим отдать пациенту после приёма. Тексты — в «Настройки → Памятки после процедур».</p>
      {save.error && <p className="error" role="alert">{save.error.message}</p>}
    </section>
  )
}
