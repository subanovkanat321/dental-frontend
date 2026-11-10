import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { shortDate, somText, todayIn } from '../lib/time'
import { DateInput } from '../layout/DateInput'

type Finance = Schemas['PlatformFinanceFinance']
type Balance = Schemas['PlatformFinanceBalance']
type Topup = Schemas['PlatformTopupsTopup']

const SERVICES: [string, string][] = [['AI', 'ИИ'], ['SMS', 'SMS']]
const serviceName = (s?: string) => SERVICES.find(([k]) => k === s)?.[1] ?? s ?? ''

/** 87.5 → «87,5». */
const decimal = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n)
const signed = (som: number) => (som < 0 ? `−${somText(-som)}` : somText(som))

/**
 * «Балансы ИИ и SMS»: деньги, которые владелец заранее отправил провайдерам (Anthropic, SMS-провайдер), и
 * сколько из них уже ушло. Израсходовано — тот же авторасчёт, что в «Расходах» (токены, SMS × цена), с
 * дня первого пополнения; остаток ≈ пополнено − израсходовано. Остаток в минусе или меньше 10% последнего
 * пополнения — «пора пополнить». Сами пополнения в расход месяца не входят (иначе двойной счёт).
 */
export function TopupsBlock({ f, single }: { f: Finance; single: boolean }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const balances = f.balances ?? []
  const topups = f.topups ?? []
  const scope = single ? 'за месяц' : 'за период'
  return (
    <section className="card-block" aria-label="Балансы ИИ и SMS">
      <div className="block-head">
        <h2>Балансы ИИ и SMS</h2>
        {!adding && <button type="button" className="btn primary small" onClick={() => { setAdding(true); setEditing(null) }}>＋ Пополнение</button>}
      </div>
      <div className="fin-balances">
        {balances.map((b) => <BalanceCard key={b.service} b={b} scope={scope} />)}
      </div>
      {adding && <TopupForm rate={f.settings?.lastUsdRate} onDone={() => setAdding(false)} />}
      {topups.length > 0 && (
        <>
          <h3>Пополнения</h3>
          <ul className="fin-entries" aria-label="Пополнения">
            {topups.map((t) => (
              <li key={t.id}>
                {editing === t.id ? <TopupForm topup={t} rate={f.settings?.lastUsdRate} onDone={() => setEditing(null)} /> : (
                  <div className="fin-entry">
                    <div>
                      <b>{serviceName(t.service)}</b>{t.comment && <> — {t.comment}</>}
                      <div className="hint small">{shortDate(t.paidOn ?? '')}{t.amountUsd != null ? ` · $${decimal(t.amountUsd)} × ${decimal(t.usdRate ?? 0)}` : ''}</div>
                    </div>
                    <span className="num strong nowrap">{somText(t.amountSom ?? 0)}</span>
                    <button type="button" className="btn ghost small" aria-label={`Исправить пополнение: ${serviceName(t.service)}, ${shortDate(t.paidOn ?? '')}`}
                      onClick={() => { setEditing(t.id ?? null); setAdding(false) }}>Исправить</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function BalanceCard({ b, scope }: { b: Balance; scope: string }) {
  const name = serviceName(b.service)
  const balance = b.balanceSom ?? 0
  return (
    <div className={`fin-balance${b.low ? ' low' : ''}`} role="group" aria-label={`Баланс ${name}`}>
      <div className="fin-balance-head">
        <b>{name}</b>
        {b.low && <span className="chip small s-wait">пора пополнить</span>}
      </div>
      {b.since ? (
        <dl className="net-lines">
          <div><dt>Пополнено <span className="hint small">· {scope}: {somText(b.topupPeriodSom ?? 0)}</span></dt><dd className="num">{somText(b.topupTotalSom ?? 0)}</dd></div>
          <div><dt>Израсходовано <span className="hint small">· с {shortDate(b.since)} · {scope}: {somText(b.spentPeriodSom ?? 0)}</span></dt>
            <dd className="num">{somText(b.spentSinceSom ?? 0)}</dd></div>
          <div className="net-total"><dt>Остаток ≈</dt>
            <dd className={`num${balance < 0 ? ' tone-bad' : b.low ? ' tone-wait' : ''}`} aria-label={`Остаток ${name}`}>{signed(balance)}</dd></div>
        </dl>
      ) : (
        <p className="hint small">Пополнений ещё не было — остаток посчитаем с первого. Израсходовано {scope}: <span className="num nowrap">{somText(b.spentPeriodSom ?? 0)}</span></p>
      )}
      {b.needsPrice && <p className="hint small tone-wait">Цена SMS не указана — израсходованное считается как 0.</p>}
    </div>
  )
}

function TopupForm({ topup: t, rate, onDone }: { topup?: Topup; rate?: number; onDone: () => void }) {
  const client = useQueryClient()
  const today = todayIn()
  const [service, setService] = useState(t?.service ?? 'AI')
  const [usd, setUsd] = useState(t ? t.amountUsd != null : true)
  const [amount, setAmount] = useState(t ? String(t.amountUsd ?? t.amountSom ?? '') : '')
  const [usdRate, setUsdRate] = useState(String(t?.usdRate ?? rate ?? ''))
  const [paidOn, setPaidOn] = useState(t?.paidOn ?? today)
  const [comment, setComment] = useState(t?.comment ?? '')
  const done = () => {
    void client.invalidateQueries({ queryKey: ['platform-finance'] })
    onDone()
  }
  const body = (): Schemas['PlatformFinanceTopupForm'] => ({
    service,
    ...(usd ? { amountUsd: Number(amount), usdRate: Number(usdRate) } : { amountSom: Number(amount) }),
    paidOn,
    comment: comment.trim() || undefined,
  })
  const save = useMutation<Topup, ApiError>({
    mutationFn: () => (t
      ? unwrap(api.PUT('/api/platform/finance/topups/{id}', { params: { path: { id: t.id! } }, body: body() }))
      : unwrap(api.POST('/api/platform/finance/topups', { body: body() }))),
    onSuccess: done,
  })
  const remove = useMutation<unknown, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/platform/finance/topups/{id}', { params: { path: { id: t!.id! } } })),
    onSuccess: done,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const error = save.error ?? remove.error
  const err = (k: string) => save.error?.fieldErrors[k]
  const som = usd && Number(amount) > 0 && Number(usdRate) > 0 ? Math.round(Number(amount) * Number(usdRate)) : null
  const known = ['service', 'amountSom', 'amountUsd', 'usdRate', 'paidOn', 'comment']
  return (
    <form className="form sub-form fin-form" aria-label={t ? 'Исправить пополнение' : 'Новое пополнение'} onSubmit={submit}>
      <div className="segments" role="group" aria-label="Услуга">
        {SERVICES.map(([k, title]) => (
          <button key={k} type="button" aria-pressed={service === k} onClick={() => setService(k)}>{title}</button>
        ))}
      </div>
      {err('service') && <p className="error">{err('service')}</p>}
      <div className="segments" role="group" aria-label="Валюта пополнения">
        <button type="button" aria-pressed={!usd} onClick={() => setUsd(false)}>В сомах</button>
        <button type="button" aria-pressed={usd} onClick={() => setUsd(true)}>В долларах</button>
      </div>
      <div className="fin-row">
        <div className="field">
          <label className="field"><span>{usd ? 'Сумма, $' : 'Сумма, сом'}</span>
            <input type="number" min={usd ? 0.01 : 1} step={usd ? '0.01' : '1'} inputMode={usd ? 'decimal' : 'numeric'} required value={amount}
              onChange={(e) => { save.reset(); setAmount(e.target.value) }} /></label>
          {(err('amountSom') ?? err('amountUsd')) && <p className="error">{err('amountSom') ?? err('amountUsd')}</p>}
        </div>
        {usd && (
          <div className="field">
            <label className="field"><span>Курс: сомов за $1</span>
              <input type="number" min={0.01} step="0.01" inputMode="decimal" required value={usdRate}
                onChange={(e) => { save.reset(); setUsdRate(e.target.value) }} /></label>
            {err('usdRate') && <p className="error">{err('usdRate')}</p>}
          </div>
        )}
        <div className="field">
          <label className="field"><span>Дата оплаты</span>
            <DateInput value={paidOn} required max={today} onChange={(e) => { save.reset(); setPaidOn(e.target.value) }} /></label>
          {err('paidOn') && <p className="error">{err('paidOn')}</p>}
        </div>
      </div>
      {som != null && <p className="hint small" aria-live="polite">≈ {somText(som)} — точную сумму посчитает сервер</p>}
      <div className="field">
        <label className="field"><span>Комментарий (необязательно)</span>
          <input value={comment} maxLength={500} placeholder="Например: Anthropic $50" onChange={(e) => setComment(e.target.value)} /></label>
        {err('comment') && <p className="error">{err('comment')}</p>}
      </div>
      {error && !known.some((k) => save.error?.fieldErrors[k]) && <p className="error" role="alert">{error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={save.isPending}>{t ? 'Сохранить' : 'Добавить'}</button>
        <button type="button" className="btn ghost" onClick={onDone}>Отмена</button>
        {t && (
          <button type="button" className="btn danger" disabled={remove.isPending}
            onClick={() => void ask('Удалить пополнение? Остаток пересчитается.').then((ok) => ok && remove.mutate())}>Удалить</button>
        )}
      </div>
    </form>
  )
}
