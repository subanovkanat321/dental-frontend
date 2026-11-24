import { useQuery } from '@tanstack/react-query'
import { contactPhone } from '../lib/guardian'
import { useRef, useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { useMe } from '../api/me'
import { isAssistant } from '../lib/roles'
import { somText } from '../lib/time'
import { stagesOf } from '../lib/planStages'
import { totalsOf, totalText } from '../medical/stepDiscount'
import { PriceCell } from '../medical/StepPrice'
import { assignText, byTooth } from '../lib/planSteps'
import { canPrint, docDate } from './paper'
import { PrintSheet } from './PrintSheet'
import { DocActions } from './SendToPatient'
import { PlanOffer } from './PlanOffer'
import { PlanChart } from './PlanChart'
import { PlanSendSheet } from './PlanSend'
import { SheetSend } from './SheetSend'
import { planImage } from './planImage'

type Step = Schemas['TreatmentStepView']
type Patient = Schemas['PatientView']
type Variant = Schemas['PlanVariantsVariantView']

/**
 * Документы плана лечения. Врач и админ — «Отправить план пациенту» с ценами, этапами и кнопкой
 * «Согласен» (PlanOffer, V140). Ассистенту денег не показываем: у него прежние «🖨 Печать» и
 * «📤 Отправить пациенту» — план без цен.
 */
export function PlanDocs({ patient, steps, variants }: {
  patient: Patient
  steps: Step[]
  /** Несколько вариантов, пациент ещё не выбрал (V254) — на листе все варианты с итогами */
  variants?: Variant[]
}) {
  const me = useMe().data
  // 'image' — открыть лист сразу с «Отправить листом» («📄 Листом A4» в «Отправить план пациенту»)
  const [printing, setPrinting] = useState<false | 'print' | 'image'>(false)
  if (!me || !steps.length) return null
  if (isAssistant(me)) return <PlainPlanDocs patient={patient} steps={steps} variants={variants} />
  // Печать всего плана (со сделанным) — как была; отправка — предложение с ценами и сроком
  return (
    <>
      <div className="actions">
        {canPrint()
          ? <button type="button" className="btn" onClick={() => setPrinting('print')} aria-label="Печать: план лечения">🖨 План лечения</button>
          : <button type="button" className="btn" onClick={() => setPrinting('print')} aria-label="Лист: план лечения">📄 План лечения листом</button>}
      </div>
      <PlanOffer patient={patient} steps={steps} variants={variants} onSheet={() => setPrinting('image')} />
      {printing && <PlanPrint patient={patient} steps={steps} variants={variants} image={printing === 'image'} onClose={() => setPrinting(false)} />}
    </>
  )
}

function PlainPlanDocs({ patient, steps, variants }: { patient: Patient; steps: Step[]; variants?: Variant[] }) {
  const patientId = patient.id
  const [printing, setPrinting] = useState(false)
  // Текст для WhatsApp — заранее: окно WhatsApp браузер откроет только сразу по нажатию
  const version = steps.map((s) => [s.id, s.tooth, s.title, s.priceSom, s.doneAt].join(':')).join('|')
  const message = useQuery({
    queryKey: ['plan-message', patientId, version],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/plan/message', { params: { path: { patientId } } })),
    enabled: steps.length > 0,
    retry: false,
  })
  if (!steps.length) return null
  return (
    <>
      <DocActions label="план лечения" phone={contactPhone(patient)} message={message.data}
        send={() => unwrap(api.POST('/api/patients/{patientId}/plan/send', { params: { path: { patientId } } }))}
        paper={{ render: () => <PlanPaper patient={patient} steps={steps} variants={variants} />, image: planImage(patientId) }}
        onPrint={() => setPrinting(true)} />
      {printing && <PlanPrint patient={patient} steps={steps} variants={variants} onClose={() => setPrinting(false)} />}
    </>
  )
}

/**
 * «🖨 План лечения» на A4 (печать браузера = сохранение в PDF): шапка клиники (PrintSheet), пациент и дата
 * рождения, врач, зубная формула обеих челюстей цветом (PlanChart, шаг 4А), этапы «По этапам» или «По зубам»
 * с услугами, врачом и сроком этапа и ценами, итог за этап и всего, сколько выполнено и осталось, долг за проведённое
 * лечение (если есть), «ознакомлен(а)» и подписи с датой. «С ценами» — кто видит деньги (ассистенту цены сервер не
 * присылает, долг не запрашиваем); снять галочку — экземпляр пациенту без цен. «📤 Пациенту» — ссылка на план в WhatsApp
 * или план в бот (PlanSendSheet) — у тех, кто ведёт план. «📷 Отправить листом» — этот же лист картинкой (SheetSend): фото
 * в бот, «Поделиться» в WhatsApp или «Скачать картинку». В Telegram (Mini App) лист открывается без печати — ради этой кнопки.
 */
type View = 'stages' | 'teeth'

function PlanPrint({ patient, steps, variants, image = false, onClose }: {
  patient: Patient; steps: Step[]; variants?: Variant[]; image?: boolean; onClose: () => void
}) {
  const me = useMe().data
  const [note, setNote] = useState('')
  const [view, setView] = useState<View>('stages')
  const money = Boolean(me && !isAssistant(me))
  const [withPrices, setWithPrices] = useState(true)
  const [sending, setSending] = useState(false)
  const [imaging, setImaging] = useState(image)
  const sheet = useRef<HTMLElement>(null)
  return (
    <PrintSheet title="План лечения" onClose={onClose} sheetRef={sheet}
      tools={
        <>
          <div className="segments" role="group" aria-label="Вид плана">
            <button type="button" aria-pressed={view === 'stages'} onClick={() => setView('stages')}>По этапам</button>
            <button type="button" aria-pressed={view === 'teeth'} onClick={() => setView('teeth')}>По зубам</button>
          </div>
          {money && steps.some((s) => s.priceSom != null) && (
            <label className="check"><input type="checkbox" checked={withPrices} onChange={(e) => setWithPrices(e.target.checked)} /> С ценами</label>
          )}
          {money && steps.some((s) => !s.doneAt) && <button type="button" className="btn" onClick={() => setSending(true)}>📤 Пациенту</button>}
          <button type="button" className="btn" onClick={() => setImaging(true)} aria-label="Отправить листом: план лечения">📷 Отправить листом</button>
          <textarea aria-label="Примечание на листе" rows={2} maxLength={1000} placeholder="Примечание — напечатается под планом"
            value={note} onChange={(e) => setNote(e.target.value)} />
          {sending && <PlanSendSheet patient={patient} onClose={() => setSending(false)} />}
          {imaging && (
            <SheetSend label="план лечения" image={planImage(patient.id)} sheet={() => sheet.current} telegram={Boolean(patient.telegram)}
              phone={contactPhone(patient)} onClose={() => setImaging(false)} />
          )}
        </>
      }>
      {() => <PlanPaper patient={patient} steps={steps} variants={variants} view={view} withPrices={withPrices} note={note} />}
    </PrintSheet>
  )
}

/**
 * Содержимое листа плана — в окне печати, во вкладке «📄 Лист» (ассистент) и в картинке «📷 Отправить листом» одно и то же.
 * Цены — у тех, кто видит деньги, и с галочкой «С ценами»; долг за проведённое лечение запрашиваем только у них.
 */
function PlanPaper({ patient, steps, variants, view = 'stages', withPrices = true, note = '' }: {
  patient: Patient
  steps: Step[]
  variants?: Variant[]
  view?: View
  withPrices?: boolean
  note?: string
}) {
  const me = useMe().data
  const money = Boolean(me && !isAssistant(me))
  const prices = money && withPrices && steps.some((s) => s.priceSom != null)
  const assigned = steps.some((s) => s.doctorName || s.dueOn)
  const patientId = patient.id
  const debts = useQuery({
    queryKey: ['debts', 'patient', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/debts', { params: { query: { patientId } } })),
    enabled: money,
    retry: false,
  })
  const debt = (debts.data ?? []).reduce((sum, d) => sum + d.debtSom, 0)
  const doctor = (me?.doctors ?? []).find((d) => d.id === me?.doctorId)?.fullName
  // Итоги — к оплате, со скидками этапов (V257); скидка — отдельной строкой
  const allT = totalsOf(steps)
  const all = allT.pay
  const left = totalsOf(steps.filter((s) => !s.doneAt)).pay
  // Несколько вариантов (V254): рисунок — все зубы вариантов, ниже у каждого свои этапы и итог
  const chartSteps = variants ? variants.flatMap((v) => (v.steps ?? []).filter((s) => !s.doneAt)) : steps
  return (
    <>
      <h1>План лечения</h1>
      <dl>
        <dt>Пациент</dt><dd>{patient.fullName}</dd>
        {patient.birthDate && <><dt>Дата рождения</dt><dd>{patient.birthDate.split('-').reverse().join('.')}</dd></>}
        <dt>Дата</dt><dd>{docDate(new Date().toISOString())}</dd>
        <dt>Врач</dt><dd>{doctor ?? '________________________'}</dd>
      </dl>
      <PlanChart patient={patient} steps={chartSteps} />
      {variants ? (
        <>
          <p className="note">Врач подготовил {variants.length} варианта лечения — выберите удобный.</p>
          {variants.map((v) => {
            const open = (v.steps ?? []).filter((s) => !s.doneAt)
            const t = totalsOf(open)
            return (
              <section key={v.id ?? 0} className="plan-variant-sheet">
                <h2>{v.label}</h2>
                <PlanTable steps={open} view={view} prices={prices} assigned={assigned} />
                {prices && <p className="total">Итого по варианту: {totalText(t)}</p>}
              </section>
            )
          })}
        </>
      ) : (
        <>
          <PlanTable steps={steps} view={view} prices={prices} assigned={assigned} />
          {prices && (
            <>
              {allT.off > 0 && <p className="r">Сумма по плану: {somText(allT.full)} · скидка −{somText(allT.off)}</p>}
              <p className="total">{allT.off > 0 ? 'Итого со скидкой' : 'Итого'}: {somText(all)}{left !== all ? ` · осталось: ${somText(left)}` : ''}</p>
              {left !== all && <p className="r">Уже выполнено на {somText(all - left)}</p>}
            </>
          )}
        </>
      )}
      {money && withPrices && debt > 0 && <p className="r"><b>Осталось оплатить за проведённое лечение: {somText(debt)}</b></p>}
      {note.trim() && <p><b>Примечание:</b> {note.trim()}</p>}
      <p className="note">План может меняться по результатам лечения.{prices ? ' Цены — на дату плана.' : ''}</p>
      {variants && <p>Выбранный вариант: № ______</p>}
      <p>С планом лечения{prices ? ' и его стоимостью' : ''} ознакомлен(а), согласен(на).</p>
      <div className="signatures">
        <span>Врач ____________________{doctor ? <small> {doctor}</small> : null}</span>
        <span>Пациент ____________________</span>
      </div>
      <p className="sign-date">Дата «____» ______________ 20____ г.</p>
    </>
  )
}

/** Таблица этапов листа: «По этапам» или «По зубам», сквозной номер, врач и срок, цена и статус. */
function PlanTable({ steps, view, prices, assigned }: { steps: Step[]; view: View; prices: boolean; assigned: boolean }) {
  const stages = stagesOf(steps)
  const groups = view === 'stages'
    ? stages.map((st) => ({ key: `s${st.stage}`, title: stages.length > 1 ? `Этап ${st.stage}` : null, items: st.items, total: st.total,
      subtotal: `Итого за этап ${st.stage}` }))
    : byTooth(steps).map((g) => ({ key: `t${g.tooth ?? 0}`, title: g.tooth != null ? `Зуб ${g.tooth}` : 'Вся полость рта', items: g.items,
      total: totalsOf(g.items).pay, subtotal: g.tooth != null ? `Итого по зубу ${g.tooth}` : 'Итого' }))
  // Сквозной номер строки через все группы (не счётчиком в render: лист перерисовывается)
  const number = new Map(groups.flatMap((g) => g.items).map((s, i) => [s.id, i + 1]))
  const columns = 4 + (assigned ? 1 : 0) + (prices ? 1 : 0)
  return (
    <table aria-label="Этапы плана" className="plan-table">
      <thead>
        <tr><th>№</th><th>Зуб</th><th>Что сделать</th>{assigned && <th>Врач, срок</th>}{prices && <th className="r">Цена</th>}<th>Статус</th></tr>
      </thead>
      {groups.map((g) => (
        <tbody key={g.key}>
          {g.title && (view === 'teeth' || groups.length > 1) && (
            <tr className="stage-row"><th colSpan={columns} scope="rowgroup">{g.title}</th></tr>
          )}
          {g.items.map((s) => (
            <tr key={s.id}>
              <td>{number.get(s.id)}</td>
              <td>{view === 'teeth' ? `этап ${s.stage}` : s.tooth ?? '—'}</td>
              <td>{s.title}</td>
              {assigned && <td className={s.overdue ? 'assign overdue' : 'assign'}>{assignText(s)}{s.overdue ? ' · просрочен' : ''}</td>}
              {prices && <td className="r"><PriceCell step={s} /></td>}
              <td>{s.doneAt ? `сделано ${docDate(s.doneAt)}` : 'в плане'}</td>
            </tr>
          ))}
          {prices && groups.length > 1 && g.total > 0 && (view === 'stages' || g.items.length > 1) && (
            <tr className="subtotal"><td colSpan={3 + (assigned ? 1 : 0)} className="r">{g.subtotal}</td><td className="r">{somText(g.total)}</td><td /></tr>
          )}
        </tbody>
      ))}
    </table>
  )
}
