import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { SaveBar } from '../layout/SaveBar'
import { somText, todayIn } from '../lib/time'
import { useDirty } from '../lib/unsaved'
import { MonthPicker } from '../layout/MonthPicker'
import { Select } from '../layout/Select'
import { Loading } from '../layout/Loading'
import { EmptyState } from '../layout/EmptyState'
import { Timesheet } from './Timesheet'
import { daysText } from './daysText'

type Row = Schemas['SalaryControllerSalaryRow']
type RentKind = 'none' | 'fixed' | 'percent'

const MONTH = new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const monthTitle = (m: string) => MONTH.format(new Date(`${m}-01T00:00:00Z`)).replace(' г.', '')

/** 'YYYY-MM' прошлого месяца: зарплату обычно считают в начале следующего. */
function previousMonth(today = todayIn()): string {
  const [y, m] = today.slice(0, 7).split('-').map(Number) as [number, number]
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** Сотрудник, а не врач: ассистент, регистратура или админ без своего кресла. */
const isEmployee = (r: Row) => r.assistantId != null
const isAssistantRow = (r: Row) => r.position === 'ассистент'

/** От чьей выручки процент: врач — своей, ассистент — его врачей, регистратура и админ — всей клиники. */
function revenueOf(r: Row): string {
  return !isEmployee(r) ? 'выручки' : isAssistantRow(r) ? 'выручки его врачей' : 'выручки клиники'
}

/** Аренда кресла из условий: «30 000 сом в месяц» / «10% от выручки»; нет — ''. */
function rentText(r: Row): string {
  if (r.rentFixedSom) return `${somText(r.rentFixedSom)} в месяц`
  const p = Number(r.rentPercent ?? 0)
  return p ? `${String(p).replace('.', ',')}% от выручки` : ''
}

const hasRent = (r: Row) => !!r.rentFixedSom || Number(r.rentPercent ?? 0) > 0

function termsText(r: Row): string {
  const percent = Number(r.percent ?? 0)
  const of = `от ${revenueOf(r)}`
  const rent = rentText(r)
  const minusRent = rent ? `, минус аренда кресла ${rent}` : ''
  if (!isEmployee(r) && percent === 100 && !r.baseSom) return `вся выручка — врачу (100%)${minusRent}`
  const parts = [percent ? `${String(percent).replace('.', ',')}% ${of}` : '', r.baseSom ? `оклад ${somText(r.baseSom)}${r.byTimesheet ? ' по табелю' : ''}` : '']
  return (parts.filter(Boolean).join(' + ') || 'Условия не заданы') + minusRent
}

function errorText(e: ApiError | null): string | null {
  return e ? Object.values(e.fieldErrors)[0] ?? e.message : null
}

/**
 * «Касса → Зарплата»: к выплате врачу за месяц = оклад + процент от его выручки − аренда кресла (у
 * частного врача; больше заработка — «врач должен клинике», без отрицательной выплаты); регистратуре и админу
 * без кресла — от выручки клиники; ассистенту — от выручки его врачей. Админ задаёт
 * условия и отмечает выплату (она же расход «Зарплата» — прибыль её учтёт); врач видит свою строку.
 * Считает сервер — здесь только показываем и отправляем.
 */
export function SalaryTab({ seesAll }: { seesAll: boolean }) {
  const [month, setMonth] = useState(previousMonth)
  const list = useQuery({
    queryKey: ['salaries', month],
    queryFn: () => unwrap(api.GET('/api/salaries', { params: { query: { month } } })),
  })
  const rows = list.data ?? []
  const due = rows.reduce((s, r) => s + Math.max(0, (r.dueSom ?? 0) - (r.paidSom ?? 0)), 0)
  return (
    <>
      {/* Месяц — «‹ Октябрь 2026 ›»; по умолчанию прошлый (его зарплату выплачивают), «Этот месяц» — одним нажатием */}
      <div className="analytics-filter">
        <MonthPicker label="Месяц зарплаты" value={month} max={todayIn().slice(0, 7)} onChange={setMonth} />
        <div className="day-quick" role="group" aria-label="Быстро">
          <button type="button" className="chip" aria-pressed={month === previousMonth()} onClick={() => setMonth(previousMonth())}>Прошлый месяц</button>
          <button type="button" className="chip" aria-pressed={month === todayIn().slice(0, 7)} onClick={() => setMonth(todayIn().slice(0, 7))}>Этот месяц</button>
        </div>
      </div>
      <SalaryHowTo seesAll={seesAll} noTerms={rows.some((r) => !r.former && !Number(r.percent ?? 0) && !r.baseSom)} />
      <SalaryCalc rows={rows.filter((r) => !r.former)} />
      {list.isPending ? <Loading />
        : list.error ? <p className="error">{list.error.message}</p>
          : rows.length === 0 ? <EmptyState title="Врачей пока нет">Добавьте врачей в «Настройки → Персонал» — здесь появится их зарплата.</EmptyState> : (
            <>
              {seesAll && rows.length > 1 && <p className="total-line" aria-label="Осталось выплатить">Осталось выплатить: <b className="num">{somText(due)}</b></p>}
              {/* Ключ с месяцем: сменили месяц — открытая форма выплаты не переносит сумму прошлого */}
              {rows.map((r) => <SalaryCard key={`${month}-${r.doctorId != null ? `d${r.doctorId}` : `a${r.assistantId}`}`} row={r} month={month} seesAll={seesAll} />)}
            </>
          )}
    </>
  )
}

function SalaryCard({ row: r, month, seesAll }: { row: Row; month: string; seesAll: boolean }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState(false)
  const [receiving, setReceiving] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  // Форма условий после «Сохранить» закрывается — подтверждение показывает карточка
  const [termsSaved, setTermsSaved] = useState(false)
  const left = Math.max(0, (r.dueSom ?? 0) - (r.paidSom ?? 0))
  const noTerms = !Number(r.percent ?? 0) && !r.baseSom && !hasRent(r)
  // Аренда больше заработка: врач должен клинике; сколько ещё не принёс
  const owes = r.owesSom ?? 0
  const owesLeft = Math.max(0, owes - (r.rentReceivedSom ?? 0))
  const cancelRent = useMutation<Row, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/salaries/{doctorId}/rent', { params: { path: { doctorId: r.doctorId! }, query: { month } } })),
    onSuccess: () => refresh(),
  })
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['salaries'] })
    void client.invalidateQueries({ queryKey: ['expenses'] })
    // Выплата — расход: прибыль в «Расходах» пересчитывается
    void client.invalidateQueries({ queryKey: ['spending'] })
  }
  return (
    <section className="card-block salary" aria-label={`Зарплата: ${r.doctor}`}>
      <div className="salary-head">
        <h2>{r.doctor}{isEmployee(r) && !r.former && r.position && <span className="hint"> · {r.position}</span>}</h2>
        {left === 0 && (r.dueSom ?? 0) > 0 && <span className="badge-ok">✅ Выплачено</span>}
        {owes > 0 && owesLeft === 0 && <span className="badge-ok">✅ Аренда получена</span>}
      </div>
      <dl className="salary-sums">
        <div><dt>{!isEmployee(r) ? 'Выручка' : isAssistantRow(r) ? 'Выручка врачей' : 'Выручка клиники'}</dt><dd className="num">{somText(r.revenueSom ?? 0)}</dd></div>
        {(r.rentSom ?? 0) > 0 && <div><dt>Аренда кресла</dt><dd className="num">−{somText(r.rentSom ?? 0)}</dd></div>}
        {owes > 0
          ? <div><dt>Врач должен клинике</dt><dd className="num strong tone-bad" aria-label="Врач должен клинике">{somText(owes)}</dd></div>
          : <div><dt>К выплате</dt><dd className="num strong">{somText(r.dueSom ?? 0)}</dd></div>}
        {owes > 0
          ? <div><dt>Получено от врача</dt><dd className="num">{somText(r.rentReceivedSom ?? 0)}</dd></div>
          : <div><dt>Выплачено</dt><dd className="num">{somText(r.paidSom ?? 0)}</dd></div>}
      </dl>
      {owes > 0 && (
        <p className="tone-wait" role="note">
          Аренда кресла ({somText(r.rentSom ?? 0)}) больше заработка врача за месяц ({somText(r.earnedSom ?? 0)}) — выплаты нет,
          врач должен клинике {somText(owes)}.{(r.rentReceivedSom ?? 0) > 0 && owesLeft > 0 && ` Осталось получить ${somText(owesLeft)}.`}
        </p>
      )}
      {r.former
        ? <p className="hint">Убран из «Персонала» — выплата за этот месяц сохранена в истории. Вернёте в клинику — она снова будет в его строке.</p>
        : noTerms && !editing
          ? <p className="tone-wait">Условия не заданы — «К выплате» считается как 0. Нажмите «Задать процент и оклад».</p>
          : !noTerms && <p className="hint">Условия: {termsText(r)}</p>}
      {/* Оклад по табелю: расшифровка «отработано 20 из 22 дней → 27 273 сом» */}
      {r.byTimesheet && !r.former && (
        <p className="salary-timesheet" aria-label="Оклад по табелю">
          📅 Отработано <b className="num">{r.workedDays}</b> из <b className="num">{r.normDays}</b> {daysText(r.normDays ?? 0)} →{' '}
          <b className="num">{somText(r.baseAccruedSom ?? 0)}</b> из оклада {somText(r.baseSom ?? 0)}
          {' '}<button type="button" className="link" aria-expanded={sheetOpen} onClick={() => setSheetOpen(!sheetOpen)}>
            {sheetOpen ? 'Скрыть табель' : seesAll ? 'Табель — отметить дни' : 'Табель'}</button>
        </p>
      )}
      {sheetOpen && r.byTimesheet && (
        <Timesheet whose={r.doctorId != null ? { doctorId: r.doctorId } : { telegramId: r.assistantId! }} month={month} name={r.doctor ?? ''}
          canEdit={seesAll} onChanged={refresh} showSum={false} />
      )}
      {seesAll && !r.former && !editing && !paying && !receiving && (
        <div className="actions">
          {left > 0 && <button type="button" className="btn primary" onClick={() => setPaying(true)}>Выплатить {somText(left)}</button>}
          {owesLeft > 0 && <button type="button" className="btn primary" onClick={() => setReceiving(true)}>Получено от врача…</button>}
          {(r.rentReceivedSom ?? 0) > 0 && (
            <button type="button" className="btn quiet" disabled={cancelRent.isPending} onClick={() => cancelRent.mutate()}>Отменить «получено»</button>
          )}
          <button type="button" className={noTerms ? 'btn primary' : 'btn'} onClick={() => { setTermsSaved(false); setEditing(true) }}>
            {noTerms ? '⚙️ Задать процент и оклад' : '⚙️ Изменить условия'}</button>
        </div>
      )}
      {editing && <TermsForm row={r} month={month} onDone={() => { setEditing(false); setTermsSaved(true); refresh() }} onCancel={() => setEditing(false)} />}
      <SaveBar dirty={false} saving={false} saved={termsSaved} savedText="Условия сохранены — «К выплате» пересчитано" />
      {paying && <PayForm row={r} month={month} left={left} onDone={() => { setPaying(false); refresh() }} onCancel={() => setPaying(false)} />}
      {receiving && <RentForm row={r} month={month} left={owesLeft} onDone={() => { setReceiving(false); refresh() }} onCancel={() => setReceiving(false)} />}
      {cancelRent.error && <p className="error" role="alert">{errorText(cancelRent.error)}</p>}
    </section>
  )
}

function TermsForm({ row: r, month, onDone, onCancel }: { row: Row; month: string; onDone: () => void; onCancel: () => void }) {
  const [percent, setPercent] = useState(String(Number(r.percent ?? 0) || ''))
  const [base, setBase] = useState(r.baseSom ? String(r.baseSom) : '')
  // Оклад по табелю: за отработанные дни (оклад × отработано / норма), а не весь
  const [byTimesheet, setByTimesheet] = useState(Boolean(r.byTimesheet))
  // Аренда кресла — только у врача: нет, сумма в месяц или процент от его выручки
  const [rentKind, setRentKind] = useState<RentKind>(r.rentFixedSom ? 'fixed' : Number(r.rentPercent ?? 0) ? 'percent' : 'none')
  const [rent, setRent] = useState(r.rentFixedSom ? String(r.rentFixedSom) : Number(r.rentPercent ?? 0) ? String(Number(r.rentPercent)) : '')
  const { dirty } = useDirty({ percent, base, rentKind, rent, byTimesheet })
  // Пример на выручке этого месяца — подсказка; настоящую сумму считает сервер после «Сохранить»
  const p = Number(percent.replace(',', '.') || 0)
  const revenue = r.revenueSom ?? 0
  const earned = Number(base || 0) + Math.round(revenue * p / 100)
  const rentValue = Number(rent.replace(',', '.') || 0)
  const rentSom = rentKind === 'fixed' ? rentValue : rentKind === 'percent' ? Math.round(revenue * rentValue / 100) : 0
  const preview = earned - rentSom
  const of = revenueOf(r)
  const privatePreset = p === 100 && !Number(base || 0) && rentKind !== 'none'
  const save = useMutation<Row, ApiError>({
    mutationFn: () => {
      const body = {
        percent: Number(percent.replace(',', '.') || 0), baseSom: Number(base || 0), byTimesheet: byTimesheet && Number(base || 0) > 0,
        ...(isEmployee(r) ? {} : { rentSom: rentKind === 'fixed' ? rentValue : 0, rentPercent: rentKind === 'percent' ? rentValue : 0 }),
      }
      return unwrap(r.assistantId != null
        ? api.PUT('/api/salaries/assistants/{telegramId}', { params: { path: { telegramId: r.assistantId }, query: { month } }, body })
        : api.PUT('/api/salaries/{doctorId}', { params: { path: { doctorId: r.doctorId! }, query: { month } }, body }))
    },
    onSuccess: onDone,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  return (
    <form className="form" aria-label={`Условия: ${r.doctor}`} onSubmit={submit}>
      <p className="hint">Условия у каждого свои: только процент, только оклад или оба. Пусто — значит 0.</p>
      {/* Частые схемы одной кнопкой: частный врач (в том числе в клинике с другими врачами) забирает всё */}
      {!isEmployee(r) && (
        <div className="day-quick wrap" role="group" aria-label="Как платить">
          <button type="button" className="chip" aria-pressed={p === 100 && !Number(base || 0) && rentKind === 'none'}
            onClick={() => { setPercent('100'); setBase(''); setRentKind('none'); setRent('') }}>Вся выручка — врачу (100%)</button>
          <button type="button" className="chip" aria-pressed={privatePreset}
            onClick={() => { setPercent('100'); setBase(''); if (rentKind === 'none') setRentKind('fixed') }}>Частный врач: вся выручка — врачу, минус аренда</button>
          <button type="button" className="chip" aria-pressed={p === 0 && Number(base || 0) > 0}
            onClick={() => setPercent('')}>Только оклад</button>
          <button type="button" className="chip" aria-pressed={p > 0 && p < 100 && Number(base || 0) > 0}
            onClick={() => { if (!p || p === 100) setPercent('30') }}>Оклад + процент</button>
        </div>
      )}
      <div className="row">
        <label className="field"><span>Процент от {of}, %</span>
          <input inputMode="decimal" value={percent} placeholder="например, 30" onChange={(e) => setPercent(e.target.value.replace(/[^\d.,]/g, ''))} /></label>
        <label className="field"><span>Оклад в месяц, сом</span>
          <input inputMode="numeric" value={base} placeholder="0 — без оклада" onChange={(e) => setBase(e.target.value.replace(/\D/g, ''))} /></label>
      </div>
      {Number(base || 0) > 0 && (
        <label className="check">
          <input type="checkbox" checked={byTimesheet} onChange={(e) => setByTimesheet(e.target.checked)} />
          <span>Оклад по табелю — за отработанные дни: оклад × отработано / норма (рабочие дни месяца по графику)</span>
        </label>
      )}
      {!isEmployee(r) && (
        <div className="row">
          <label className="field"><span>Аренда кресла</span>
            <Select aria-label="Аренда кресла" value={rentKind} onChange={(e) => { setRentKind(e.target.value as RentKind); setRent('') }}>
              <option value="none">Нет</option>
              <option value="fixed">Сумма в месяц</option>
              <option value="percent">Процент от выручки врача</option>
            </Select>
          </label>
          {rentKind !== 'none' && (
            <label className="field"><span>{rentKind === 'fixed' ? 'Аренда в месяц, сом' : 'Аренда, % от выручки'}</span>
              <input inputMode={rentKind === 'fixed' ? 'numeric' : 'decimal'} value={rent} placeholder={rentKind === 'fixed' ? 'например, 30000' : 'например, 20'}
                onChange={(e) => setRent(rentKind === 'fixed' ? e.target.value.replace(/\D/g, '') : e.target.value.replace(/[^\d.,]/g, ''))} /></label>
          )}
        </div>
      )}
      {rentKind !== 'none' && <p className="hint small">Аренду врач платит клинике: она вычитается из «К выплате». Сумма — за весь месяц, по дням не делится; процент — от той же выручки врача.</p>}
      <div className="day-quick wrap" role="group" aria-label="Быстро: процент">
        {(!isEmployee(r) ? [20, 25, 30, 35, 40, 50] : isAssistantRow(r) ? [5, 10, 15] : [1, 2, 3]).map((x) => (
          <button key={x} type="button" className="chip" aria-pressed={p === x} onClick={() => setPercent(String(x))}>{x}%</button>
        ))}
      </div>
      <p className="salary-preview" aria-label="Пример расчёта">
        За {monthTitle(month)}: {Number(base || 0) ? `${somText(Number(base))}${byTimesheet ? ' (по табелю — за отработанные дни)' : ''} + ` : ''}{String(p).replace('.', ',')}% от {somText(revenue)}
        {rentSom > 0 && ` − аренда ${somText(rentSom)}`} = <b className="num">{preview < 0 ? `врач должен клинике ${somText(-preview)}` : somText(preview)}</b>
      </p>
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
      </div>
      <SaveBar dirty={dirty} saving={save.isPending} saved={false} error={errorText(save.error)} />
    </form>
  )
}

function PayForm({ row: r, month, left, onDone, onCancel }: { row: Row; month: string; left: number; onDone: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(String(left))
  const pay = useMutation<Row, ApiError>({
    mutationFn: () => {
      const body = { month, amountSom: Number(amount || 0) }
      return unwrap(r.assistantId != null
        ? api.POST('/api/salaries/assistants/{telegramId}/pay', { params: { path: { telegramId: r.assistantId } }, body })
        : api.POST('/api/salaries/{doctorId}/pay', { params: { path: { doctorId: r.doctorId! } }, body }))
    },
    onSuccess: onDone,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    pay.mutate()
  }
  return (
    <form className="form" aria-label={`Выплата: ${r.doctor}`} onSubmit={submit}>
      <label className="field"><span>Сумма выплаты, сом</span>
        <input inputMode="numeric" value={amount} autoFocus onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>
      <p className="hint">Запишется в «Расходы» как «Зарплата за {monthTitle(month)}» на сегодня. Ошиблись — удалите этот расход в «Расходах».</p>
      {pay.error && <p className="error" role="alert">{errorText(pay.error)}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={pay.isPending || !Number(amount)}>Выплачено</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  )
}

/**
 * «Получено от врача»: аренда больше его заработка — врач приносит разницу. Это доход клиники на
 * сегодня: прибыль в «Расходах» её учтёт (сервер отдаёт её в сводке как «аренда»).
 */
function RentForm({ row: r, month, left, onDone, onCancel }: { row: Row; month: string; left: number; onDone: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(String(left))
  const receive = useMutation<Row, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/salaries/{doctorId}/rent', { params: { path: { doctorId: r.doctorId! } }, body: { month, amountSom: Number(amount || 0) } })),
    onSuccess: onDone,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    receive.mutate()
  }
  return (
    <form className="form" aria-label={`Аренда от врача: ${r.doctor}`} onSubmit={submit}>
      <label className="field"><span>Сколько врач принёс, сом</span>
        <input inputMode="numeric" value={amount} autoFocus onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} /></label>
      <p className="hint">Аренда за {monthTitle(month)} — доход клиники на сегодня: прибыль в «Расходах» её учтёт.</p>
      {receive.error && <p className="error" role="alert">{errorText(receive.error)}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={receive.isPending || !Number(amount)}>Получено</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  )
}

/** «Как это работает»: три шага — условия, расчёт, выплата. Пока условий нет — открыто само. */
function SalaryHowTo({ seesAll, noTerms }: { seesAll: boolean; noTerms: boolean }) {
  return (
    <details className="card-block salary-howto" open={seesAll && noTerms}>
      <summary>Как работает зарплата</summary>
      <ol>
        {seesAll && <li><b>Условия</b> — у каждого врача и сотрудника (ассистента, регистратуры, администратора) своя кнопка «⚙️ Задать процент и оклад»: процент от выручки, оклад в месяц или оба. Задаются один раз; настраивает и выплачивает только администратор.</li>}
        <li><b>Расчёт сам</b> — «К выплате» = оклад + процент от выручки за месяц. Выручка врача — оплаты пациентов за его приёмы; ассистента — оплаты за приёмы врачей, которым он помогает; регистратуры и администратора — всей клиники (им обычно ставят только оклад).</li>
        <li><b>Оклад по табелю</b> — галочка в условиях: оклад начисляется за отработанные дни, «Табель» в карточке — сетка дней месяца. Рабочие дни берутся из графика (часы врача, смены сотрудника), отпуск и выходные — из «Перерывов и выходных»; больничный и прогул отмечает администратор. Пример: оклад 30 000, отработано 20 из 22 дней → 27 273 сом.</li>
        <li><b>Аренда кресла</b> — частный врач забирает выручку своих пациентов, но платит клинике аренду: сумму в месяц или процент от своей выручки. Она вычитается из «К выплате»; если аренда больше заработка — выплаты нет, а карточка покажет, сколько врач должен клинике.</li>
        {seesAll && <li><b>Выплата</b> — в начале месяца выберите прошлый месяц и нажмите «Выплатить». Выплата сама запишется в «Расходы» как «Зарплата», прибыль её учтёт.</li>}
      </ol>
      <p className="hint">Пример: 30% + оклад 10 000 сом, выручка за месяц 200 000 сом → к выплате 10 000 + 60 000 = 70 000 сом.</p>
    </details>
  )
}

const digits = (v: string) => v.replace(/\D/g, '')
const percentText = (p: number) => `${String(p).replace('.', ',')}%`

/**
 * «Калькулятор зарплаты» — только подсказка: «сколько выйдет, если…». Ничего не сохраняет и
 * никуда не отправляет. Врачам часто платят процент от выручки минус материалы или техника —
 * это поле есть здесь, но «К выплате» в карточках считает сервер от всей выручки (без вычета),
 * об этом — подсказка под итогом. Выручку и условия можно взять из строки сотрудника: только
 * те строки, что этот человек уже видит на вкладке (врач — свою), доступ не шире.
 */
function SalaryCalc({ rows }: { rows: Row[] }) {
  const [from, setFrom] = useState('')
  const [revenue, setRevenue] = useState('')
  const [percent, setPercent] = useState('')
  const [base, setBase] = useState('')
  const [materials, setMaterials] = useState('')
  const keyOf = (r: Row) => (r.doctorId != null ? `d${r.doctorId}` : `a${r.assistantId}`)
  const pick = (key: string) => {
    setFrom(key)
    const r = rows.find((x) => keyOf(x) === key)
    if (!r) return
    setRevenue(r.revenueSom ? String(r.revenueSom) : '')
    setPercent(Number(r.percent ?? 0) ? String(Number(r.percent)) : '')
    setBase(r.baseSom ? String(r.baseSom) : '')
  }
  const rev = Number(revenue || 0)
  const p = Number(percent.replace(',', '.') || 0)
  const b = Number(base || 0)
  const m = Number(materials || 0)
  const net = Math.max(0, rev - m)
  const result = b + Math.round((net * p) / 100)
  const of = m ? `(${somText(rev)} − ${somText(m)})` : somText(rev)
  return (
    <details className="card-block salary-calc">
      <summary>Калькулятор зарплаты</summary>
      <p className="hint">Посчитать «а сколько выйдет, если…». Ничего не сохраняется.</p>
      {rows.length > 0 && (
        <label className="field"><span>Взять выручку и условия</span>
          <Select aria-label="Взять выручку и условия" value={from} onChange={(e) => pick(e.target.value)}>
            <option value="">Свои цифры</option>
            {rows.map((r) => <option key={keyOf(r)} value={keyOf(r)}>{`${r.doctor} · ${somText(r.revenueSom ?? 0)}`}</option>)}
          </Select>
        </label>
      )}
      <div className="calc-grid">
        <label className="field"><span>Выручка, сом</span>
          <input inputMode="numeric" value={revenue} placeholder="например, 200000" onChange={(e) => setRevenue(digits(e.target.value))} /></label>
        <label className="field"><span>Процент, %</span>
          <input inputMode="decimal" value={percent} placeholder="например, 30" onChange={(e) => setPercent(e.target.value.replace(/[^\d.,]/g, ''))} /></label>
        <label className="field"><span>Оклад, сом</span>
          <input inputMode="numeric" value={base} placeholder="0 — без оклада" onChange={(e) => setBase(digits(e.target.value))} /></label>
        <label className="field"><span>Вычесть материалы/техника, сом</span>
          <input inputMode="numeric" value={materials} placeholder="необязательно" onChange={(e) => setMaterials(digits(e.target.value))} /></label>
      </div>
      <p className="salary-preview" aria-label="Результат калькулятора">
        {b ? `${somText(b)} + ` : ''}{percentText(p)} × {of} = <b className="num">{somText(result)}</b>
      </p>
      {m > rev && <p className="tone-wait small">Материалы больше выручки — процент считается от 0.</p>}
      <p className="hint small">Это подсказка, а не начисление. «К выплате» в карточках считает сервер: оклад + процент от всей выручки, материалы и техника он не вычитает.</p>
    </details>
  )
}
