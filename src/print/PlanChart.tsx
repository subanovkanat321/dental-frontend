import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { dentitionOf } from '../medical/dentition'
import { ToothFormula } from '../medical/ToothFormula'
import { ToothFigure, ToothLegendItem } from '../medical/ToothGlyph'
import { TOOTH_STATES, type ToothState } from '../medical/toothStates'

type Step = Schemas['TreatmentStepView']
type Patient = Schemas['PatientView']

/**
 * Зубная формула на листе плана (шаг 4А, опыт Dentist Plus): обе челюсти рисунком из карты зубов — состояние цветом
 * (кариес, пломба, коронка, имплант, удалён), зуб, у которого есть несделанный этап плана, — в пунктирной рамке.
 * Раскладка — та же, что в медкарте ({@link ToothFormula}): как смотрит врач, молочные — на местах преемников.
 * Карту не дали (нет доступа) — формулы нет, лист печатается без неё.
 */
export function PlanChart({ patient, steps }: { patient: Patient; steps: Step[] }) {
  const patientId = patient.id
  const teeth = useQuery({
    queryKey: ['teeth', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/teeth', { params: { path: { patientId } } })),
    retry: false,
  })
  if (!teeth.data) return null
  const byNumber = new Map(teeth.data.map((t) => [t.number, t]))
  const planned = new Set(steps.filter((s) => !s.doneAt && s.tooth != null).map((s) => s.tooth!))
  const used = [...new Set(teeth.data.map((t) => t.state).filter((s): s is ToothState => !!s && s !== 'HEALTHY'))]
  return (
    <section className="plan-chart" aria-label="Зубная формула">
      <ToothFormula className="plan-chart-formula" dentition={dentitionOf(patient)} teeth={teeth.data} render={(n) => {
        const t = byNumber.get(n)
        return (
          <span key={n} className={planned.has(n) ? 'tooth plan-chart-tooth planned' : 'tooth plan-chart-tooth'} data-state={t?.state ?? 'HEALTHY'}
            aria-label={`${n}${t?.state && t.state !== 'HEALTHY' ? ` · ${TOOTH_STATES[t.state][0]}` : ''}${planned.has(n) ? ' · в плане' : ''}`}>
            <ToothFigure number={n} state={t?.state} surfaces={t?.surfaces} />
          </span>
        )
      }} />
      <p className="plan-chart-legend">
        {used.map((s) => <ToothLegendItem key={s} state={s} label={TOOTH_STATES[s][0]} />)}
        {planned.size > 0 && <span className="plan-chart-key"><span className="plan-chart-box" aria-hidden="true" /> в плане лечения</span>}
      </p>
    </section>
  )
}
