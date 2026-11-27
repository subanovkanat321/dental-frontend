import { useQuery, useQueryClient } from '@tanstack/react-query'
import { contactPhone } from '../lib/guardian'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { discountText } from '../lib/discount'
import { seesMoneyOf } from '../lib/roles'
import { somText, timeOf } from '../lib/time'
import { docDate, docNumber, type PaperFormat } from './paper'
import { PrintSheet } from './PrintSheet'
import { DocActions } from './SendToPatient'
import { Select } from '../layout/Select'
import { useMe } from '../api/me'

type Appointment = Schemas['AppointmentView']
type Me = Schemas['BookingViewsMe']
type Receipt = Schemas['ReceiptsReceiptView']
type CareMemo = Schemas['CareMemosAppointmentMemo']
type MemoLang = 'RU' | 'KY'
type DocKind = NonNullable<Receipt['kind']>

const METHODS: Record<string, string> = { CASH: 'наличные', TRANSFER: 'перевод', CARD: 'карта', ADVANCE: 'с аванса' }

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
      {money && <ReceiptDocs appointment={a} me={me} />}
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
        paper={{ render: () => <MemoPaper appointment={a} memo={m} />, image: { fileName: 'pamyatka.png' } }} onPrint={() => setPrinting(true)} />
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
  return (
    <PrintSheet title="Памятка пациенту" onClose={onClose}
      tools={memo.ky ? <MemoLangSwitch value={lang} patientLang={memo.patientLang} onChange={setLang} /> : undefined}>
      {() => <MemoPaper appointment={a} memo={m} />}
    </PrintSheet>
  )
}

/** Содержимое листа памятки — в окне печати и в «🔍 Просмотре» одно и то же. */
export function MemoPaper({ appointment: a, memo: m }: { appointment: Appointment; memo: CareMemo }) {
  const words = SHEET[m.lang ?? 'RU']
  return (
    <>
      <h1>{m.title}</h1>
      <dl>
        <dt>{words.patient}</dt><dd>{a.patient.fullName}</dd>
        <dt>{words.visit}</dt><dd>{docDate(a.startAt)}</dd>
      </dl>
      <div className="memo-body">{m.body}</div>
    </>
  )
}

/**
 * Квитанция об оплате или «Акт выполненных работ» (V271) — переключатель над кнопками. Остался долг — в квитанции «Как
 * оплатить» (реквизиты и QR клиники или врача, который берёт оплату сам — выбирает сервер, как в напоминании о долге).
 * Долг есть, а реквизитов нигде нет — подсказка, где их добавить. Номер документа («№ 000123», свой у клиники) сервер
 * выдаёт при первом «🔍 Просмотре» или «📤 Отправить» и дальше не меняет.
 */
function ReceiptDocs({ appointment: a, me }: { appointment: Appointment; me: Me }) {
  const id = a.id
  const qc = useQueryClient()
  const [kind, setKind] = useState<DocKind>('RECEIPT')
  const [printing, setPrinting] = useState<PaperFormat | null>(null)
  // Ключ — по деньгам приёма: доплатили — квитанция перечитается
  const key = ['receipt', id, kind, a.paidSom, a.chargeSom, a.debtSom, a.discount?.som, a.paymentMethod, a.servicesTotalSom, a.services?.length]
  const receipt = useQuery({
    queryKey: key,
    queryFn: () => unwrap(api.GET('/api/appointments/{id}/receipt', { params: { path: { id }, query: { kind } } })),
    retry: false,
    placeholderData: (prev) => prev,
  })
  if (receipt.isPending || receipt.error) return null
  const r = receipt.data
  const act = kind === 'ACT'
  // Номер — при первом просмотре или отправке; уже есть — ничего не просим
  const issue = async () => {
    if (r.number != null && r.kind === kind) return
    qc.setQueryData(key, await unwrap(api.POST('/api/appointments/{id}/receipt/number', { params: { path: { id }, query: { kind } } })))
  }
  const title = act ? 'Акт выполненных работ' : 'Квитанция об оплате'
  return (
    <div className="doc-box">
      <div className="segments doc-kind" role="group" aria-label="Документ">
        <button type="button" aria-pressed={!act} onClick={() => setKind('RECEIPT')}>🧾 Квитанция</button>
        <button type="button" aria-pressed={act} onClick={() => setKind('ACT')}>📄 Акт выполненных работ</button>
      </div>
      {!act && r.debtSom > 0 && !r.pay && <NoPayHint admin={Boolean(me.admin)} />}
      <DocActions key={kind} label={act ? 'акт выполненных работ' : 'квитанция'} phone={contactPhone(a.patient)} message={r} onOpen={issue}
        note={(channel) => !act && channel === 'TELEGRAM' && r.pay?.qrToken
          ? <p className="hint small">📎 Следом бот пришлёт картинку QR для оплаты.</p> : null}
        send={() => unwrap(api.POST('/api/appointments/{id}/receipt/send', { params: { path: { id }, query: { kind } } }))}
        paper={act
          ? { render: () => <ActSheet r={r} />, image: { fileName: 'akt.png' } }
          : { formats: true, render: (format) => <ReceiptSheet r={r} narrow={format === 'receipt'} />, image: { fileName: 'kvitanciya.png' } }}
        onPrint={(format) => setPrinting(format)} />
      {printing && (
        <PrintSheet title={title} formats={!act} initialFormat={act ? 'a4' : printing} onClose={() => setPrinting(null)}>
          {(format) => act ? <ActSheet r={r} /> : <ReceiptSheet r={r} narrow={format === 'receipt'} />}
        </PrintSheet>
      )}
    </div>
  )
}

/** «№ 000123 от 27.11.2026» под заголовком документа; номера ещё нет — ничего. На чеке 80 мм — только номер. */
function DocNumber({ r, narrow = false }: { r: Receipt; narrow?: boolean }) {
  if (r.number == null) return null
  return <p className="doc-number">{docNumber(r.number)}{!narrow && r.numberedAt ? ` от ${docDate(r.numberedAt)}` : ''}</p>
}

/** «Подпись врача ____ / Подпись пациента ____» внизу A4. */
function SignLines({ left = 'Подпись врача', right = 'Подпись пациента' }: { left?: string; right?: string }) {
  return (
    <div className="signatures doc-signs">
      <span>{left} ____________________</span>
      <span>{right} ____________________</span>
    </div>
  )
}

/** Долг есть, реквизитов и QR нет ни у клиники, ни у врача: пациент не узнает из квитанции, куда платить. */
function NoPayHint({ admin }: { admin: boolean }) {
  const where = 'Клиника → О клинике → Предоплата за запись'
  return (
    <p className="hint small receipt-no-pay">
      💳 Добавьте реквизиты и QR для оплаты — «{admin ? <a href="#/clinic/about">{where}</a> : where}», чтобы пациент знал, куда
      оплатить долг. {admin ? '' : 'Заполняет руководитель. '}Врач на аренде кресла — свои в «Моём профиле» → «Как оплатить мне».
    </p>
  )
}

/** «Как оплатить» на листе квитанции: реквизиты и QR (картинка — открытая страница QR /web/pay/<токен>/qr, как у /pay). */
function PayBlock({ pay }: { pay: NonNullable<Receipt['pay']> }) {
  return (
    <section className="receipt-pay" aria-label="Как оплатить">
      <div>
        <h2>Как оплатить</h2>
        {pay.details ? <p className="receipt-pay-details">{pay.details}</p> : <p>Отсканируйте QR в приложении банка</p>}
      </div>
      {pay.qrToken && <img className="receipt-pay-qr" src={`/web/pay/${pay.qrToken}/qr`} alt="QR для оплаты" />}
    </section>
  )
}

function ReceiptSheet({ r, narrow }: { r: Receipt; narrow: boolean }) {
  return (
    <>
      <h1>Квитанция об оплате</h1>
      <DocNumber r={r} narrow={narrow} />
      <dl>
        <dt>Пациент</dt><dd>{r.patient}</dd>
        <dt>Приём</dt><dd>{docDate(r.startAt!)}, {timeOf(r.startAt!)}</dd>
        <dt>Врач</dt><dd>{r.doctor}</dd>
        {/* Несколько услуг, зубы или количество (шаг 5А) — списком; одна простая — строкой, как раньше */}
        {(r.lines?.length ?? 0) > 1 || (r.lines?.[0] && (r.lines[0].qty > 1 || (r.lines[0].teeth?.length ?? 0) > 0)) ? <>
          <dt>Услуги</dt>
          <dd>
            <ul className="receipt-lines" aria-label="Услуги">
              {r.lines!.map((l, i) => (
                <li key={i}>{l.name}{l.teeth?.length ? ` (${l.teeth.join(', ')})` : ''}{l.qty > 1 ? ` × ${l.qty}` : ''}
                  {l.amountSom != null && l.discountSom ? ` — ${somText(l.amountSom)} → ${somText(l.amountSom - l.discountSom)} (скидка ${somText(l.discountSom)})`
                    : l.amountSom != null ? ` — ${somText(l.amountSom)}` : ''}</li>
              ))}
            </ul>
          </dd>
        </> : r.service && <><dt>Услуга</dt><dd>{r.service}</dd></>}
        {r.linesDiscountSom ? <>
          {/* Скидки по строкам услуг (V258): стоимость до скидок, скидка по услугам, общая скидка, «Скидка всего», к оплате */}
          <dt>Стоимость</dt><dd>{somText(r.fullSom ?? 0)}</dd>
          <dt>Скидка по услугам</dt><dd>{somText(r.linesDiscountSom)}</dd>
          {r.discount && <><dt>Скидка</dt><dd>{discountText(r.discount).replace(/^Скидка /, '')}</dd>
            <dt>Скидка всего</dt><dd>{somText(r.linesDiscountSom + r.discount.som)}</dd></>}
          <dt>К оплате</dt><dd>{somText(r.chargeSom ?? 0)}</dd>
        </> : r.discount ? <>
          {/* Скидка (шаг 3Б): цена, скидка и к оплате; причину пациенту не печатаем */}
          <dt>Стоимость</dt><dd>{somText(r.discount.priceSom)}</dd>
          <dt>Скидка</dt><dd>{discountText(r.discount).replace(/^Скидка /, '')}</dd>
          <dt>К оплате</dt><dd>{somText(r.chargeSom ?? 0)}</dd>
        </> : r.chargeSom != null && <><dt>Стоимость</dt><dd>{somText(r.chargeSom)}</dd></>}
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
      {/* Аванс (V243): сколько из оплаты — с аванса и сколько на нём осталось (у семьи — общий остаток) */}
      {r.advanceSom != null && <p className="total">Оплачено с аванса: {somText(r.advanceSom)}</p>}
      {r.advanceSom != null && r.advanceLeftSom != null && <p className="total">Остаток аванса: {somText(r.advanceLeftSom)}</p>}
      <p className="total">{r.debtSom ? `Осталось оплатить: ${somText(r.debtSom)}` : 'Оплачено полностью'}</p>
      {r.debtSom > 0 && r.pay && <PayBlock pay={r.pay} />}
      {/* A4 — подписи врача и пациента (документ на руки); чек 80 мм — компактно, как раньше */}
      {narrow ? <div className="signatures"><span>Принял ____________________</span></div> : <SignLines />}
      <p className="fiscal">Не является фискальным чеком</p>
    </>
  )
}

/**
 * «Акт выполненных работ» (A4): номер и дата, исполнитель — юрлицо или ИП из «О клинике» (не заполнено — название
 * клиники), заказчик — пациент, таблица работ (услуга, зубы, количество, сумма), стоимость, скидка, итог и подписи.
 * Оплат и долга в акте нет: он о сделанной работе. Суммы строк — с сервера, до скидок (не сходятся с ценой приёма — «—»);
 * скидки строк и общая — одной строкой «Скидка».
 */
export function ActSheet({ r }: { r: Receipt }) {
  const me = useMe()
  const clinic = me.data?.clinic
  const performer = clinic?.legalName || clinic?.brandName || clinic?.name
  const lines = r.lines?.length ? r.lines : [{ name: r.service ?? 'Приём', qty: 1, teeth: [], amountSom: r.fullSom ?? r.chargeSom ?? undefined, discountSom: undefined }]
  const off = (r.linesDiscountSom ?? 0) + (r.discount?.som ?? 0)
  return (
    <>
      <h1>Акт выполненных работ</h1>
      <DocNumber r={r} />
      <dl>
        {performer && <><dt>Исполнитель</dt><dd>{performer}</dd></>}
        <dt>Заказчик</dt><dd>{r.patient}</dd>
        <dt>Приём</dt><dd>{docDate(r.startAt!)}, {timeOf(r.startAt!)}</dd>
        <dt>Врач</dt><dd>{r.doctor}</dd>
      </dl>
      <table aria-label="Выполненные работы">
        <thead><tr><th>№</th><th>Услуга</th><th>Зубы</th><th className="r">Кол-во</th><th className="r">Сумма</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{l.name}</td>
              <td>{l.teeth?.length ? l.teeth.join(', ') : '—'}</td>
              <td className="r">{l.qty}</td>
              <td className="r">{l.amountSom != null ? somText(l.amountSom) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {off > 0 && <p className="total">Стоимость: {somText(r.fullSom ?? (r.chargeSom ?? 0) + off)}</p>}
      {off > 0 && <p className="total">Скидка: {somText(off)}</p>}
      <p className="total">Итого: {somText(r.chargeSom ?? 0)}</p>
      <p className="act-note">Работы выполнены полностью. Заказчик претензий по объёму, качеству и срокам не имеет.</p>
      <SignLines />
    </>
  )
}
