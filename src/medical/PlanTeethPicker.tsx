import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, unwrap, type Schemas } from '../api/client'
import { DentitionSwitch } from './DentitionSwitch'
import { ageYears, dentitionOf, type Dentition } from './dentition'
import { ToothFigure } from './ToothGlyph'
import { ToothFormula } from './ToothFormula'
import { stateText } from './toothStates'

type Patient = Schemas['PatientView']

/** «Зубы: постоянные ▾» — коротко о прикусе над формулой плана. */
const DENTITION_SHORT: Record<Dentition, string> = { PERMANENT: 'постоянные', PRIMARY: 'молочные', MIXED: 'сменный прикус' }
type Step = Schemas['TreatmentStepView']

/**
 * Зубная формула в плане лечения — главный способ добавить работу: нажал один или несколько зубов → «Что сделать →».
 * Зубы, у которых в этом варианте плана есть несделанный этап, подсвечены (рамка и число этапов). Состояние зубов —
 * с карты (тот же кэш ['teeth', id], что у карты зубов). Прикус — как на карте; переключатель меняет только вид здесь
 * (сохраняет прикус карта зубов). Он нужен редко (дети), поэтому свёрнут в одну строку «Зубы: постоянные ▾», и только
 * когда может понадобиться: ребёнок, возраст неизвестен или прикус уже не постоянный. Взрослому — не показываем.
 *
 * @param picked выбранные зубы (сверху держит план: по ним подсвечены строки и открывается лист «Что сделать»)
 */
export function PlanTeethPicker({ patient, steps, picked, onPick, onWhat, onGeneral, onTemplate, readOnly }: {
  patient: Patient
  steps: Step[]
  picked: number[]
  onPick: (teeth: number[]) => void
  onWhat: () => void
  onGeneral: () => void
  /** «📄 Шаблон» выбранным зубам */
  onTemplate: () => void
  readOnly: boolean
}) {
  const patientId = patient.id
  const teeth = useQuery({
    queryKey: ['teeth', patientId],
    queryFn: () => unwrap(api.GET('/api/patients/{patientId}/teeth', { params: { path: { patientId } } })),
    retry: false,
  })
  const [shown, setShown] = useState<Dentition | null>(null)
  const [switching, setSwitching] = useState(false)
  const dentition = shown ?? dentitionOf(patient)
  const years = ageYears(patient.birthDate)
  const dentitionMatters = dentition !== 'PERMANENT' || shown != null || patient.dentition != null || years == null || years < 18
  const byNumber = new Map((teeth.data ?? []).map((t) => [t.number, t]))
  const planned = new Map<number, number>()
  for (const s of steps) {
    if (!s.doneAt && s.tooth != null) planned.set(s.tooth, (planned.get(s.tooth) ?? 0) + 1)
  }
  const toggle = (n: number) => onPick(picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n])
  const sorted = [...picked].sort((a, b) => a - b)

  const tooth = (n: number) => {
    const t = byNumber.get(n)
    const state = t?.state ?? 'HEALTHY'
    const count = planned.get(n) ?? 0
    const isPicked = picked.includes(n)
    const label = `Зуб ${n}: ${stateText(n, state, t?.surfaces)}${count ? `, в плане: ${count}` : ''}`
    return (
      <button key={n} type="button" className={`tooth${count ? ' planned' : ''}${isPicked ? ' picked' : ''}`} data-state={state}
        aria-label={label} aria-pressed={isPicked} title={label} disabled={readOnly && !count} onClick={() => toggle(n)}>
        {isPicked && <span aria-hidden="true" className="tooth-check">✓</span>}
        <ToothFigure number={n} state={state} surfaces={t?.surfaces} ring />
        {count > 0 && <span aria-hidden="true" className="tooth-plan-count">{count}</span>}
      </button>
    )
  }

  return (
    <div className="plan-teeth" aria-label="Зубы плана">
      {dentitionMatters && (
        <button type="button" className="link small dentition-toggle" aria-expanded={switching} onClick={() => setSwitching(!switching)}>
          Зубы: {DENTITION_SHORT[dentition]} <span aria-hidden="true">{switching ? '▴' : '▾'}</span>
        </button>
      )}
      {dentitionMatters && switching && (
        <DentitionSwitch value={dentition} saved={shown ?? patient.dentition ?? null} birthDate={patient.birthDate}
          onChange={(d) => { setShown(d); setSwitching(false) }} />
      )}
      <ToothFormula render={tooth} dentition={dentition} teeth={teeth.data} />
      <div className={picked.length ? 'plan-teeth-bar active' : 'plan-teeth-bar'} aria-live="polite">
        {picked.length === 0 ? (
          <span className="hint small">{readOnly ? 'Нажмите зуб в рамке — внизу его этапы.' : 'Нажмите зубы, которые лечить, — один или несколько.'}</span>
        ) : (
          <span className="plan-teeth-picked">Выбрано: <b className="num">{sorted.join(', ')}</b></span>
        )}
        <span className="plan-teeth-actions">
          {!readOnly && picked.length > 0 && <button type="button" className="btn primary" onClick={onWhat}>Что сделать: {sorted.join(', ')} →</button>}
          {!readOnly && picked.length > 0 && <button type="button" className="btn" onClick={onTemplate} title="Шаблон плана этим зубам">📄 Шаблон</button>}
          {picked.length > 0 && <button type="button" className="btn ghost" onClick={() => onPick([])}>Снять выбор</button>}
          {!readOnly && picked.length === 0 && (
            <button type="button" className="btn" onClick={onGeneral} title="Чистка, профгигиена, консультация, отбеливание, снимок">＋ Без зуба</button>
          )}
        </span>
      </div>
    </div>
  )
}
