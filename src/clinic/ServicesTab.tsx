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
import { groupLabel, groupServices, monthsText, nameMatches, priceText, recallChoices, SERVICE_GROUPS, type ServiceGroup } from './services'
import { Select } from '../layout/Select'
import { EmptyState } from '../layout/EmptyState'
import { clearServiceToOpen, serviceToOpen } from '../lib/openService'
import { Loading } from '../layout/Loading'
import { useDebounced } from '../lib/useDebounced'

type Me = Schemas['BookingViewsMe']
type Service = Schemas['ServiceTypeView']

/** Срок профосмотра клиники по умолчанию (V136); undefined — ещё загружается. */
function useClinicRecall(): number | undefined {
  const clinic = useQuery({ queryKey: ['clinic'], queryFn: () => unwrap(api.GET('/api/clinic')) })
  return clinic.data ? clinic.data.recallMonths : undefined
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
 * Включить услугу из «справочника клиники» (active = false → true): она снова в прайсе — её видят пациент
 * при самозаписи и сотрудник в «Новой записи», плане лечения и оплате. Остальные поля — как были
 * (старую категорию не шлём — сервер её оставит).
 */
function useEnableService() {
  const refresh = useRefreshServices()
  return useMutation<Service, ApiError, Service>({
    mutationFn: (s) => unwrap(api.PUT('/api/service-types/{id}', {
      params: { path: { id: s.id } },
      body: {
        name: s.name, group: s.group, durationMinutes: s.durationMinutes, active: true,
        priceSom: s.priceSom ?? undefined, recallMonths: s.recallMonths ?? undefined,
      },
    })),
    onSuccess: refresh,
  })
}

/**
 * «Услуги и цены»: сверху прайс — показываемые услуги (их выбирают пациент при самозаписи и сотрудники
 * в записи, плане и оплате), группами по разделам. Ниже свёрнуто «Ещё в справочнике клиники» — скрытые
 * (active = false): не в прайсе, но на месте, «Включить» возвращает. «＋ Добавить услугу из справочника» —
 * полный справочник Tish: отметить типовые и вписать цены.
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
  const everything = list.data ?? []
  // Прайс — показываемые; скрытые — ниже, в «Ещё в справочнике клиники»
  const services = everything.filter((s) => s.active !== false)
  const hidden = everything.filter((s) => s.active === false)
  // Поиск и раздел — мгновенно, на фронте: услуг у клиники десятки, а не тысячи
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<ServiceGroup | ''>('')
  const found = services.filter((s) => nameMatches(s.name, query))
  const hiddenFound = hidden.filter((s) => nameMatches(s.name, query) && (!group || (s.group ?? 'OTHER') === group))
  const counts = new Map(groupServices(found).map((g) => [g.group, g.items.length]))
  const shown = group ? found.filter((s) => (s.group ?? 'OTHER') === group) : found
  // Разделы сворачиваются: услуг десятки — без этого до нужного раздела долго листать. Сначала свёрнуты, если
  // услуг много; при поиске и выбранном разделе — всё раскрыто (иначе найденное спрятано)
  const [toggled, setToggled] = useState<Set<ServiceGroup>>(new Set())
  const foldByDefault = services.length > 12
  const isOpen = (g: ServiceGroup) => Boolean(query.trim() || group) || (foldByDefault ? toggled.has(g) : !toggled.has(g))
  const toggle = (g: ServiceGroup) => setToggled((prev) => {
    const next = new Set(prev)
    if (next.has(g)) next.delete(g)
    else next.add(g)
    return next
  })
  const editable = canEditServices(me)
  const openedService = typeof opened === 'number' ? everything.find((s) => s.id === opened) : undefined

  return (
    <>
      <section className="schedule-main">
      {header}
      {editable && (everything.length > 0 || Boolean(me.admin)) && <StarterCard admin={Boolean(me.admin)} onOpen={() => setOpened('starter')} />}
      <section className="card-block">
        <div className="block-head">
          <div>
            <p className="price-lead">В прайсе — основные услуги. Делаете что-то ещё — включите из справочника.</p>
            <p className="hint small">Из прайса выбирают пациенты в боте и на сайте и вы — в записи, плане лечения и оплате.</p>
          </div>
          {/* Менять услуги — админ и врачи; регистратуре и ассистенту сервер ответит 403: только список */}
          {editable && (
            <span className="actions">
              <button type="button" className="btn primary" onClick={() => setOpened('catalog')}>＋ Добавить услугу из справочника</button>
              <button type="button" className="btn" onClick={() => setOpened('new')}>＋ Своя услуга</button>
            </span>
          )}
        </div>
        {list.error && <p className="error">{list.error.message}</p>}
        {services.length > 0 && (
          <div className="service-filter">
            <input type="search" aria-label="Найти услугу" placeholder="Найти услугу" value={query} onChange={(e) => setQuery(e.target.value)} />
            {/* Разделы с количеством; на телефоне ряд листается вбок, страница — нет */}
            <div className="service-chips" role="group" aria-label="Разделы">
              <button type="button" className="chip" aria-pressed={!group} onClick={() => setGroup('')}>Все · {found.length}</button>
              {SERVICE_GROUPS.filter(([code]) => counts.has(code) || code === group).map(([code, label]) => (
                <button key={code} type="button" className="chip" aria-pressed={code === group}
                  onClick={() => setGroup(code === group ? '' : code)}>{label} · {counts.get(code) ?? 0}</button>
              ))}
            </div>
          </div>
        )}
        {list.isPending ? <Loading /> : services.length ? shown.length ? (
          <table className="table services-table" aria-label="Услуги">
            <thead><tr><th>Услуга</th><th className="r">Длительность</th><th className="r">Цена</th><th className="r">Профосмотр</th></tr></thead>
            <tbody>
              {groupServices(shown).map(({ group: g, items }) => (
                <Fragment key={g}>
                  <tr className="group-row">
                    <th colSpan={4} scope="colgroup">
                      <button type="button" className="group-toggle" aria-expanded={isOpen(g)} onClick={() => toggle(g)}>
                        <span className="group-chev" aria-hidden="true">{isOpen(g) ? '▾' : '▸'}</span> {`${groupLabel(g)} · ${items.length}`}
                      </button>
                    </th>
                  </tr>
                  {isOpen(g) && items.map((s) => (
                    <tr key={s.id} className={s.id === opened ? 'active' : undefined}>
                      <td>{editable ? <button type="button" className="row-link" onClick={() => setOpened(s.id)}>{s.name}</button> : s.name}</td>
                      <td className="r num nowrap">{s.durationMinutes} мин</td>
                      <td className="r num nowrap">{priceText(s.priceSom) ?? '—'}</td>
                      <td className="r num nowrap">{s.recallMonths ? `через ${monthsText(s.recallMonths)}` : <span className="hint">как в клинике</span>}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : hiddenFound.length ? <p className="hint">В прайсе не нашли — есть ниже, в справочнике клиники.</p> : (
          <EmptyState title="Ничего не нашлось">
            {query.trim() ? `Нет услуг со словами «${query.trim()}»${group ? ` в разделе «${groupLabel(group)}»` : ''}.` : 'В этом разделе услуг нет.'}{' '}
            <button type="button" className="link" onClick={() => { setQuery(''); setGroup('') }}>Показать все</button>
          </EmptyState>
        ) : hidden.length ? <EmptyState title="В прайсе пока пусто">Включите услуги ниже или добавьте из справочника.</EmptyState>
          : <EmptyState title="Услуг пока нет">Добавьте свои или отметьте типовые в справочнике.</EmptyState>}
        {hidden.length > 0 && (
          <ClinicCatalog services={hiddenFound} total={hidden.length} editable={editable} opened={opened}
            searching={Boolean(query.trim() || group)} onOpen={(id) => setOpened(id)} />
        )}
        {/* Срок по умолчанию — под списком: сверху поиск и разделы, услуги находятся быстрее */}
        <RecallDefault admin={Boolean(me.admin)} />
      </section>
      </section>
      {opened === 'new' && <ServicePanel me={me} onClose={close} />}
      {openedService && <ServicePanel key={openedService.id} me={me} service={openedService} onClose={close} />}
      {opened === 'catalog' && <CatalogPanel onClose={close} />}
      {opened === 'starter' && <StarterPanel admin={Boolean(me.admin)} onClose={close} />}
    </>
  )
}

/**
 * «Ещё в справочнике клиники»: скрытые услуги (active = false) — не в прайсе, но не удалены: прошлые приёмы
 * и цены на месте. Свёрнуто — прайс сверху остаётся коротким; при поиске и выбранном разделе раскрыто.
 * «Включить» — обратно в прайс одним нажатием.
 */
function ClinicCatalog({ services, total, editable, opened, searching, onOpen }: {
  services: Service[]; total: number; editable: boolean; opened: unknown; searching: boolean; onOpen: (id: number) => void
}) {
  const enable = useEnableService()
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState('')
  const shown = open || (searching && services.length > 0)
  return (
    <section className="clinic-catalog" aria-label="Ещё в справочнике клиники">
      <button type="button" className="group-toggle clinic-catalog-head" aria-expanded={shown} onClick={() => setOpen(!shown)}>
        <span className="group-chev" aria-hidden="true">{shown ? '▾' : '▸'}</span>{' '}
        <span>Ещё в справочнике клиники: <b className="num">{total}</b> <span className="hint">— включить, если делаете</span></span>
      </button>
      {enabled && <p className="tone-ok small" role="status">{`«${enabled}» — снова в прайсе`}</p>}
      {enable.error && <p className="error" role="alert">{Object.values(enable.error.fieldErrors)[0] ?? enable.error.message}</p>}
      {shown && (
        <ul className="clinic-catalog-list">
          {services.map((s) => (
            <li key={s.id} className={s.id === opened ? 'active' : undefined}>
              <span className="clinic-catalog-name">
                {editable ? <button type="button" className="row-link" onClick={() => onOpen(s.id)}>{s.name}</button> : s.name}
                <span className="hint"> · {s.durationMinutes} мин{priceText(s.priceSom) ? ` · ${priceText(s.priceSom)}` : ''}</span>
              </span>
              {editable && (
                <button type="button" className="btn small" aria-label={`Включить: ${s.name}`} disabled={enable.isPending}
                  onClick={() => enable.mutate(s, { onSuccess: () => setEnabled(s.name) })}>Включить</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Новая услуга или правка: название, категория, длительность, цена «от», показывать пациентам. */
function ServicePanel({ me, service: s, onClose }: { me: Me; service?: Service; onClose: () => void }) {
  const close = useClose(onClose)
  const refresh = useRefreshServices()
  const [form, setForm] = useState({
    // Раздел: у услуги — её (выбранный или угаданный сервером); у новой — пусто, пока не выбрали руками
    name: s?.name ?? '', group: (s?.group ?? '') as ServiceGroup | '', duration: String(s?.durationMinutes ?? 30),
    price: s?.priceSom == null ? '' : String(s.priceSom), active: s ? s.active !== false : true,
    recall: s?.recallMonths == null ? '' : String(s.recallMonths),
  })
  const clinicRecall = useClinicRecall() ?? 6
  const [done, setDone] = useState('')
  const { dirty, commit } = useDirty(form)
  // Новая услуга: раздел подбирает сервер по названию (те же правила, что у старых услуг) — можно поменять
  const guessName = useDebounced(s ? '' : form.name.trim())
  const guess = useQuery({
    queryKey: ['service-group-guess', guessName],
    queryFn: () => unwrap(api.GET('/api/service-types/group-guess', { params: { query: { name: guessName } } })),
    enabled: guessName.length >= 3,
    staleTime: Infinity,
  })
  const guessed = guessName.length >= 3 ? guess.data?.group : undefined
  const group: ServiceGroup = form.group || guessed || 'OTHER'
  const save = useMutation<Service, ApiError>({
    mutationFn: () => {
      const body = {
        // Старую категорию (свободный текст) не шлём — сервер её сохранит как была
        name: form.name, group, durationMinutes: Number(form.duration), active: form.active,
        priceSom: form.price === '' ? undefined : Number(form.price),
        // Пусто — срок клиники: поле не шлём, сервер ставит null
        recallMonths: form.recall === '' ? undefined : Number(form.recall),
      }
      return unwrap(s
        ? api.PUT('/api/service-types/{id}', { params: { path: { id: s.id } }, body })
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
    mutationFn: () => unwrap(api.DELETE('/api/service-types/{id}', { params: { path: { id: s!.id } } })),
    onSuccess: (r) => {
      refresh()
      if (r.deleted) onClose()
      else setDone('Услуга есть в записях — её убрали из прайса в «Ещё в справочнике клиники»')
    },
  })
  const error = (key: string) => save.error?.fieldErrors[key]
  const set = (key: 'name' | 'group' | 'duration' | 'price' | 'recall') => (e: { target: { value: string } }) => {
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
        <div className="field"><span>Раздел</span>
          <Select aria-label="Раздел" value={group} onChange={set('group')}>
            {SERVICE_GROUPS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </Select>
          {!s && !form.group && guessed && <span className="hint small">Подобрали по названию — можно поменять</span>}
        </div>
        {error('group') && <p className="error">{error('group')}</p>}
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
        {s && (
          <div className="field">
            <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => { setDone(''); save.reset(); setForm({ ...form, active: e.target.checked }) }} /> В прайсе</label>
            <span className="hint small">{form.active
              ? 'Её выбирают пациенты при записи и сотрудники — в записи, плане и оплате'
              : 'Не в прайсе — в справочнике клиники: при записи не предлагается, прошлые приёмы на месте'}</span>
          </div>
        )}
        {done && <p className="tone-ok" role="status">{done}</p>}
        <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label={s ? 'Сохранить' : 'Добавить'} savedText="Услуга сохранена"
          error={save.error && (['name', 'group', 'durationMinutes', 'priceSom', 'recallMonths'].map((k) => error(k)).find(Boolean) ?? save.error.message)} />
      </form>
      {s && <ServiceSupplies serviceId={s.id} />}
      {s && <ServiceMemo serviceId={s.id} />}
      {s && me.admin && <MergeService service={s} onMerged={onClose} />}
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
 * «Объединить с…» (руководитель): лишняя услуга-дубль сливается с основной — приёмы, план лечения,
 * «врач оказывает», материалы и памятка переходят на основную, лишняя исчезает из прайса. Цена и
 * длительность — основной; суммы прошлых приёмов хранятся в самих приёмах. Отменить нельзя — поэтому
 * сначала выбор, потом подтверждение. Основная — только из показываемых пациентам (скрытую сервер не примет).
 */
function MergeService({ service: s, onMerged }: { service: Service; onMerged: () => void }) {
  const client = useQueryClient()
  const refresh = useRefreshServices()
  const all = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')) })
  const [open, setOpen] = useState(false)
  const [into, setInto] = useState('')
  const choices = (all.data ?? []).filter((x) => x.id !== s.id && x.active !== false)
  const target = choices.find((x) => String(x.id) === into)
  const merge = useMutation<Service, ApiError, number>({
    mutationFn: (intoId) => unwrap(api.POST('/api/service-types/{id}/merge/{intoId}', { params: { path: { id: s.id, intoId } } })),
    onSuccess: () => {
      refresh()
      // Приёмы, план лечения и отчёты показывают название услуги — теперь основной
      for (const key of ['appointments', 'plan', 'patient-card', 'service-popular', 'doctors-admin', 'report', 'revenue']) {
        void client.invalidateQueries({ queryKey: [key] })
      }
      onMerged()
    },
  })
  const confirm = () => {
    if (!target) return
    void ask(`Все приёмы и записи «${s.name}» перейдут на «${target.name}», «${s.name}» исчезнет из прайса. Отменить нельзя.`,
      { ok: 'Объединить', danger: true }).then((ok) => ok && merge.mutate(target.id))
  }
  if (!open) {
    return (
      <div className="merge-zone">
        <button type="button" className="btn" disabled={!choices.length} onClick={() => setOpen(true)}>Объединить с…</button>
        <p className="hint small">Дубль другой услуги? Его приёмы перейдут на основную, а он исчезнет из прайса.</p>
      </div>
    )
  }
  return (
    <div className="merge-zone" role="group" aria-label="Объединить с другой услугой">
      <div className="field"><span>{`Основная услуга — на неё перейдёт «${s.name}»`}</span>
        <Select aria-label="Основная услуга" value={into} onChange={(e) => { merge.reset(); setInto(e.target.value) }}>
          <option value="" disabled>Выберите услугу</option>
          {groupServices(choices).map(({ group: g, items }) => (
            <optgroup key={g} label={groupLabel(g)}>
              {items.map((x) => <option key={x.id} value={x.id}>{x.name}{priceText(x.priceSom) ? ` · ${priceText(x.priceSom)}` : ''}</option>)}
            </optgroup>
          ))}
        </Select>
      </div>
      <span className="actions">
        <button type="button" className="btn" disabled={!target || merge.isPending} onClick={confirm}>Объединить</button>
        <button type="button" className="btn ghost" onClick={() => { setOpen(false); setInto(''); merge.reset() }}>Отмена</button>
      </span>
      {merge.error && <p className="error" role="alert">{Object.values(merge.error.fieldErrors)[0] ?? merge.error.message}</p>}
    </div>
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
  const own = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')) })
  const enable = useEnableService()
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [done, setDone] = useState('')
  const add = useMutation<Schemas['ServiceTypeControllerAdded'], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/service-types/catalog', {
      body: { items: Object.entries(picked).map(([name, price]) => ({ name, priceSom: price === '' ? undefined : Number(price) })) },
    })),
    onSuccess: (r) => {
      setPicked({})
      setDone(`Добавлено услуг: ${r.added}`)
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
          <span className="hint">Отметьте, что делаете, и проверьте цену «от»: где знаем, подставили обычную по Бишкеку. Отмеченные сразу встанут в прайс.</span>
        </div>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={onClose}>✕</button>
      </header>
      {sections.isPending && <Loading />}
      {sections.error && <p className="error">{sections.error.message}</p>}
      {sections.data?.map((sec) => {
        const fresh = (sec.items ?? []).filter((i) => !i.added).length
        return (
          <details key={sec.category} className="catalog-section">
            <summary>{sec.category} <span className="hint">· {fresh ? `${fresh} новых` : 'всё есть'}</span></summary>
            {(sec.items ?? []).map((item) => {
              // Такая услуга у клиники есть, но не в прайсе — вернуть её, а не заводить вторую
              const off = item.hiddenId == null ? undefined : own.data?.find((x) => x.id === item.hiddenId)
              return off ? (
              <div key={item.name} className="catalog-row"><span>{item.name} <span className="hint">· не в прайсе</span></span>
                <button type="button" className="btn small" aria-label={`Включить: ${item.name}`} disabled={enable.isPending}
                  onClick={() => enable.mutate(off, { onSuccess: () => setDone(`«${off.name}» — снова в прайсе`) })}>Включить</button></div>
            ) : item.added ? (
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
            )
            })}
          </details>
        )
      })}
      {enable.error && <p className="error" role="alert">{enable.error.message}</p>}
      {add.error && <p className="error" role="alert">{Object.values(add.error.fieldErrors)[0] ?? add.error.message}</p>}
      {done && <p className="tone-ok" role="status">{done}</p>}
      <button type="button" className="btn primary" disabled={!count || add.isPending} onClick={() => add.mutate()}>
        {count ? `Добавить выбранные (${count})` : 'Добавить выбранные'}</button>
    </aside>
  )
}
