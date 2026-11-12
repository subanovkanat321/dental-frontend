import { useQuery } from '@tanstack/react-query'
import { contactPhone } from '../lib/guardian'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { seesMoneyOf } from '../lib/roles'
import { somText, timeOf } from '../lib/time'
import { docDate } from './paper'
import { PrintSheet } from './PrintSheet'
import { DocActions } from './SendToPatient'
import { Select } from '../layout/Select'

type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']
type Receipt = Schemas['ReceiptsReceiptView']
type CareMemo = Schemas['CareMemosAppointmentMemo']
type MemoLang = 'RU' | 'KY'

const METHODS: Record<string, string> = { CASH: 'наличные', TRANSFER: 'перевод', CARD: 'карта' }

/**
 * Документы приёма, который состоялся: памятка после процедуры и квитанция об оплате (ей — кто
 * видит деньги этого приёма). На карточке приёма и в истории визитов пациента.
 *
 * @param memo показывать памятку; на карточке приёма она — в «Сообщении после приёма» (AfterVisit)
 */
export function VisitDocs({ appointment: a, me, memo = true }: { appointment: Appointment; me: Me; memo?: boolean }) {
  if (a.status !== 'DONE') return null
  const money = seesMoneyOf(me, a.doctorId) && (a.paidSom != null || a.chargeSom != null)
  if (!memo && !money) return null
  return (
    <section className="visit-docs" aria-label="Документы приёма">
      {memo && <MemoDocs appointment={a} />}
      {money && <ReceiptDocs appointment={a} />}
    </section>
  )
}

/**
 * «Памятка: После удаления зуба» — по услуге приёма (её ставят в «Клиника → Услуги и цены»), можно
 * выбрать другую. Нет памятки у услуги — выбрать из списка. На карточке приёма — тем, кому личное
 * «Сообщение после приёма» не положено (регистратура, ассистент): памятку они отправляют, как раньше.
 */
export function MemoDocs({ appointment: a }: { appointment: Appointment }) {
  const id = a.id
  const [chosen, setChosen] = useState<number | null>(null)
  // Язык памятки: не выбран — язык пациента в боте (сервер); выбран — для WhatsApp, бота и печати
  const [lang, setLang] = useState<MemoLang | null>(null)
  const [printing, setPrinting] = useState(false)
  const memo = useQuery({
    queryKey: lang ? ['care-memo', id, chosen, lang] : ['care-memo', id, chosen],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/care-memo', {
      params: { path: { id }, query: { memoId: chosen ?? undefined, lang: lang ?? undefined } },
    })),
    retry: false,
    placeholderData: (prev) => prev,
  })
  const [picking, setPicking] = useState(false)
  const all = useQuery({
    queryKey: ['care-memos'],
    queryFn: () => unwrap(api.GET('/api/care-memos')),
    enabled: picking || (memo.isSuccess && memo.data.memoId == null),
  })
  if (memo.isPending || memo.error) return null
  const m = memo.data
  const options = (all.data ?? []).filter((x) => x.active !== false || x.id === m.memoId)
  const picker = (
    <Select aria-label="Выбрать памятку" value={m.memoId ?? ''} onChange={(e) => setChosen(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{m.memoId == null ? 'Выберите памятку…' : 'Как у услуги'}</option>
      {options.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
    </Select>
  )
  if (m.memoId == null) {
    return (
      <div className="doc-box">
        <p className="hint small">📋 У услуги нет памятки после процедуры — можно выбрать:</p>
        {picker}
      </div>
    )
  }
  return (
    <div className="doc-box">
      <p className="line-edit">
        <span>📋 Памятка: <b>{m.title}</b></span>
        {!picking && <button type="button" className="link" onClick={() => setPicking(true)}>другая</button>}
      </p>
      {picking && picker}
      {m.ky && <MemoLangSwitch value={m.lang ?? 'RU'} patientLang={m.patientLang} onChange={setLang} />}
      <DocActions label={`памятка «${m.title}»`} phone={contactPhone(a.patient)} message={m}
        send={() => unwrap(api.POST('/api/appointments/{id}/care-memo/send', { params: { path: { id } }, body: { memoId: m.memoId, lang: m.lang } }))}
        onPrint={() => setPrinting(true)} />
      {printing && <MemoSheet appointment={a} memo={m} onClose={() => setPrinting(false)} />}
    </div>
  )
}

/** «Русский / Кыргызский» у памятки с кыргызским текстом; язык пациента — подсказкой. */
function MemoLangSwitch({ value, patientLang, onChange }: { value: MemoLang; patientLang?: MemoLang; onChange: (lang: MemoLang) => void }) {
  return (
    <div className="segments" role="group" aria-label="Язык памятки">
      {(['RU', 'KY'] as const).map((l) => (
        <button key={l} type="button" aria-pressed={value === l} onClick={() => onChange(l)}>
          {l === 'RU' ? 'Русский' : 'Кыргызский'}{patientLang === l ? ' · язык пациента' : ''}
        </button>
      ))}
    </div>
  )
}

const SHEET: Record<MemoLang, { patient: string; visit: string }> = {
  RU: { patient: 'Пациент', visit: 'Приём' },
  KY: { patient: 'Бейтап', visit: 'Кабыл алуу' },
}

/**
 * Лист памятки пациенту на руки: название, пациент, дата приёма, текст. Есть кыргызский текст —
 * переключатель «Русский / Кыргызский» над листом (не печатается); сначала — язык с карточки (язык
 * пациента, если он известен).
 */
export function MemoSheet({ appointment: a, memo, onClose }: { appointment: Appointment; memo: CareMemo; onClose: () => void }) {
  const first: MemoLang = memo.lang ?? 'RU'
  const [lang, setLang] = useState<MemoLang>(first)
  const sheet = useQuery({
    queryKey: ['care-memo', a.id, memo.memoId, lang],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/care-memo', { params: { path: { id: a.id }, query: { memoId: memo.memoId, lang } } })),
    // Первый язык — текст с карточки, без запроса; другой — с сервера (телефон клиники подставлен там)
    enabled: lang !== first,
    placeholderData: (prev) => prev,
    retry: false,
  })
  const m = lang === first ? memo : sheet.data ?? memo
  const words = SHEET[m.lang ?? 'RU']
  return (
    <PrintSheet title="Памятка пациенту" onClose={onClose}
      tools={memo.ky ? <MemoLangSwitch value={lang} patientLang={memo.patientLang} onChange={setLang} /> : undefined}>
      {() => (
        <>
          <h1>{m.title}</h1>
          <dl>
            <dt>{words.patient}</dt><dd>{a.patient.fullName}</dd>
            <dt>{words.visit}</dt><dd>{docDate(a.startAt)}</dd>
          </dl>
          <div className="memo-body">{m.body}</div>
        </>
      )}
    </PrintSheet>
  )
}

function ReceiptDocs({ appointment: a }: { appointment: Appointment }) {
  const id = a.id
  const [printing, setPrinting] = useState(false)
  const receipt = useQuery({
    // Ключ — по деньгам приёма: доплатили — квитанция перечитается
    queryKey: ['receipt', id, a.paidSom, a.chargeSom, a.debtSom],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/receipt', { params: { path: { id } } })),
    retry: false,
  })
  if (receipt.isPending || receipt.error) return null
  const r = receipt.data
  return (
    <div className="doc-box">
      <p>🧾 Квитанция об оплате</p>
      <DocActions label="квитанция" phone={contactPhone(a.patient)} message={r}
        send={() => unwrap(api.POST('/api/appointments/{id}/receipt/send', { params: { path: { id } } }))}
        onPrint={() => setPrinting(true)} />
      {printing && (
        <PrintSheet title="Квитанция об оплате" formats onClose={() => setPrinting(false)}>
          {(format) => <ReceiptSheet r={r} narrow={format === 'receipt'} />}
        </PrintSheet>
      )}
    </div>
  )
}

function ReceiptSheet({ r, narrow }: { r: Receipt; narrow: boolean }) {
  return (
    <>
      <h1>Квитанция об оплате</h1>
      <dl>
        <dt>Пациент</dt><dd>{r.patient}</dd>
        <dt>Приём</dt><dd>{docDate(r.startAt!)}, {timeOf(r.startAt!)}</dd>
        <dt>Врач</dt><dd>{r.doctor}</dd>
        {r.service && <><dt>Услуга</dt><dd>{r.service}</dd></>}
        {r.chargeSom != null && <><dt>Стоимость</dt><dd>{somText(r.chargeSom)}</dd></>}
      </dl>
      {/* Чек 80 мм — платежи строками: таблица в четыре колонки там не помещается */}
      {/* «Всё в долг» — платежей ещё нет: пустой таблицы не рисуем */}
      {!r.payments?.length ? null : narrow ? (
        <ul className="payments" aria-label="Платежи">
          {r.payments.map((p, i) => (
            <li key={i}>{docDate(p.paidAt!)} · {METHODS[p.method ?? ''] ?? p.method} · {somText(p.amountSom)}{p.takenBy ? ` · принял(а) ${p.takenBy}` : ''}</li>
          ))}
        </ul>
      ) : (
        <table aria-label="Платежи">
          <thead><tr><th>Дата</th><th>Способ</th><th>Принял</th><th className="r">Сумма</th></tr></thead>
          <tbody>
            {r.payments.map((p, i) => (
              <tr key={i}>
                <td>{docDate(p.paidAt!)}</td>
                <td>{METHODS[p.method ?? ''] ?? p.method}</td>
                <td>{p.takenBy ?? '—'}</td>
                <td className="r">{somText(p.amountSom)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="total">Оплачено: {somText(r.paidSom)}</p>
      <p className="total">{r.debtSom ? `Осталось оплатить: ${somText(r.debtSom)}` : 'Оплачено полностью'}</p>
      <div className="signatures"><span>Принял ____________________</span></div>
      <p className="fiscal">Не является фискальным чеком</p>
    </>
  )
}
