import { useQuery } from '@tanstack/react-query'
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
 * «Памятка: После удаления зуба» — по услуге приёма (её ставят в «Настройки → Услуги и цены»), можно
 * выбрать другую. Нет памятки у услуги — выбрать из списка. На карточке приёма — тем, кому личное
 * «Сообщение после приёма» не положено (регистратура, ассистент): памятку они отправляют, как раньше.
 */
export function MemoDocs({ appointment: a }: { appointment: Appointment }) {
  const id = a.id!
  const [chosen, setChosen] = useState<number | null>(null)
  const [printing, setPrinting] = useState(false)
  const memo = useQuery({
    queryKey: ['care-memo', id, chosen],
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/care-memo', { params: { path: { id }, query: { memoId: chosen ?? undefined } } })),
    retry: false,
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
      <DocActions label={`памятка «${m.title}»`} phone={a.patient?.phone} message={m}
        send={() => unwrap(api.POST('/api/appointments/{id}/care-memo/send', { params: { path: { id } }, body: { memoId: m.memoId } }))}
        onPrint={() => setPrinting(true)} />
      {printing && <MemoSheet appointment={a} title={m.title!} body={m.body!} onClose={() => setPrinting(false)} />}
    </div>
  )
}

/** Лист памятки пациенту на руки: название, пациент, дата приёма, текст. */
export function MemoSheet({ appointment: a, title, body, onClose }: { appointment: Appointment; title: string; body: string; onClose: () => void }) {
  return (
    <PrintSheet title="Памятка пациенту" onClose={onClose}>
      {() => (
        <>
          <h1>{title}</h1>
          <dl>
            <dt>Пациент</dt><dd>{a.patient?.fullName}</dd>
            <dt>Приём</dt><dd>{docDate(a.startAt!)}</dd>
          </dl>
          <div className="memo-body">{body}</div>
        </>
      )}
    </PrintSheet>
  )
}

function ReceiptDocs({ appointment: a }: { appointment: Appointment }) {
  const id = a.id!
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
      <DocActions label="квитанция" phone={a.patient?.phone} message={r}
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
      {narrow ? (
        <ul className="payments" aria-label="Платежи">
          {(r.payments ?? []).map((p, i) => (
            <li key={i}>{docDate(p.paidAt!)} · {METHODS[p.method ?? ''] ?? p.method} · {somText(p.amountSom ?? 0)}{p.takenBy ? ` · принял(а) ${p.takenBy}` : ''}</li>
          ))}
        </ul>
      ) : (
        <table aria-label="Платежи">
          <thead><tr><th>Дата</th><th>Способ</th><th>Принял</th><th className="r">Сумма</th></tr></thead>
          <tbody>
            {(r.payments ?? []).map((p, i) => (
              <tr key={i}>
                <td>{docDate(p.paidAt!)}</td>
                <td>{METHODS[p.method ?? ''] ?? p.method}</td>
                <td>{p.takenBy ?? '—'}</td>
                <td className="r">{somText(p.amountSom ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="total">Оплачено: {somText(r.paidSom ?? 0)}</p>
      <p className="total">{r.debtSom ? `Осталось оплатить: ${somText(r.debtSom)}` : 'Оплачено полностью'}</p>
      <div className="signatures"><span>Принял ____________________</span></div>
      <p className="fiscal">Не является фискальным чеком</p>
    </>
  )
}
