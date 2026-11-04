import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { HBars } from '../cash/HBars'
import { MonthPicker } from '../layout/MonthPicker'
import { somText, todayIn } from '../lib/time'

type Report = Schemas['AiUsageStoreReport']
type ClinicRow = Schemas['AiUsageStoreClinicRow']
type Settings = Schemas['AiUsageStoreSettings']

/** Доллары: копейки расхода видны — $0.0123, крупное — $12.40. */
function usdText(usd: number): string {
  return usd > 0 && usd < 1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

/** 1234567 → «1,2 млн», 12345 → «12,3 тыс.» — токены крупно, без лишних цифр. */
function tokensText(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} млн`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')} тыс.`
  return String(n)
}

/**
 * «Расход ИИ» — только владелец платформы (сервер отвечает 403 остальным, менеджерам тоже): сколько
 * стоил ИИ за месяц в долларах и сомах (курс и НДС — настройки ниже), по клиникам рядом с их тарифом —
 * видно маржу; по видам действий и по дням. Лимит действий клиники меняется здесь же.
 */
export function AiUsageTab() {
  const [month, setMonth] = useState(() => todayIn().slice(0, 7))
  const report = useQuery<Report, ApiError>({
    queryKey: ['platform-ai-usage', month],
    queryFn: () => unwrap(api.GET('/api/platform/ai-usage', { params: { query: { month } } })),
  })
  const r = report.data
  return (
    <>
      <section className="card-block">
        <div className="toolbar">
          <h2>Расход ИИ</h2>
          <MonthPicker label="Месяц расхода ИИ" value={month} max={todayIn().slice(0, 7)} onChange={setMonth} />
        </div>
        {report.error && <p className="error" role="alert">{report.error.message}</p>}
        {report.isPending ? <p className="hint">Загрузка…</p> : r && (
          <>
            <p className="strong">Всего: <span className="num">{usdText(r.usd ?? 0)}</span> · <span className="num">{somText(r.som ?? 0)}</span>
              <span className="hint"> · {r.actions ?? 0} запросов к ИИ</span></p>
            <p className="hint small">В сомах — по курсу {r.settings?.somPerUsd} сом за $1 и с НДС {r.settings?.vatPercent}%.
              {(r.platformUsd ?? 0) > 0 && ` Помощник техподдержки платформы: ${usdText(r.platformUsd ?? 0)}.`}</p>
          </>
        )}
      </section>
      {r && <ClinicsTable rows={r.clinics ?? []} />}
      {r && (r.kinds?.length ?? 0) > 0 && (
        <section className="card-block">
          <h2>По видам действий</h2>
          <HBars label="Расход ИИ по видам действий" format={usdText}
            rows={(r.kinds ?? []).map((k) => ({ name: k.label ?? '', value: k.usd ?? 0, note: `${k.actions ?? 0} запросов` }))} />
        </section>
      )}
      {r && (r.days?.length ?? 0) > 0 && (
        <section className="card-block">
          <h2>По дням</h2>
          <HBars label="Расход ИИ по дням" format={usdText}
            rows={(r.days ?? []).map((d) => ({ name: (d.date ?? '').slice(8, 10) + '.' + (d.date ?? '').slice(5, 7), value: d.usd ?? 0, note: `${d.actions ?? 0} запросов` }))} />
        </section>
      )}
      {r?.settings && <SettingsForm key={JSON.stringify(r.settings)} settings={r.settings} />}
    </>
  )
}

function ClinicsTable({ rows }: { rows: ClinicRow[] }) {
  const [editing, setEditing] = useState<number | null>(null)
  return (
    <section className="card-block">
      <h2>По клиникам</h2>
      <p className="hint small">Действия — удачные запросы к ИИ клиники (без помощника техподдержки); они идут в месячный лимит.
        Тариф — сколько клиника платит в месяц, чтобы видеть маржу.</p>
      <div className="table-scroll">
        <table className="table" aria-label="Расход ИИ по клиникам">
          <thead><tr><th>Клиника</th><th className="r">Действий / лимит</th><th className="r">Токены (вход / выход)</th>
            <th className="r">$</th><th className="r">Сом</th><th className="r">Тариф в месяц</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.clinicId}>
                <td>{c.name}{(c.errors ?? 0) > 0 && <span className="hint small"> · ошибок {c.errors}</span>}</td>
                <td className="r num">{c.used ?? 0} / {c.limit ?? 0}{c.customLimit != null && <span className="hint"> (свой)</span>}</td>
                <td className="r num">{tokensText(c.inputTokens ?? 0)} / {tokensText(c.outputTokens ?? 0)}</td>
                <td className="r num">{usdText(c.usd ?? 0)}</td>
                <td className="r num">{somText(c.som ?? 0)}</td>
                <td className="r num">{c.free ? <span className="hint">пилот, 0 сом</span> : somText(c.tariffSom ?? 0)}</td>
                <td>{editing === c.clinicId
                  ? <LimitForm clinic={c} onDone={() => setEditing(null)} />
                  : <button type="button" className="btn ghost small" onClick={() => setEditing(c.clinicId ?? null)}>Изменить лимит</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Свой лимит клинике; «По умолчанию» — снова «на врача × врачи». */
function LimitForm({ clinic, onDone }: { clinic: ClinicRow; onDone: () => void }) {
  const client = useQueryClient()
  const [value, setValue] = useState(String(clinic.customLimit ?? clinic.limit ?? ''))
  const save = useMutation<unknown, ApiError, number | null>({
    mutationFn: (monthly) => unwrap(api.PUT('/api/platform/ai-usage/clinics/{id}/limit', {
      params: { path: { id: clinic.clinicId! } }, body: { monthly: monthly ?? undefined },
    })),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['platform-ai-usage'] })
      onDone()
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(Number(value))
  }
  return (
    <form className="actions" aria-label={`Лимит ИИ: ${clinic.name}`} onSubmit={submit}>
      <input type="number" min={0} inputMode="numeric" aria-label="Действий в месяц" value={value}
        onChange={(e) => setValue(e.target.value)} style={{ width: '6em' }} />
      <button type="submit" className="btn small" disabled={save.isPending || value === ''}>Сохранить</button>
      {clinic.customLimit != null && (
        <button type="button" className="btn ghost small" disabled={save.isPending} onClick={() => save.mutate(null)}>По умолчанию</button>
      )}
      <button type="button" className="btn ghost small" onClick={onDone}>Отмена</button>
      {save.error && <p className="error small" role="alert">{save.error.fieldErrors.monthly ?? save.error.message}</p>}
    </form>
  )
}

/** Лимит по умолчанию на врача, курс доллара и НДС — для всех клиник. */
function SettingsForm({ settings }: { settings: Settings }) {
  const client = useQueryClient()
  const [f, setF] = useState({
    perDoctor: String(settings.perDoctor ?? 300), somPerUsd: String(settings.somPerUsd ?? 87), vatPercent: String(settings.vatPercent ?? 12),
  })
  const save = useMutation<Settings, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/platform/ai-usage/settings', {
      body: { perDoctor: Number(f.perDoctor), somPerUsd: Number(f.somPerUsd), vatPercent: Number(f.vatPercent) },
    })),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['platform-ai-usage'] }),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const err = (k: string) => save.error?.fieldErrors[k]
  const field = (key: keyof typeof f, label: string) => (
    <div className="field">
      <label className="field"><span>{label}</span>
        <input type="number" min={0} step="any" inputMode="decimal" value={f[key]}
          onChange={(e) => { save.reset(); setF({ ...f, [key]: e.target.value }) }} /></label>
      {err(key) && <p className="error">{err(key)}</p>}
    </div>
  )
  return (
    <section className="card-block">
      <h2>Настройки расчёта</h2>
      <form className="form narrow" aria-label="Настройки расхода ИИ" onSubmit={submit}>
        {field('perDoctor', 'Лимит по умолчанию: действий ИИ в месяц на врача')}
        {field('somPerUsd', 'Курс: сомов за $1')}
        {field('vatPercent', 'НДС, %')}
        <button type="submit" className="btn" disabled={save.isPending}>Сохранить</button>
        {save.isSuccess && <p className="hint">Сохранено.</p>}
        {save.error && !save.error.fieldErrors.perDoctor && !save.error.fieldErrors.somPerUsd && !save.error.fieldErrors.vatPercent
          && <p className="error" role="alert">{save.error.message}</p>}
      </form>
    </section>
  )
}
