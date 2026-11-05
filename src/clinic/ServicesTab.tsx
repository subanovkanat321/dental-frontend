import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask } from '../lib/confirm'
import { Fragment, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { useClose } from '../lib/useClose'
import { useDirty } from '../lib/unsaved'
import { canEditServices } from '../lib/roles'
import { ServiceMemo } from './MemosTab'
import { ServiceSupplies } from './ServiceSupplies'
import { StarterCard, StarterPanel } from './StarterPanel'
import { groupByCategory, monthsText, priceText, recallChoices, SERVICE_CATEGORIES } from './services'
import { Select } from '../layout/Select'
import { EmptyState } from '../layout/EmptyState'
import { clearServiceToOpen, serviceToOpen } from '../lib/openService'

type Me = Schemas['BookingViewsMe']
type Service = Schemas['ServiceTypeView']

/** Срок профосмотра клиники по умолчанию (V136); undefined — ещё загружается. */
function useClinicRecall(): number | undefined {
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')) })
  return clinic.data ? clinic.data.recallMonths ?? 6 : undefined
}

function useRefreshServices() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: ['service-types'] })
    void client.invalidateQueries({ queryKey: ['service-catalog'] })
    // Новой услуге сервер сам ставит памятку и материалы по умолчанию
    void client.invalidateQueries({ queryKey: ['care-memo-links'] })
    void client.invalidateQueries({ queryKey: ['service-supplies'] })
    void client.invalidateQueries({ queryKey: ['starter'] })
    // Услуги приходят и в me (новая запись, выбор услуги)
    void client.invalidateQueries({ queryKey: ['me'] })
    // Срок профосмотра услуги меняет списки «Профосмотр» и «Позвать снова»
    void client.invalidateQueries({ queryKey: ['recall'] })
    void client.invalidateQueries({ queryKey: ['comebacks'] })
  }
}

/**
 * «Услуги»: их видят пациенты, когда записываются сами, — группами по категориям. Длительность —
 * сколько займёт приём, цена «от» — необязательно. «Из справочника» — отметить типовые и вписать цены.
 */
/** header — шапка страницы «Клиника» (вкладки): карточка справа — соседняя колонка сетки. */
export function ServicesTab({ me, header, onPanel }: { me: Me; header: ReactNode; onPanel: (open: boolean) => void }) {
  const list = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')) })
  // Пришли из карточки приёма «Настроить материалы услуги» — сразу открыта эта услуга
  const [opened, setOpenedState] = useState<number | 'new' | 'catalog' | 'starter' | null>(serviceToOpen)
  const setOpened = useCallback((next: number | 'new' | 'catalog' | 'starter' | null) => {
    setOpenedState(next)
    onPanel(next != null)
  }, [onPanel])
  const close = useCallback(() => setOpened(null), [setOpened])
  useEffect(() => {
    if (serviceToOpen() == null) return
    clearServiceToOpen()
    onPanel(true)
  }, [onPanel])
  const services = list.data ?? []
  const editable = canEditServices(me)
  const openedService = typeof opened === 'number' ? services.find((s) => s.id === opened) : undefined

  return (
    <>
      <section className="schedule-main">
      {header}
      {editable && (services.length > 0 || Boolean(me.admin)) && <StarterCard admin={Boolean(me.admin)} onOpen={() => setOpened('starter')} />}
      <section className="card-block">
        <div className="block-head">
          <p className="hint">Их видят пациенты, когда записываются сами в боте. Длительность — сколько времени займёт приём.</p>
          {/* Менять услуги — админ и врачи; регистратуре и ассистенту сервер ответит 403: только список */}
          {editable && (
            <span className="actions">
              <button type="button" className="btn" onClick={() => setOpened('catalog')}>Из справочника</button>
              <button type="button" className="btn primary" onClick={() => setOpened('new')}>+ Добавить услугу</button>
            </span>
          )}
        </div>
        <RecallDefault admin={Boolean(me.admin)} />
        {list.error && <p className="error">{list.error.message}</p>}
        {list.isPending ? <p className="hint">Загрузка…</p> : services.length ? (
          <table className="table" aria-label="Услуги">
            <thead><tr><th>Услуга</th><th className="r">Длительность</th><th className="r">Цена</th><th className="r">Профосмотр</th><th /></tr></thead>
            <tbody>
              {groupByCategory(services).map(({ category, items }) => (
                <Fragment key={category ?? '—'}>
                  <tr className="group-row"><th colSpan={5} scope="colgroup">{category || 'Другое'}</th></tr>
                  {items.map((s) => (
                    <tr key={s.id} className={[s.id === opened ? 'active' : '', s.active === false ? 'inactive' : ''].join(' ').trim() || undefined}>
                      <td>{editable ? <button type="button" className="row-link" onClick={() => setOpened(s.id!)}>{s.name}</button> : s.name}</td>
                      <td className="r num nowrap">{s.durationMinutes} мин</td>
                      <td className="r num nowrap">{priceText(s.priceSom) ?? '—'}</td>
                      <td className="r num nowrap">{s.recallMonths ? `через ${monthsText(s.recallMonths)}` : <span className="hint">как в клинике</span>}</td>
                      <td className="hint">{s.active === false ? 'скрыта' : ''}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : <EmptyState icon="🦷" title="Услуг пока нет.">Добавьте свои или отметьте типовые в справочнике.</EmptyState>}
      </section>
      </section>
      {opened === 'new' && <ServicePanel me={me} all={services} onClose={close} />}
      {openedService && <ServicePanel key={openedService.id} me={me} service={openedService} all={services} onClose={close} />}
      {opened === 'catalog' && <CatalogPanel onClose={close} />}
      {opened === 'starter' && <StarterPanel admin={Boolean(me.admin)} onClose={close} />}
    </>
  )
}

/** Новая услуга или правка: название, категория, длительность, цена «от», показывать пациентам. */
function ServicePanel({ me, service: s, all, onClose }: { me: Me; service?: Service; all: Service[]; onClose: () => void }) {
  const close = useClose(onClose)
  const refresh = useRefreshServices()
  const [form, setForm] = useState({
    name: s?.name ?? '', category: s?.category ?? '', duration: String(s?.durationMinutes ?? 30),
    price: s?.priceSom == null ? '' : String(s.priceSom), active: s ? s.active !== false : true,
    recall: s?.recallMonths == null ? '' : String(s.recallMonths),
  })
  const clinicRecall = useClinicRecall() ?? 6
  const [done, setDone] = useState('')
  const { dirty, commit } = useDirty(form)
  const known = [...new Set([...SERVICE_CATEGORIES, ...all.map((x) => x.category).filter((c): c is string => Boolean(c))])]
  const save = useMutation<Service, ApiError>({
    mutationFn: () => {
      const body = {
        name: form.name, category: form.category, durationMinutes: Number(form.duration), active: form.active,
        priceSom: form.price === '' ? undefined : Number(form.price),
        // Пусто — срок клиники: поле не шлём, сервер ставит null
        recallMonths: form.recall === '' ? undefined : Number(form.recall),
      }
      return unwrap(s
        ? api.PUT('/api/service-types/{id}', { params: { path: { id: s.id! } }, body })
        : api.POST('/api/service-types', { body }))
    },
    onSuccess: () => {
      commit()
      refresh()
      // Новая услуга добавлена — карточка закрывается, услуга уже в списке
      if (!s) onClose()
    },
  })
  const remove = useMutation<Schemas['ServiceTypeControllerDeleted'], ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/service-types/{id}', { params: { path: { id: s!.id! } } })),
    onSuccess: (r) => {
      refresh()
      if (r.deleted) onClose()
      else setDone('Услуга есть в записях — её скрыли от пациентов')
    },
  })
  const error = (key: string) => save.error?.fieldErrors[key]
  const set = (key: 'name' | 'category' | 'duration' | 'price' | 'recall') => (e: { target: { value: string } }) => {
    setDone('')
    save.reset()
    setForm({ ...form, [key]: e.target.value })
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setDone('')
    save.mutate()
  }

  return (
    <aside className="panel" aria-label={s ? 'Услуга' : 'Новая услуга'}>
      <header className="panel-head">
        <h2>{s ? s.name : 'Новая услуга'}</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Название</span>
          <input value={form.name} required maxLength={100} autoFocus={!s} placeholder="Например: Лечение кариеса" onChange={set('name')} />
        </label>
        {error('name') && <p className="error">{error('name')}</p>}
        <div className="field"><span>Категория</span>
          <div className="chips-pick" role="group" aria-label="Категории">
            {known.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={form.category === c}
                onClick={() => { save.reset(); setForm({ ...form, category: form.category === c ? '' : c }) }}>{c}</button>
            ))}
          </div>
          <input aria-label="Категория" value={form.category} maxLength={40} placeholder="Или своя: например, Терапия" onChange={set('category')} />
        </div>
        {error('category') && <p className="error">{error('category')}</p>}
        <div className="row">
          <label className="field"><span>Длительность, мин</span>
            <input type="number" min={15} max={240} step={15} required value={form.duration} onChange={set('duration')} />
          </label>
          <label className="field"><span>Цена «от», сом</span>
            <input type="number" min={0} inputMode="numeric" placeholder="Не показывать" value={form.price} onChange={set('price')} />
          </label>
        </div>
        {(error('durationMinutes') || error('priceSom')) && <p className="error">{error('durationMinutes') ?? error('priceSom')}</p>}
        <div className="field"><span>Профосмотр через</span>
          <Select aria-label="Профосмотр через" value={form.recall} onChange={set('recall')}>
            <option value="">{`Как в клинике (${monthsText(clinicRecall)})`}</option>
            {recallChoices(s?.recallMonths).map((m) => <option key={m} value={m}>{monthsText(m)}</option>)}
          </Select>
          <span className="hint small">Через сколько месяцев после этой услуги позвать пациента снова</span>
        </div>
        {error('recallMonths') && <p className="error">{error('recallMonths')}</p>}
        {s && <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => { setDone(''); save.reset(); setForm({ ...form, active: e.target.checked }) }} /> Показывать пациентам</label>}
        {done && <p className="tone-ok" role="status">{done}</p>}
        <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label={s ? 'Сохранить' : 'Добавить'} savedText="Услуга сохранена"
          error={save.error && (['name', 'category', 'durationMinutes', 'priceSom', 'recallMonths'].map((k) => error(k)).find(Boolean) ?? save.error.message)} />
      </form>
      {s && <ServiceSupplies serviceId={s.id!} />}
      {s && <ServiceMemo serviceId={s.id!} />}
      {s && me.admin && (
        <div className="danger-zone">
          <button type="button" className="btn danger" disabled={remove.isPending}
            onClick={() => void ask(`Удалить услугу «${s.name}»?`).then((ok) => ok && remove.mutate())}>Удалить услугу</button>
          {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
        </div>
      )}
    </aside>
  )
}

/**
 * «Профосмотр по умолчанию»: через сколько месяцев звать после приёма без услуги или услуги без
 * своего срока. Меняет админ (сервер ответит 403 остальным) — остальным только текст.
 */
function RecallDefault({ admin }: { admin: boolean }) {
  const client = useQueryClient()
  const months = useClinicRecall()
  const save = useMutation<Schemas['ClinicControllerRecallMonths'], ApiError, number>({
    mutationFn: (recallMonths) => unwrap(api.PUT('/api/clinic/recall-months', { body: { recallMonths } })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['clinic'] })
      void client.invalidateQueries({ queryKey: ['recall'] })
      void client.invalidateQueries({ queryKey: ['comebacks'] })
    },
  })
  if (months == null) return null
  return (
    <div className="recall-default" aria-label="Профосмотр по умолчанию">
      {admin ? (
        <label className="field inline"><span>Профосмотр по умолчанию: через</span>
          <Select aria-label="Профосмотр по умолчанию" value={String(months)} disabled={save.isPending}
            onChange={(e) => save.mutate(Number(e.target.value))}>
            {recallChoices(months).map((m) => <option key={m} value={m}>{monthsText(m)}</option>)}
          </Select>
        </label>
      ) : <p>Профосмотр по умолчанию: через {monthsText(months)}</p>}
      <p className="hint small">Для приёмов без услуги и услуг без своего срока. Свой срок — в карточке услуги.</p>
      {save.isSuccess && <p className="tone-ok small" role="status">Срок сохранён</p>}
      {save.error && <p className="error" role="alert">{Object.values(save.error.fieldErrors)[0] ?? save.error.message}</p>}
    </div>
  )
}

/**
 * «Справочник услуг»: типовые услуги по разделам — отметить свои и вписать цену «от», не набирая
 * прайс с нуля. Что у клиники уже есть, отмечено «есть» и второй раз не добавится (проверяет сервер).
 */
function CatalogPanel({ onClose }: { onClose: () => void }) {
  useClose(onClose)
  const refresh = useRefreshServices()
  const sections = useQuery({ queryKey: ['service-catalog'], queryFn: () => unwrap(api.GET('/api/service-types/catalog')) })
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [done, setDone] = useState('')
  const add = useMutation<Schemas['ServiceTypeControllerAdded'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/service-types/catalog', {
      body: { items: Object.entries(picked).map(([name, price]) => ({ name, priceSom: price === '' ? undefined : Number(price) })) },
    })),
    onSuccess: (r) => {
      setPicked({})
      setDone(`Добавлено услуг: ${r.added ?? 0}`)
      refresh()
    },
  })
  const count = Object.keys(picked).length
  const toggle = (name: string, on: boolean, typical?: number | null) => {
    setDone('')
    const next = { ...picked }
    // Обычная цена «от» по Бишкеку — сразу в поле: поправить проще, чем вписать
    if (on) next[name] = typical == null ? '' : String(typical)
    else delete next[name]
    setPicked(next)
  }

  return (
    <aside className="panel" aria-label="Справочник услуг">
      <header className="panel-head">
        <div>
          <h2>Справочник услуг</h2>
          <span className="hint">Отметьте услуги клиники и проверьте цену «от»: где знаем, подставили обычную по Бишкеку.</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      {sections.isPending && <p className="hint">Загрузка…</p>}
      {sections.error && <p className="error">{sections.error.message}</p>}
      {sections.data?.map((sec) => {
        const fresh = (sec.items ?? []).filter((i) => !i.added).length
        return (
          <details key={sec.category} className="catalog-section">
            <summary>{sec.category} <span className="hint">· {fresh ? `${fresh} новых` : 'всё есть'}</span></summary>
            {(sec.items ?? []).map((item) => item.added ? (
              <div key={item.name} className="catalog-row"><span>{item.name} <span className="hint">· {item.durationMinutes} мин</span></span><span className="hint tone-ok">есть</span></div>
            ) : (
              <div key={item.name} className="catalog-row">
                <label className="check"><input type="checkbox" checked={item.name! in picked} onChange={(e) => toggle(item.name!, e.target.checked, item.typicalPriceSom)} />
                  {item.name} <span className="hint">· {item.durationMinutes} мин</span></label>
                {item.name! in picked && (
                  <input type="number" min={0} inputMode="numeric" placeholder="цена" aria-label={`Цена: ${item.name}`}
                    value={picked[item.name!]} onChange={(e) => setPicked({ ...picked, [item.name!]: e.target.value })} />
                )}
              </div>
            ))}
          </details>
        )
      })}
      {add.error && <p className="error" role="alert">{Object.values(add.error.fieldErrors)[0] ?? add.error.message}</p>}
      {done && <p className="tone-ok" role="status">{done}</p>}
      <button type="button" className="btn primary" disabled={!count || add.isPending} onClick={() => add.mutate()}>
        {count ? `Добавить выбранные (${count})` : 'Добавить выбранные'}</button>
    </aside>
  )
}
