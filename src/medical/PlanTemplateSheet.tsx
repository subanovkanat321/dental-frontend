import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { useMe } from '../api/me'
import { Sheet } from '../layout/Sheet'
import { Select } from '../layout/Select'
import { parseTeeth } from '../lib/planSteps'
import { defaultStart, STARTERS, starterSteps, templateStages } from '../lib/planTemplates'
import { somText } from '../lib/time'

type Step = Schemas['TreatmentStepView']
type Template = Schemas['PlanTemplatesView']

const STAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9]

/**
 * «📄 Из шаблона» в плане лечения (шаг 4А): выбрать шаблон плана — свой или общий клиники, — зубы (если в шаблоне есть
 * шаги «каждому зубу») и с какого этапа начать → «Добавить в план». Цены ставит сервер — из прайса на сегодня; здесь —
 * только подсказка, сколько выйдет. Шаблонов нет — «Добавить готовые» («Имплант под ключ», «Санация», «Брекеты»).
 */
export function PlanTemplateSheet({ patientId, steps, onClose, onAdded }: {
  patientId: number
  steps: Step[]
  onClose: () => void
  onAdded: (steps: Step[]) => void
}) {
  const list = useQuery({ queryKey: ['plan-templates'], queryFn: () => unwrap(api.GET('/api/plan-templates')) })
  const [picked, setPicked] = useState<Template | null>(null)
  return (
    <Sheet label="Шаблон плана" title={picked ? picked.title : 'Шаблон плана'} onClose={onClose} wide>
      {picked ? <ApplyTemplate patientId={patientId} steps={steps} template={picked} onBack={() => setPicked(null)} onAdded={onAdded} />
        : (
          <>
            {list.error && <p className="error" role="alert">{list.error.message}</p>}
            {list.isSuccess && list.data.length === 0 && <NoTemplates />}
            <ul className="template-list" aria-label="Шаблоны плана">
              {(list.data ?? []).map((t) => (
                <li key={t.id}>
                  <button type="button" className="template-item" onClick={() => setPicked(t)}>
                    <b>{t.title}</b>{t.shared ? <span className="hint small"> · общий</span> : null}
                    <span className="hint small">{t.steps.map((s) => s.title).join(' → ')}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="hint small">Свои и общие шаблоны — «Настройки» → «Приём» → «Шаблоны плана».</p>
          </>
        )}
    </Sheet>
  )
}

/** Шаблонов ещё нет — завести три готовых одной кнопкой (руководителю — общие, врачу — свои). */
export function NoTemplates() {
  const me = useMe().data
  const client = useQueryClient()
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')), staleTime: 5 * 60_000 })
  const shared = Boolean(me?.admin)
  const add = useMutation<unknown, ApiError>({
    mutationFn: async () => {
      for (const s of STARTERS) {
        await unwrap(api.POST('/api/plan-templates', { body: { title: s.title, steps: starterSteps(s, services.data ?? []), shared } }))
      }
    },
    onSettled: () => void client.invalidateQueries({ queryKey: ['plan-templates'] }),
  })
  return (
    <div className="plan-templates-empty">
      <p className="hint">Шаблонов плана пока нет. Добавьте готовые — «Имплант под ключ», «Санация», «Ортодонтия — брекеты» —
        и поправьте под себя: услуги подберутся из вашего прайса по названию.</p>
      <button type="button" className="btn" disabled={add.isPending || !services.isSuccess} onClick={() => add.mutate()}>
        ＋ Добавить готовые{shared ? ' (общие для клиники)' : ''}
      </button>
      {add.error && <p className="error small" role="alert">{add.error.message}</p>}
    </div>
  )
}

function ApplyTemplate({ patientId, steps, template: t, onBack, onAdded }: {
  patientId: number; steps: Step[]; template: Template; onBack: () => void; onAdded: (steps: Step[]) => void
}) {
  const [teeth, setTeeth] = useState('')
  const [start, setStart] = useState(() => String(defaultStart(steps, t)))
  const numbers = parseTeeth(teeth)
  const apply = useMutation<Step[], ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patients/{patientId}/plan/templates/{templateId}', {
      params: { path: { patientId, templateId: t.id } }, body: { teeth: numbers, startStage: Number(start) },
    })),
    onSuccess: onAdded,
  })
  const perTooth = Math.max(numbers.length, 1)
  const total = t.steps.reduce((sum, s) => sum + (s.priceSom ?? 0) * (s.perTooth ? perTooth : 1), 0)
  const missingTeeth = t.usesTeeth && numbers.length === 0
  const shift = Number(start) - 1
  return (
    <form className="plan-template-apply" aria-label={`Применить шаблон «${t.title}»`}
      onSubmit={(e) => { e.preventDefault(); if (!missingTeeth) apply.mutate() }}>
      <ol className="plan-template-steps">
        {t.steps.map((s, i) => (
          <li key={i}>
            <span className="hint small">Этап {s.stage + shift}</span> {s.title}
            {s.perTooth && <span className="hint small"> · каждому зубу</span>}
            {s.priceSom != null && <span className="nowrap num"> · {somText(s.priceSom)}</span>}
          </li>
        ))}
      </ol>
      <div className="row">
        {t.usesTeeth && (
          <label className="field"><span>Зубы</span>
            <input aria-label="Зубы для шаблона" inputMode="numeric" placeholder="например, 36, 46" value={teeth} autoFocus
              onChange={(e) => setTeeth(e.target.value)} />
          </label>
        )}
        <label className="field"><span>Начать с этапа</span>
          <Select aria-label="Начать с этапа" value={start} onChange={(e) => setStart(e.target.value)}>
            {STAGES.filter((n) => n - 1 + templateStages(t) <= 9).map((n) => <option key={n} value={String(n)}>Этап {n}</option>)}
          </Select>
        </label>
      </div>
      {total > 0 && <p className="hint small">Примерно {somText(total)} по прайсу — точные цены поставит сервер.</p>}
      {missingTeeth && teeth.trim() === '' && <p className="hint small">Впишите номера зубов — шаги «каждому зубу» добавятся на каждый.</p>}
      {apply.error && <p className="error small" role="alert">{Object.values(apply.error.fieldErrors)[0] ?? apply.error.message}</p>}
      <div className="actions">
        <button type="submit" className="btn primary" disabled={apply.isPending || missingTeeth}>Добавить в план</button>
        <button type="button" className="btn ghost" onClick={onBack}>‹ Другой шаблон</button>
      </div>
    </form>
  )
}
