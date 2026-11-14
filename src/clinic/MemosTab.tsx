import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { canEditServices } from '../lib/roles'
import { useClose } from '../lib/useClose'
import { useDirty } from '../lib/unsaved'
import { Select } from '../layout/Select'
import { Loading } from '../layout/Loading'
import { HeadTools, SubHelp } from '../layout/PageHead'
import { rowOpen } from '../lib/rowClick'

type Me = Schemas['BookingViewsMe']
type Memo = Schemas['CareMemosCareMemoView']
type Lang = 'ru' | 'ky'
type Service = Schemas['ServiceTypeView']

const PHONE = '{телефон}'

/**
 * Услуги прайса, к которым привязана памятка, — по порядку прайса. Скрытые (active = false: «справочник
 * клиники», не в прайсе) не показываем: в строке они шумели («Удаление зуба сложное, …простое, молочного…»).
 */
function memoServices(m: Memo, services: Service[]): string[] {
  const ids = new Set(m.serviceIds ?? [])
  return services.filter((s) => s.active !== false && ids.has(s.id)).map((s) => s.name)
}

/**
 * Серая строка под названием памятки: до трёх услуг прайса — все; больше — две и «и ещё N» (не «и ещё 1»:
 * оно не короче самого названия). «и ещё N» — отдельно и не обрезается: длинные названия уходят в «…», а
 * сколько их ещё — видно всегда. Полный список — в карточке памятки.
 */
function ServicesLine({ names }: { names: string[] }) {
  if (names.length === 0) return <>не привязана к услугам прайса</>
  const shown = names.length <= 3 ? names : names.slice(0, 2)
  const more = names.length - shown.length
  return (
    <>
      <span className="memo-names">{shown.join(', ')}</span>
      {more > 0 && <span className="memo-more"> и ещё {more}</span>}
    </>
  )
}

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
  const prices = services.data ?? []
  const openedMemo = typeof opened === 'number' ? memos.data?.find((m) => m.id === opened) : undefined

  return (
    <>
      <section className="schedule-main">
        {header}
        <section className="card-block">
          {/* «?» — в полосу вкладок «Настроек» (SubHelp), а не своей строкой над кнопкой */}
          <SubHelp title="Памятки">Памятку отдают пациенту после приёма: «📤 Отправить пациенту» или «🖨 Печать» на карточке приёма.
            Какая памятка у услуги — в «Клиника → Услуги и цены».</SubHelp>
          {editable && <HeadTools><button type="button" className="btn primary head-end" onClick={() => setOpened('new')}>＋ Своя памятка</button></HeadTools>}
          {memos.error && <p className="error">{memos.error.message}</p>}
          {memos.isPending ? <Loading /> : (
            <ul className="memo-list" aria-label="Памятки">
              {(memos.data ?? []).map((m) => (
                <li key={m.id} {...rowOpen(() => setOpened(m.id), m.active === false && 'inactive')}>
                  <button type="button" className="row-link" onClick={() => setOpened(m.id)}>{m.title}</button>
                  <span className="hint small memo-services">
                    {m.active === false ? 'скрыта' : <ServicesLine names={memoServices(m, prices)} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
      {opened === 'new' && <MemoPanel editable onClose={close} />}
      {openedMemo && <MemoPanel key={openedMemo.id} memo={openedMemo} services={memoServices(openedMemo, prices)} editable={editable} onClose={close} />}
    </>
  )
}

/**
 * Памятка: русский и кыргызский текст — вкладками, как «Текст напоминания». Кыргызский пустой — пациенту
 * с кыргызским уйдёт русский. У стандартной памятки, которую клиника не меняла, кыргызский — перевод Tish.
 */
function MemoPanel({ memo: m, services, editable, onClose }: { memo?: Memo; services?: string[]; editable: boolean; onClose: () => void }) {
  const close = useClose(onClose)
  const client = useQueryClient()
  const [lang, setLang] = useState<Lang>('ru')
  const [form, setForm] = useState({
    title: m?.title ?? '',
    body: m?.body ?? `Сегодня:\n• \n\nЭто нормально:\n• \n\nПозвоните, если:\n• \n\nТелефон клиники: ${PHONE}. Это общие советы — если врач сказал иначе, делайте, как сказал врач.`,
    active: m ? m.active !== false : true,
    titleKy: m?.titleKy ?? '',
    bodyKy: m?.bodyKy ?? '',
  })
  const { dirty, commit } = useDirty(form)
  // Пустой кыргызский не отправляем: без него — русский текст
  const ky = { titleKy: form.titleKy.trim() || undefined, bodyKy: form.bodyKy.trim() || undefined }
  const save = useMutation<Memo, ApiError>({
    mutationFn: () => unwrap(m
      ? api.PUT('/api/care-memos/{id}', { params: { path: { id: m.id } }, body: { title: form.title, body: form.body, active: form.active, ...ky } })
      : api.POST('/api/care-memos', { body: { title: form.title, body: form.body, ...ky } })),
    onSuccess: () => {
      commit()
      void client.invalidateQueries({ queryKey: ['care-memos'] })
      void client.invalidateQueries({ queryKey: ['care-memo'] })
      if (!m) onClose()
    },
  })
  const error = (key: string) => save.error?.fieldErrors[key]
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const change = (patch: Partial<typeof form>) => {
    save.reset()
    setForm({ ...form, ...patch })
  }
  // Ошибка под кыргызским — показать его вкладку
  const kyError = error('titleKy') ?? error('bodyKy')
  return (
    <aside className="panel" aria-label={m ? 'Памятка' : 'Новая памятка'}>
      <header className="panel-head">
        <h2>{m ? m.title : 'Новая памятка'}</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>
      <div className="segments" role="group" aria-label="Язык памятки">
        <button type="button" aria-pressed={lang === 'ru'} onClick={() => setLang('ru')}>Русский</button>
        <button type="button" aria-pressed={lang === 'ky'} onClick={() => setLang('ky')}>Кыргызский{kyError ? ' ⚠' : ''}</button>
      </div>
      {/* Здесь — все услуги прайса этой памятки (в строке списка — 2–3 и «и ещё N»); привязка — в карточке услуги */}
      {m && <p className="hint small" aria-label="Услуги памятки">
        {services?.length ? <>Предложим после: {services.join(', ')}.</> : 'Не привязана к услугам прайса.'} Привязать — в «Клиника → Услуги и цены».
      </p>}
      {editable ? (
        <form className="form" onSubmit={submit}>
          {lang === 'ru' ? (
            <>
              <label className="field"><span>Название</span>
                <input value={form.title} required maxLength={100} placeholder="Например: После удаления зуба"
                  onChange={(e) => change({ title: e.target.value })} />
              </label>
              {error('title') && <p className="error">{error('title')}</p>}
              <label className="field"><span>Текст для пациента</span>
                <textarea rows={14} maxLength={3500} value={form.body} onChange={(e) => change({ body: e.target.value })} />
              </label>
              <p className="hint small">{PHONE} заменится на телефон клиники из «О клинике».</p>
              {error('body') && <p className="error">{error('body')}</p>}
            </>
          ) : (
            <KyFields form={form} memo={m} onChange={change} titleError={error('titleKy')} bodyError={error('bodyKy')} />
          )}
          {m && <label className="check"><input type="checkbox" checked={form.active}
            onChange={(e) => change({ active: e.target.checked })} /> Предлагать после приёма</label>}
          <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label={m ? 'Сохранить' : 'Добавить'} savedText="Памятка сохранена"
            error={save.error && (error('title') ?? error('body') ?? kyError ?? save.error.message)} />
        </form>
      ) : (
        <>
          <p className="hint">Памятки меняют руководитель и врачи.</p>
          {lang === 'ru' ? <p className="memo-text">{m?.body}</p>
            : m?.bodyKy ? <><h3>{m.titleKy}</h3><p className="memo-text">{m.bodyKy}</p></>
              : <p className="hint">Кыргызского текста нет — будет отправлен русский текст.</p>}
        </>
      )}
    </aside>
  )
}

type KyForm = { title: string; body: string; titleKy: string; bodyKy: string }

/**
 * Вкладка «Кыргызский»: название и текст по-кыргызски и «✨ Перевести с ИИ» — перевод русского текста из
 * редактора кладётся в поля для правки, сам не сохраняется. Кнопка — если ИИ клиники включён; ключ на
 * сервере есть, а ИИ клиники выключен — подсказка, где включить.
 */
function KyFields({ form, memo: m, onChange, titleError, bodyError }: {
  form: KyForm
  memo?: Memo
  onChange: (patch: Partial<KyForm>) => void
  titleError?: string
  bodyError?: string
}) {
  const ai = useQuery({ queryKey: ['visit-report-ai'], queryFn: () => unwrap(api.GET('/api/clinic/visit-report-ai')) })
  const translate = useMutation<Schemas['MemoTranslationsTranslation'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/care-memos/translate', { body: { title: form.title, body: form.body } })),
    onSuccess: (t) => onChange({ titleKy: t.title ?? '', bodyKy: t.body ?? '' }),
  })
  const empty = !form.titleKy.trim() && !form.bodyKy.trim()
  const standard = m?.kyStandard && form.titleKy === m.titleKy && form.bodyKy === m.bodyKy
  return (
    <>
      <label className="field"><span>Название по-кыргызски</span>
        <input value={form.titleKy} maxLength={100} placeholder="Мисалы: Тиш жулдургандан кийин"
          onChange={(e) => onChange({ titleKy: e.target.value })} />
      </label>
      {titleError && <p className="error">{titleError}</p>}
      <label className="field"><span>Текст по-кыргызски</span>
        <textarea rows={14} maxLength={3500} value={form.bodyKy} onChange={(e) => onChange({ bodyKy: e.target.value })} />
      </label>
      {bodyError && <p className="error">{bodyError}</p>}
      {empty ? <p className="hint small">Пусто — пациентам с кыргызским языком будет отправлен русский текст.</p>
        : standard ? <p className="hint small">Перевод Tish стандартной памятки — можно поправить под клинику.</p>
          : <p className="hint small">{PHONE} оставьте как есть — заменится на телефон клиники.</p>}
      {ai.data?.on ? (
        <div className="actions">
          <button type="button" className="btn" disabled={translate.isPending || !form.title.trim() || !form.body.trim()}
            onClick={() => translate.mutate()}>{translate.isPending ? 'Переводим…' : '✨ Перевести с ИИ'}</button>
        </div>
      ) : ai.data?.available ? (
        <p className="hint small">✨ Перевести с ИИ — когда руководитель включит ИИ клиники в «Настройки → ИИ в клинике».</p>
      ) : null}
      {translate.isSuccess && <p className="hint small" role="status">Перевод ИИ — в полях выше. Проверьте и сохраните.</p>}
      {translate.error && <p className="error small" role="alert">{translate.error.message}</p>}
    </>
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
        <Select value={current ?? ''} disabled={save.isPending} onChange={(e) => save.mutate(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Без памятки</option>
          {memos.data.filter((m) => m.active !== false || m.id === current).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </Select>
      </label>
      <p className="hint small">Предложим отдать пациенту после приёма. Тексты — в «Настройки → Памятки после процедур».</p>
      {save.error && <p className="error" role="alert">{save.error.message}</p>}
    </section>
  )
}
