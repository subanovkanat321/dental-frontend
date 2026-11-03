import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { useMe } from '../api/me'
import { isAssistant } from '../lib/roles'
import { somText } from '../lib/time'
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
          <button type="button" className="btn" onClick={() => setPrinting(true)} aria-label="Печать: план лечения">🖨 Печать</button>
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
      <DocActions label="план лечения" phone={patient.phone} message={message.data}
        send={() => unwrap(api.POST('/api/patients/{patientId}/plan/send', { params: { path: { patientId } } }))}
        onPrint={() => setPrinting(true)} />
      {printing && <PlanPrint patient={patient} steps={steps} onClose={() => setPrinting(false)} />}
    </>
  )
}

function PlanPrint({ patient, steps, onClose }: { patient: Patient; steps: Step[]; onClose: () => void }) {
  const me = useMe().data
  const [note, setNote] = useState('')
  const prices = Boolean(me && !isAssistant(me)) && steps.some((s) => s.priceSom != null)
  const doctor = (me?.doctors ?? []).find((d) => d.id === me?.doctorId)?.fullName
  const total = steps.filter((s) => !s.doneAt).reduce((sum, s) => sum + (s.priceSom ?? 0), 0)
  const all = steps.reduce((sum, s) => sum + (s.priceSom ?? 0), 0)
  return (
    <PrintSheet title="План лечения" onClose={onClose}
      tools={<textarea aria-label="Примечание на листе" rows={2} maxLength={1000} placeholder="Примечание — напечатается под планом"
        value={note} onChange={(e) => setNote(e.target.value)} />}>
      {() => (
        <>
          <h1>План лечения</h1>
          <dl>
            <dt>Пациент</dt><dd>{patient.fullName}</dd>
            <dt>Дата</dt><dd>{docDate(new Date().toISOString())}</dd>
            <dt>Врач</dt><dd>{doctor ?? '________________________'}</dd>
          </dl>
          <table aria-label="Этапы плана">
            <thead>
              <tr><th>№</th><th>Зуб</th><th>Что сделать</th>{prices && <th className="r">Цена</th>}<th>Статус</th></tr>
            </thead>
            <tbody>
              {steps.map((s, i) => (
                <tr key={s.id}>
                  <td>{i + 1}</td>
                  <td>{s.tooth ?? '—'}</td>
                  <td>{s.title}</td>
                  {prices && <td className="r">{s.priceSom != null ? somText(s.priceSom) : ''}</td>}
                  <td>{s.doneAt ? `сделано ${docDate(s.doneAt)}` : 'в плане'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {prices && (
            <p className="total">Итого: {somText(all)}{total !== all ? ` · осталось: ${somText(total)}` : ''}</p>
          )}
          {note.trim() && <p><b>Примечание:</b> {note.trim()}</p>}
          <div className="signatures">
            <span>Врач ____________________</span>
            <span>Пациент ____________________</span>
          </div>
          <p className="note">План может меняться по результатам лечения.</p>
        </>
      )}
    </PrintSheet>
  )
}
