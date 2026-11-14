import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Segments } from '../layout/Segments'
import { DateInput } from '../layout/DateInput'
import { Icon } from '../layout/Icon'
import { Select } from '../layout/Select'
import { ask, notify } from '../lib/confirm'
import { addDays, dateOf, dayTitle, timeOf, todayIn } from '../lib/time'
import { Loading, Spinner } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'

type Entry = Schemas['AuditLogEntry']
type Category = NonNullable<Entry['category']>

/** Разделы журнала — как на сервере (AuditActions.Category), в этом порядке. */
const CATEGORIES: [Category, string][] = [
  ['APPOINTMENTS', 'Записи'],
  ['MONEY', 'Деньги'],
  ['STAFF', 'Персонал'],
  ['PATIENTS', 'Пациенты и медкарта'],
  ['CATALOG', 'Склад и услуги'],
  ['SETTINGS', 'Настройки и данные'],
  ['OTHER', 'Прочее'],
]

type Period = 'all' | 'today' | 'week' | 'month' | 'custom'
const PERIODS: [Period, string][] = [['all', 'Всё время'], ['today', 'Сегодня'], ['week', 'Неделя'], ['month', 'Месяц'], ['custom', 'Свои даты']]

/** Неделя и месяц — последние 7 и 30 дней по Бишкеку, включая сегодня. */
function rangeOf(period: Period, custom: { from: string; to: string }): { from?: string; to?: string } {
  const today = todayIn()
  if (period === 'today') return { from: today, to: today }
  if (period === 'week') return { from: addDays(today, -6), to: today }
  if (period === 'month') return { from: addDays(today, -29), to: today }
  if (period === 'custom') return { from: custom.from || undefined, to: custom.to || undefined }
  return {}
}

const PAGE = 50

/**
 * «Журнал действий» (админ): важные действия сотрудников — без имён и телефонов пациентов. Фильтры
 * (сотрудник, тип, период) считает сервер, страницы по 50 — «Показать ещё» (курсор из ответа).
 * «Настроить журнал» — что записывать: частые действия можно выключить, обязательные — нет.
 */
export function AuditJournal() {
  const [who, setWho] = useState('')
  const [category, setCategory] = useState<Category | ''>('')
  const [period, setPeriod] = useState<Period>('all')
  const [custom, setCustom] = useState({ from: addDays(todayIn(), -6), to: todayIn() })
  const [tuning, setTuning] = useState(false)
  const range = rangeOf(period, custom)
  const query = {
    who: who ? Number(who) : undefined,
    category: category || undefined,
    from: range.from,
    to: range.to,
    limit: PAGE,
  }
  const people = useQuery({ queryKey: ['clinic-audit-people'], queryFn: () => unwrap(api.GET('/api/clinic/audit/people')) })
  const audit = useInfiniteQuery<Schemas['AuditLogPage'], ApiError>({
    queryKey: ['clinic-audit', query],
    queryFn: ({ pageParam }) => unwrap(api.GET('/api/clinic/audit', {
      params: { query: { ...query, cursor: (pageParam as string | undefined) || undefined } },
    })),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
  })
  const items = audit.data?.pages.flatMap((p) => p.items ?? []) ?? []
  const total = audit.data?.pages[0]?.total ?? 0
  const days = new Map<string, Entry[]>()
  for (const x of items) {
    const day = x.at ? dateOf(x.at) : ''
    days.set(day, [...(days.get(day) ?? []), x])
  }
  const filtered = Boolean(who || category || period !== 'all')
  const reset = () => { setWho(''); setCategory(''); setPeriod('all') }

  return (
    <section className="card-block audit">
      <div className="block-head">
        <h2>Журнал действий</h2>
        <button type="button" className="link" aria-expanded={tuning} onClick={() => setTuning(!tuning)}>
          {tuning ? 'Скрыть настройку' : 'Настроить журнал'}</button>
      </div>
      <p className="hint">Кто из сотрудников и когда: записи, оплаты, персонал, услуги и цены, удаления, выгрузка. Пациенты — только
        номером карточки или датой и врачом записи: имён, телефонов и медданных здесь нет.</p>
      {tuning && <AuditSettings onClose={() => setTuning(false)} />}

      <div className="filters audit-filters" role="group" aria-label="Фильтры журнала">
        <Select aria-label="Сотрудник" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Все сотрудники</option>
          {(people.data ?? []).map((p) => <option key={p.telegramId} value={String(p.telegramId)}>{p.name}</option>)}
        </Select>
        <Select aria-label="Тип" value={category} onChange={(e) => setCategory(e.target.value as Category | '')}>
          <option value="">Все типы</option>
          {CATEGORIES.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
        </Select>
        <Segments className="audit-period" label="Период" value={period} onChange={setPeriod} options={PERIODS.map(([key, title]) => ({ value: key, label: title }))} />
      </div>
      {period === 'custom' && (
        <div className="row dates audit-dates">
          <label className="field"><span>С</span>
            <DateInput aria-label="С дня" value={custom.from} max={custom.to || todayIn()}
              onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} /></label>
          <label className="field"><span>По</span>
            <DateInput aria-label="По день" value={custom.to} min={custom.from} max={todayIn()}
              onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} /></label>
        </div>
      )}

      {audit.error && <p className="error" role="alert">{audit.error.message}</p>}
      {audit.isPending ? <Loading /> : items.length ? (
        <>
          <p className="hint small audit-count" role="status">
            {filtered ? 'Найдено' : 'Всего'}: {total.toLocaleString('ru-RU')}{items.length < total ? `, показано ${items.length}` : ''}
          </p>
          <div className="table-scroll">
            <table className="table audit-table" aria-label="Журнал действий">
              <tbody>
                {[...days.entries()].map(([day, list]) => (
                  <Fragment key={day}>
                    <tr className="group-row"><th colSpan={3} scope="colgroup">{day ? dayTitle(day) : ''}</th></tr>
                    {list.map((x) => (
                      <tr key={x.id}>
                        <td className="nowrap num hint">{x.at ? timeOf(x.at) : ''}</td>
                        <td className="strong audit-who">{x.who}</td>
                        <td>{x.text}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {audit.hasNextPage && (
            <button type="button" className="btn audit-more" disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
              {audit.isFetchingNextPage ? <><Spinner />Загружаем…</> : `Показать ещё${total - items.length > 0 ? ` (осталось ${total - items.length})` : ''}`}
            </button>
          )}
        </>
      ) : filtered ? (
        <EmptyState title="По фильтру ничего" action={<button type="button" className="btn" onClick={reset}>Сбросить фильтры</button>} />
      ) : <EmptyState title="Журнал пока пуст">Здесь появятся действия сотрудников: записи, оплаты, персонал, цены, удаления.</EmptyState>}
    </section>
  )
}

/**
 * «Что записывать»: галочки у отключаемых действий; обязательные — серые, с замком. Выключенное
 * сервер не записывает вовсе. Сохранение само попадает в журнал (кто и что выключил).
 */
function AuditSettings({ onClose }: { onClose: () => void }) {
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ['clinic-audit-settings'], queryFn: () => unwrap(api.GET('/api/clinic/audit/settings')) })
  // Правки галочек до «Сохранить»; null — как на сервере
  const [edits, setEdits] = useState<Set<string> | null>(null)
  const actions = settings.data?.actions ?? []
  const saved = new Set(actions.filter((a) => !a.mandatory && !a.enabled).map((a) => a.code ?? ''))
  const off = settings.data ? edits ?? saved : null
  const changed = off != null && (off.size !== saved.size || [...off].some((c) => !saved.has(c)))
  const save = useMutation<Schemas['AuditControllerSettings'], ApiError, string[]>({
    mutationFn: (disabled) => unwrap(api.PUT('/api/clinic/audit/settings', { body: { disabled } })),
    onSuccess: (data) => {
      client.setQueryData(['clinic-audit-settings'], data)
      void client.invalidateQueries({ queryKey: ['clinic-audit'] })
      void client.invalidateQueries({ queryKey: ['clinic-audit-people'] })
      void notify('Настройка журнала сохранена. Это изменение тоже записано в журнал.')
      onClose()
    },
  })
  const submit = async () => {
    if (!off) return
    const newlyOff = actions.filter((a) => a.code && off.has(a.code) && !saved.has(a.code)).map((a) => `«${(a.title ?? '').replace(/^«|»$/g, '')}»`)
    if (newlyOff.length && !await ask(`Выключить запись: ${newlyOff.join(', ')}? Эти действия перестанут попадать в журнал — задним числом их не восстановить.`, { ok: 'Выключить' })) return
    save.mutate([...off])
  }
  const toggle = (code: string, enabled: boolean) => {
    const next = new Set(off ?? [])
    if (enabled) next.delete(code)
    else next.add(code)
    setEdits(next)
  }

  return (
    <div className="audit-settings" role="region" aria-label="Что записывать">
      <h3>Что записывать</h3>
      <p className="hint small">По умолчанию записывается всё. Частые действия можно выключить — тогда они не попадут в журнал вовсе.
        Деньги, удаления, персонал и права, выгрузка, договор и оплата приложения записываются всегда.</p>
      {settings.error && <p className="error">{settings.error.message}</p>}
      {settings.isPending || !off ? <Loading /> : (
        <>
          <div className="audit-groups">
            {CATEGORIES.filter(([key]) => actions.some((a) => a.category === key)).map(([key, title]) => (
              <fieldset key={key} className="audit-group">
                <legend>{title}</legend>
                {actions.filter((a) => a.category === key).map((a) => a.mandatory ? (
                  <label key={a.code} className="check audit-opt locked">
                    <input type="checkbox" checked disabled />
                    <span>{a.title}</span>
                    <span className="audit-lock" title="Записывается всегда"><Icon name="lock" />записывается всегда</span>
                  </label>
                ) : (
                  <label key={a.code} className="check audit-opt">
                    <input type="checkbox" checked={!off.has(a.code ?? '')} onChange={(e) => toggle(a.code ?? '', e.target.checked)} />
                    <span>{a.title}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          {save.error && <p className="error" role="alert">{save.error.fieldErrors.disabled ?? save.error.message}</p>}
          <div className="audit-settings-actions">
            <button type="button" className="btn primary" disabled={!changed || save.isPending} onClick={() => void submit()}>
              {save.isPending ? <><Spinner />Сохраняем…</> : 'Сохранить'}</button>
            <button type="button" className="btn" onClick={onClose}>Отмена</button>
          </div>
        </>
      )}
    </div>
  )
}
