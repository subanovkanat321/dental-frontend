import { useQuery } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '../api/client'
import { dentitionOf } from '../medical/dentition'
import { PlanFormula } from '../medical/PlanFormula'
import { TOOTH_STATES } from '../medical/toothStates'

type Step = Schemas['TreatmentStepView']
type Patient = Schemas['PatientView']

const TEXTS = {
  title: 'Зубная формула',
  planned: 'в плане лечения',
  plannedLabel: 'в плане',
  state: (s: keyof typeof TOOTH_STATES) => TOOTH_STATES[s][0],
}

/**
 * Зубная формула на листе плана (шаг 4А, опыт Dentist Plus): обе челюсти рисунком из карты зубов — состояние цветом
 * (кариес, пломба, коронка, имплант, удалён), зуб, у которого есть несделанный этап плана, — в пунктирной рамке.
 * Рисунок — общий с планом у пациента ({@link PlanFormula}); здесь — вся карта зубов, у пациента — только зубы плана.
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
  const planned = new Set(steps.filter((s) => !s.doneAt && s.tooth != null).map((s) => s.tooth!))
  return <PlanFormula dentition={dentitionOf(patient)} teeth={teeth.data} planned={planned} texts={TEXTS} />
}
