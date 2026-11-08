import { useQuery } from '@tanstack/react-query'
import { contactPhone } from '../lib/guardian'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { useMe } from '../api/me'
import { isAssistant } from '../lib/roles'
import { somText } from '../lib/time'
import { stagesOf } from '../lib/planStages'
import { canPrint, docDate } from './paper'
import { PrintSheet } from './PrintSheet'
import { DocActions } from './SendToPatient'
import { PlanOffer } from './PlanOffer'

type Step = Schemas['TreatmentStepView']
type Patient = Schemas['PatientView']

/**
 * Документы плана лечения. Врач и админ — «Отправить план пациенту» с ценами, этапами и кнопкой
 * «Согласен» (PlanOffer, V140). Ассистенту денег не показываем: у него прежние «🖨 Печать» и
 * «📤 Отправить пациенту» — план без цен.
 */
export function PlanDocs({ patient, steps }: { patient: Patient; steps: Step[] }) {
  const me = useMe().data
  const [printing, setPrinting] = useState(false)
  if (!me || !steps.length) return null
  if (isAssistant(me)) return <PlainPlanDocs patient={patient} steps={steps} />
  // Печать всего плана (со сделанным) — как была; отправка — предложение с ценами и сроком
  return (
    <>
      {canPrint() && (
        <div className="actions">
          <button type="button" className="btn" onClick={() => setPrinting(true)} aria-label="Печать: план лечения">🖨 План лечения</button>
        </div>
      )}
      <PlanOffer patient={patient} steps={steps} />
      {printing && <PlanPrint patient={patient} steps={steps} onClose={() => setPrinting(false)} />}
    </>
  )
}

function PlainPlanDocs({ patient, steps }: { patient: Patient; steps: Step[] }) {
  const patientId = patient.id!
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
        onPrint={() => setPrinting(true)} />
      {printing && <PlanPrint patient={patient} steps={steps} onClose={() => setPrinting(false)} />}
    </>
  )
}

/**
 * «🖨 План лечения» на A4 (печать браузера = сохранение в PDF): шапка клиники (PrintSheet), пациент и дата
 * рождения, врач, этапы (V140) с зубами, услугами и ценами, итог за этап и всего, сколько уже выполнено и
 * сколько осталось, долг за проведённое лечение (если есть), «ознакомлен(а)» и подписи с датой.
 * Ассистенту — без денег: цены ему сервер не присылает, долг не запрашиваем.
 */
function PlanPrint({ patient, steps, onClose }: { patient: Patient; steps: Step[]; onClose: () => void }) {
  const me = useMe().data
  const [note, setNote] = useState('')
  const money = Boolean(me && !isAssistant(me))
  const prices = money && steps.some((s) => s.priceSom != null)
  const patientId = patient.id!
  const debts = useQuery({
    queryKey: ['debts', 'patient', patientId],
    queryFn: () => unwrap(api.GET('/api/appointments/debts', { params: { query: { patientId } } })),
    enabled: money,
    retry: false,
  })
  const debt = (debts.data ?? []).reduce((sum, d) => sum + (d.debtSom ?? 0), 0)
  const doctor = (me?.doctors ?? []).find((d) => d.id === me?.doctorId)?.fullName
  const stages = stagesOf(steps)
  const left = steps.filter((s) => !s.doneAt).reduce((sum, s) => sum + (s.priceSom ?? 0), 0)
  const all = steps.reduce((sum, s) => sum + (s.priceSom ?? 0), 0)
  // Сквозной номер строки через все этапы (не счётчиком в render: лист перерисовывается)
  const number = new Map(stages.flatMap((st) => st.items).map((s, i) => [s.id, i + 1]))
  return (
    <PrintSheet title="План лечения" onClose={onClose}
      tools={<textarea aria-label="Примечание на листе" rows={2} maxLength={1000} placeholder="Примечание — напечатается под планом"
        value={note} onChange={(e) => setNote(e.target.value)} />}>
      {() => (
        <>
          <h1>План лечения</h1>
          <dl>
            <dt>Пациент</dt><dd>{patient.fullName}</dd>
            {patient.birthDate && <><dt>Дата рождения</dt><dd>{patient.birthDate.split('-').reverse().join('.')}</dd></>}
            <dt>Дата</dt><dd>{docDate(new Date().toISOString())}</dd>
            <dt>Врач</dt><dd>{doctor ?? '________________________'}</dd>
          </dl>
          <table aria-label="Этапы плана" className="plan-table">
            <thead>
              <tr><th>№</th><th>Зуб</th><th>Что сделать</th>{prices && <th className="r">Цена</th>}<th>Статус</th></tr>
            </thead>
            {stages.map((st) => (
              <tbody key={st.stage}>
                {stages.length > 1 && (
                  <tr className="stage-row"><th colSpan={prices ? 5 : 4} scope="rowgroup">Этап {st.stage}</th></tr>
                )}
                {st.items.map((s) => (
                  <tr key={s.id}>
                    <td>{number.get(s.id)}</td>
                    <td>{s.tooth ?? '—'}</td>
                    <td>{s.title}</td>
                    {prices && <td className="r">{s.priceSom != null ? somText(s.priceSom) : ''}</td>}
                    <td>{s.doneAt ? `сделано ${docDate(s.doneAt)}` : 'в плане'}</td>
                  </tr>
                ))}
                {prices && stages.length > 1 && st.total > 0 && (
                  <tr className="subtotal"><td colSpan={3} className="r">Итого за этап {st.stage}</td><td className="r">{somText(st.total)}</td><td /></tr>
                )}
              </tbody>
            ))}
          </table>
          {prices && (
            <>
              <p className="total">Итого: {somText(all)}{left !== all ? ` · осталось: ${somText(left)}` : ''}</p>
              {left !== all && <p className="r">Уже выполнено на {somText(all - left)}</p>}
            </>
          )}
          {money && debt > 0 && <p className="r"><b>Осталось оплатить за проведённое лечение: {somText(debt)}</b></p>}
          {note.trim() && <p><b>Примечание:</b> {note.trim()}</p>}
          <p className="note">План может меняться по результатам лечения.{prices ? ' Цены — на дату плана.' : ''}</p>
          <p>С планом лечения{prices ? ' и его стоимостью' : ''} ознакомлен(а), согласен(на).</p>
          <div className="signatures">
            <span>Врач ____________________{doctor ? <small> {doctor}</small> : null}</span>
            <span>Пациент ____________________</span>
          </div>
          <p className="sign-date">Дата «____» ______________ 20____ г.</p>
        </>
      )}
    </PrintSheet>
  )
}
