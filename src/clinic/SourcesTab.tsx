import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { sourceLabel, useSources, type SourceOption } from '../lib/sources'
import { useClose } from '../lib/useClose'
import { useDirty } from '../lib/unsaved'
import { Loading } from '../layout/Loading'
import { SubHelp } from '../layout/PageHead'
import { rowOpen } from '../lib/rowClick'

type Me = Schemas['BookingViewsMe']

/** Подсказки для эмодзи: нажали — вставилось в поле; можно вписать и любой свой. */
const EMOJI_SUGGESTIONS = ['📱', '📸', '🗺', '🌐', '🔎', '🎵', '✈️', '💬', '▶️', '🤝', '👨‍👩‍👧', '👨‍⚕️', '🏥', '🪧', '📣', '📺', '📻', '📰', '🎁', '🏢', '🚶', '⭐', '✨', '❓']

/**
 * «Откуда узнают о клинике»: варианты, которые сотрудники выбирают в карточке пациента, а новые
 * пациенты — в Mini App при записи. По ним — «Касса → Аналитика → Откуда пациенты». Меняет админ:
 * добавить, переименовать, порядок, скрыть (у пациентов и в истории вариант остаётся).
 */
export function SourcesTab({ me, header, onPanel }: { me: Me; header: ReactNode; onPanel: (open: boolean) => void }) {
  const client = useQueryClient()
  const list = useSources()
  const editable = Boolean(me.admin)
  const [opened, setOpenedState] = useState<Partial<SourceOption> | null>(null)
  const setOpened = useCallback((o: Partial<SourceOption> | null) => {
    setOpenedState(o)
    onPanel(o != null)
  }, [onPanel])
  const close = useCallback(() => setOpened(null), [setOpened])
  const move = useMutation<SourceOption[], ApiError, { id: number; direction: number }>({
    mutationFn: ({ id, direction }) => unwrap(api.POST('/api/patient-sources/{id}/move', { params: { path: { id } }, body: { direction } })),
    onSuccess: (all) => client.setQueryData(['patient-sources'], all),
  })
  const options = list.data ?? []

  return (
    <>
      <section className="schedule-main">
        {header}
        <SubHelp title="Откуда приходят пациенты">Что выбирают в карточке пациента и что новый пациент видит в боте при записи: «Откуда вы о нас узнали?».
            По этим ответам — «Касса → Аналитика»: какая реклама приводит пациентов.
            {!editable && ' Список меняет руководитель клиники.'}</SubHelp>
        <section className="card-block">
          {list.error && <p className="error">{list.error.message}</p>}
          {move.error && <p className="error" role="alert">{move.error.message}</p>}
          {/* Кнопка — над таблицей, не в её шапке: на телефоне таблица становится карточками и шапка прячется (2026-11-14) */}
          {editable && (
            <p className="sources-add"><button type="button" className="btn primary" onClick={() => setOpened({ emoji: '', title: '', active: true })}>
              ＋ Свой вариант с эмодзи</button></p>
          )}
          {list.isPending ? <Loading /> : (
            <table className="table" aria-label="Откуда узнают о клинике">
              <thead><tr><th>Вариант</th><th>Пациентов</th><th className="r"><span className="sr-only">Действия</span></th></tr></thead>
              <tbody>
                {options.map((o, i) => (
                  <tr key={o.id} {...rowOpen(editable && (() => setOpened(o)), o.id === opened?.id && 'active', o.active === false && 'inactive')}>
                    <td>{editable ? <button type="button" className="row-link" onClick={() => setOpened(o)}>{sourceLabel(o)}</button> : sourceLabel(o)}
                      {o.active === false && <span className="hint"> · скрыт</span>}</td>
                    <td className="num">{o.patients}</td>
                    <td className="r nowrap">{editable && (
                      <>
                        <button type="button" className="btn small ghost" aria-label={`Выше: ${o.title}`} disabled={i === 0 || move.isPending}
                          onClick={() => move.mutate({ id: o.id, direction: -1 })}>↑</button>
                        <button type="button" className="btn small ghost" aria-label={`Ниже: ${o.title}`} disabled={i === options.length - 1 || move.isPending}
                          onClick={() => move.mutate({ id: o.id, direction: 1 })}>↓</button>
                      </>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </section>
      {opened && <SourcePanel key={opened.id ?? 'new'} option={opened} onClose={close} />}
    </>
  )
}

/** Вариант: новый (без id) или существующий. Не удаляется — скрывается: история пациентов остаётся. */
function SourcePanel({ option: o, onClose }: { option: Partial<SourceOption>; onClose: () => void }) {
  const close = useClose(onClose)
  const client = useQueryClient()
  const [f, setF] = useState({ emoji: o.emoji ?? '', title: o.title ?? '', titleKy: o.titleKy ?? '', active: o.active !== false })
  const { dirty, commit } = useDirty(f)
  const save = useMutation<SourceOption[], ApiError>({
    mutationFn: () => unwrap(o.id
      ? api.PUT('/api/patient-sources/{id}', { params: { path: { id: o.id } }, body: f })
      : api.POST('/api/patient-sources', { body: { emoji: f.emoji, title: f.title, titleKy: f.titleKy } })),
    onSuccess: (all) => {
      commit()
      client.setQueryData(['patient-sources'], all)
      if (!o.id) onClose()
    },
  })
  const err = (k: string) => save.error?.fieldErrors[k]
  const change = (next: Partial<typeof f>) => {
    save.reset()
    setF({ ...f, ...next })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <aside className="panel" aria-label={o.id ? 'Вариант' : 'Новый вариант'}>
      <header className="panel-head">
        <h2>{o.id ? 'Вариант' : 'Новый вариант'}</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>
      <form className="form" onSubmit={submit}>
        <div className="row">
          <label className="field emoji-field"><span>Эмодзи</span>
            <input value={f.emoji} required maxLength={16} autoComplete="off" onChange={(e) => change({ emoji: e.target.value })} /></label>
          <label className="field"><span>Название</span>
            <input value={f.title} required maxLength={60} autoFocus autoComplete="off" placeholder="Например: YouTube"
              onChange={(e) => change({ title: e.target.value })} /></label>
        </div>
        <div className="emoji-picker" role="group" aria-label="Подсказки эмодзи">
          {EMOJI_SUGGESTIONS.map((e) => (
            <button key={e} type="button" className="btn small ghost" aria-pressed={f.emoji === e} onClick={() => change({ emoji: e })}>{e}</button>
          ))}
        </div>
        {(err('emoji') || err('title')) && <p className="error">{err('emoji') ?? err('title')}</p>}
        <label className="field"><span>По-кыргызски — для пациентов в боте (необязательно)</span>
          <input value={f.titleKy} maxLength={60} autoComplete="off" placeholder="Пусто — как по-русски" onChange={(e) => change({ titleKy: e.target.value })} /></label>
        {err('titleKy') && <p className="error">{err('titleKy')}</p>}
        {o.id != null && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => change({ active: e.target.checked })} /> Предлагать в карточке и пациентам в боте</label>}
        <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label={o.id ? 'Сохранить' : 'Добавить'} savedText="Вариант сохранён"
          error={save.error && (['emoji', 'title', 'titleKy'].map((k) => err(k)).find(Boolean) ?? save.error.message)} />
      </form>
      {o.id != null && (
        <p className="hint">Вариант не удаляется: у пациентов ({o.patients ?? 0}) и в «Аналитике» он остаётся. Ненужный — скройте.</p>
      )}
    </aside>
  )
}
