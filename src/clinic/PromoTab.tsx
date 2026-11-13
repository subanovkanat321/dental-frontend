import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState, type FormEvent, type ReactNode } from 'react'

import { api, ApiError, botUsername, unwrap, WEB_CONFIG_KEY, webConfig, type Schemas } from '../api/client'
import { DateInput } from '../layout/DateInput'
import { SaveBar } from '../layout/SaveBar'
import { discountText, expired, linkable, usePromoCodes, type PromoCode } from '../lib/promo'
import { addDays, somText, todayIn } from '../lib/time'
import { useClose } from '../lib/useClose'
import { useDirty } from '../lib/unsaved'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'
import { HelpHint } from '../help/HelpHint'
import { rowOpen } from '../lib/rowClick'

type Me = Schemas['BookingViewsMe']
type Report = Schemas['PromoReportControllerPromoReport']

/** Период отчёта: дней назад от сегодня (включая сегодня). Год — 365 дней: сервер принимает до года. */
const PERIODS: [number, string][] = [[30, '30 дней'], [90, '90 дней'], [365, 'Год']]

/** Заводить и менять промокоды могут админ и врачи: рекламу делают они. */
function canManagePromo(me: Me): boolean {
  return Boolean(me.admin || me.doctorId != null)
}

/**
 * «Промокоды»: врач или админ заводит код для рекламы (Instagram, листовка), пациент вводит его при
 * записи в боте или называет по телефону — и здесь видно, работает ли реклама: сколько записей,
 * визитов, новых пациентов и оплат пришло по коду. Оплаты — тем, кто видит выручку (сервер решает).
 */
export function PromoTab({ me, header, onPanel }: { me: Me; header: ReactNode; onPanel: (open: boolean) => void }) {
  const list = usePromoCodes()
  const editable = canManagePromo(me)
  const [days, setDays] = useState(30)
  const to = todayIn()
  const from = addDays(to, -(days - 1))
  const report = useQuery({
    queryKey: ['promo-report', from, to],
    queryFn: () => unwrap(api.GET('/api/appointments/promo-codes', { params: { query: { from, to } } })),
  })
  const [opened, setOpenedState] = useState<Partial<PromoCode> | null>(null)
  const setOpened = useCallback((p: Partial<PromoCode> | null) => {
    setOpenedState(p)
    onPanel(p != null)
  }, [onPanel])
  const close = useCallback(() => setOpened(null), [setOpened])
  const codes = list.data ?? []

  return (
    <>
      <section className="schedule-main">
        {header}
        <section className="card-block">
          {/* Пояснение — одной строкой, подробности в «?»: абзац в 7 строк на телефоне выталкивал список за экран */}
          <p className="hint promo-lead">Код для рекламы: пациент вводит его при записи — видно, откуда пришёл.{' '}
            <HelpHint title="Промокоды">Опубликуйте код в Instagram, на листовке или у блогера. Пациент вводит его при записи в боте, а если
              назвал по телефону — поставьте код в записи. Скидка — подсказка пациенту: её применяет клиника на приёме, сумму записи
              промокод не меняет.</HelpHint>{!editable && <><br />Промокоды заводят врачи и руководитель.</>}</p>
          {list.error && <p className="error">{list.error.message}</p>}
          {/* Период и «+ Промокод» — одной строкой; не влезли — период на всю ширину, кнопка под ним тоже во всю (crm.css) */}
          <div className="promo-bar">
            <div className="segments" role="group" aria-label="Период отчёта">
              {PERIODS.map(([d, label]) => (
                <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{label}</button>
              ))}
            </div>
            {editable && <button type="button" className="btn primary" onClick={() => setOpened({ code: '', active: true })}>+ Промокод</button>}
          </div>
          {list.isPending ? <Loading /> : codes.length === 0 ? (
            <EmptyState title="Промокодов пока нет">{editable && 'Нажмите «+ Промокод» — например, ZUBY10 для рекламы в Instagram.'}</EmptyState>
          ) : (
            <PromoTable codes={codes} report={report.data} error={report.error?.message} today={to} opened={opened?.id}
              onOpen={editable ? setOpened : undefined} />
          )}
        </section>
      </section>
      {opened && <PromoPanel key={opened.id ?? 'new'} promo={opened} me={me} onClose={close} />}
    </>
  )
}

/** Код, статус и отчёт за период по каждому коду. Подписи для телефона — в data-label (таблица карточками). */
function PromoTable({ codes, report, error, today, opened, onOpen }: {
  codes: PromoCode[]; report?: Report; error?: string; today: string; opened?: number; onOpen?: (p: PromoCode) => void
}) {
  const rows = new Map((report?.rows ?? []).map((r) => [r.promoCodeId, r]))
  const money = Boolean(report?.money)
  const dash = report ? 0 : '…'
  return (
    <>
      {error && <p className="error">{error}</p>}
      <table className="table promo-table" aria-label="Промокоды">
        <thead><tr><th>Промокод</th><th className="num">Записей</th><th className="num">Пришли</th><th className="num">Новых</th>
          {money && <th className="num">Оплачено</th>}</tr></thead>
        <tbody>
          {codes.map((p) => {
            const r = rows.get(p.id)
            const off = p.active === false ? 'выключен' : expired(p, today) ? 'срок вышел' : null
            const discount = discountText(p)
            return (
              <tr key={p.id} {...rowOpen(onOpen && (() => onOpen(p)), p.id === opened && 'active', off && 'inactive')}>
                <td>
                  {onOpen ? <button type="button" className="row-link" onClick={() => onOpen(p)}>🎟 {p.code}</button> : <span>🎟 {p.code}</span>}
                  {off && <span className="hint"> · {off}</span>}
                  {(p.description || discount) && <div className="hint small">{[p.description, discount].filter(Boolean).join(' · ')}</div>}
                </td>
                <td className="num" data-label="Записей">{r?.bookings ?? dash}</td>
                <td className="num" data-label="Пришли">{r?.visits ?? dash}</td>
                <td className="num" data-label="Новых">{r?.newPatients ?? dash}</td>
                {money && <td className="num" data-label="Оплачено">{somText(r?.revenueSom ?? 0)}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="hint small">«Записей» — с этим кодом, кроме отменённых; «Пришли» — из них состоялись; «Новых» — первый приём в клинике
        был с этим кодом.{money && ' «Оплачено» — оплаты пациентов, пришедших по коду: за приём с кодом и всё лечение после него.'}</p>
    </>
  )
}

/** Промокод: новый (без id) или существующий. Удалить можно только неиспользованный — иначе выключают. */
function PromoPanel({ promo: p, me, onClose }: { promo: Partial<PromoCode>; me: Me; onClose: () => void }) {
  const close = useClose(onClose)
  const client = useQueryClient()
  const [f, setF] = useState({
    code: p.code ?? '', description: p.description ?? '', discountPercent: p.discountPercent != null ? String(p.discountPercent) : '',
    discountText: p.discountText ?? '', validUntil: p.validUntil ?? '', active: p.active !== false,
  })
  const { dirty, commit } = useDirty(f)
  const body = () => ({
    code: f.code, description: f.description, discountText: f.discountText, active: f.active,
    discountPercent: f.discountPercent === '' ? undefined : Number(f.discountPercent),
    validUntil: f.validUntil === '' ? undefined : f.validUntil,
  })
  const done = (all: PromoCode[]) => {
    client.setQueryData(['promo-codes'], all)
    void client.invalidateQueries({ queryKey: ['promo-report'] })
  }
  const save = useMutation<PromoCode[], ApiError>({
    mutationFn: () => unwrap(p.id
      ? api.PUT('/api/promo-codes/{id}', { params: { path: { id: p.id } }, body: body() })
      : api.POST('/api/promo-codes', { body: body() })),
    onSuccess: (all) => {
      commit()
      done(all)
      if (!p.id) onClose()
    },
  })
  const remove = useMutation<PromoCode[], ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/promo-codes/{id}', { params: { path: { id: p.id! } } })),
    onSuccess: (all) => {
      done(all)
      onClose()
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
  const title = p.id ? `Промокод ${p.code}` : 'Новый промокод'

  return (
    <aside className="panel" aria-label={p.id ? 'Промокод' : 'Новый промокод'}>
      <header className="panel-head">
        <h2>{title}</h2>
        <button type="button" className="btn ghost" aria-label="Закрыть" onClick={close}>✕</button>
      </header>
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Промокод</span>
          <input value={f.code} required maxLength={20} autoFocus={!p.id} autoComplete="off" autoCapitalize="characters" placeholder="Например: ZUBY10"
            onChange={(e) => change({ code: e.target.value.toUpperCase() })} /></label>
        <p className="hint small">Буквы и цифры, 3–20 знаков, без пробелов. Большие и маленькие буквы не различаются.</p>
        {err('code') && <p className="error">{err('code')}</p>}
        <label className="field"><span>Где опубликован (видят только сотрудники)</span>
          <input value={f.description} maxLength={200} autoComplete="off" placeholder="Instagram, ноябрь" onChange={(e) => change({ description: e.target.value })} /></label>
        {err('description') && <p className="error">{err('description')}</p>}
        <div className="row">
          <label className="field"><span>Скидка, %</span>
            <input type="number" inputMode="numeric" min={1} max={100} value={f.discountPercent} placeholder="—"
              onChange={(e) => change({ discountPercent: e.target.value })} /></label>
          <label className="field"><span>Действует до</span>
            <DateInput value={f.validUntil} placeholder="Без срока" onChange={(e) => change({ validUntil: e.target.value })} /></label>
        </div>
        {err('discountPercent') && <p className="error">{err('discountPercent')}</p>}
        <label className="field"><span>Скидка словами (необязательно)</span>
          <input value={f.discountText} maxLength={100} autoComplete="off" placeholder="Консультация бесплатно" onChange={(e) => change({ discountText: e.target.value })} /></label>
        {err('discountText') && <p className="error">{err('discountText')}</p>}
        <p className="hint small">Пациент увидит скидку подсказкой: «скидку применяет клиника на приёме». Сумму приёма вы ставите сами.</p>
        {p.id != null && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => change({ active: e.target.checked })} /> Принимать от пациентов</label>}
        <SaveBar dirty={dirty} saving={save.isPending} saved={save.isSuccess} label={p.id ? 'Сохранить' : 'Добавить'} savedText="Промокод сохранён"
          error={save.error && (['code', 'description', 'discountPercent', 'discountText'].map((k) => err(k)).find(Boolean) ?? save.error.message)} />
      </form>
      {p.id != null && <ShareLinks code={p.code ?? ''} clinicCode={me.clinic?.code} />}
      {p.id != null && (p.appointments ?? 0) === 0 && (
        <div className="actions">
          <button type="button" className="btn danger small" disabled={remove.isPending} onClick={() => remove.mutate()}>Удалить промокод</button>
        </div>
      )}
      {p.id != null && (p.appointments ?? 0) > 0 && <p className="hint">С кодом записывались ({p.appointments}) — удалить нельзя, ненужный выключите.</p>}
      {remove.error && <p className="error" role="alert">{remove.error.message}</p>}
    </aside>
  )
}

/**
 * Ссылки с промокодом для рекламы: бот и страница клиники подставят код в форму записи. Только для
 * кодов латиницей: ссылка Telegram не пропускает кириллицу.
 */
function ShareLinks({ code, clinicCode }: { code: string; clinicCode?: string }) {
  const bot = useQuery({ queryKey: WEB_CONFIG_KEY, queryFn: webConfig, staleTime: Infinity, select: botUsername })
  const [copied, setCopied] = useState('')
  if (!clinicCode) return null
  if (!linkable(code)) return <p className="hint">Ссылку с кодом можно сделать для промокода латиницей и цифрами — кириллицу Telegram в ссылке не пропускает.</p>
  const page = `${window.location.origin}/c/${clinicCode}?promo=${code}`
  const links = [
    ...(bot.data ? [['Бот Telegram', `https://t.me/${bot.data}?start=c_${clinicCode}-${code}`]] : []),
    ['Страница клиники', page],
  ]
  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied('Скопировано')
    } catch {
      setCopied('Не получилось скопировать — выделите ссылку')
    }
  }
  return (
    <section className="promo-links" aria-label="Ссылки с промокодом">
      <h3>Ссылки с промокодом</h3>
      <p className="hint small">Пациент откроет — код уже будет в форме записи.</p>
      {links.map(([label, link]) => (
        <div key={label} className="promo-link">
          <span className="hint small">{label}</span>
          <a href={link} target="_blank" rel="noopener noreferrer">{link}</a>
          <button type="button" className="btn small ghost" onClick={() => void copy(link!)}>Скопировать</button>
        </div>
      ))}
      {copied && <p className="hint small" role="status">{copied}</p>}
    </section>
  )
}
