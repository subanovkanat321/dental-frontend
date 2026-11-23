import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { Sheet } from '../layout/Sheet'
import { Select } from '../layout/Select'
import { GENERAL, LAST, lastStage } from '../lib/planVariants'
import { somText } from '../lib/time'

type Step = Schemas['TreatmentStepView']
type Service = Schemas['ServiceTypeView']

/** Этапы лечения в форме: 1 — сначала… (сервер принимает 1–9; больше пяти не бывает) и «В конце плана». */
const STAGES = [1, 2, 3, 4, 5]

const FREQUENT_KEY = 'tish.plan.frequent'

/** Сколько раз этот компьютер выбирал услугу в плане — частые сверху. Только id услуг прайса, без данных пациентов. */
function frequent(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FREQUENT_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function remember(serviceId: number) {
  try {
    const counts = frequent()
    counts[serviceId] = (counts[serviceId] ?? 0) + 1
    localStorage.setItem(FREQUENT_KEY, JSON.stringify(counts))
  } catch {
    // Нет хранилища (приватный режим) — просто без «частых»
  }
}

/**
 * «Что сделать: 16, 17» — лист добавления в план с зубов (или «Без зуба»: чистка, консультация). Услуга из прайса — поиск,
 * частые сверху; без зуба — сначала быстрые кнопки процедур на весь рот. Выбрал — название и цена (за зуб) подставились,
 * цену можно поправить; или вписать своё. Несколько зубов — по этапу на каждый (один запрос, всё или ничего). Цену сервер
 * сохраняет как подсказку, итог считает сам.
 *
 * @param teeth выбранные зубы; пусто — этап на весь рот
 * @param variantId вариант плана (V254); нет — основной
 */
export function PlanStepSheet({ patientId, teeth, steps, variantId, onClose, onAdded }: {
  patientId: number
  teeth: number[]
  steps: Step[]
  variantId?: number
  onClose: () => void
  onAdded: (steps: Step[]) => void
}) {
  const general = teeth.length === 0
  const services = useQuery({ queryKey: ['service-types'], queryFn: () => unwrap(api.GET('/api/service-types')) })
  const active = (services.data ?? []).filter((x) => x.active)
  const [query, setQuery] = useState('')
  const [service, setService] = useState<Service | null>(null)
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
  const [stage, setStage] = useState(general ? 'end' : '1')
  const [missing, setMissing] = useState(false)
  const counts = frequent()
  const q = query.trim().toLowerCase()
  const sorted = [...active].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
  const quick = general ? sorted.filter((x) => GENERAL.test(x.name ?? '')).slice(0, 8) : sorted.filter((x) => counts[x.id]).slice(0, 6)
  const found = q ? sorted.filter((x) => (x.name ?? '').toLowerCase().includes(q)).slice(0, 12) : []
  const pick = (x: Service) => {
    setService(x)
    setTitle(x.name ?? '')
    setPrice(x.priceSom != null ? String(x.priceSom) : '')
    setQuery('')
    setMissing(false)
    if (general) setStage(LAST.test(x.name ?? '') ? 'end' : '1')
  }
  const stageNumber = stage === 'end' ? lastStage(steps) : Number(stage)
  const add = useMutation<Step[], ApiError>({
    mutationFn: () => {
      const body = {
        title: title.trim(), priceSom: price ? Number(price) : undefined, stage: stageNumber, serviceTypeId: service?.id,
      }
      const query = variantId != null ? { variantId } : undefined
      return teeth.length > 1
        ? unwrap(api.POST('/api/patients/{patientId}/plan/batch', { params: { path: { patientId }, query }, body: { ...body, teeth } }))
        : unwrap(api.POST('/api/patients/{patientId}/plan', { params: { path: { patientId }, query }, body: { ...body, tooth: teeth[0] } }))
    },
    onSuccess: (fresh) => {
      if (service) remember(service.id)
      onAdded(fresh)
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (title.trim()) add.mutate()
    else setMissing(true)
  }
  const each = price ? Number(price) : 0
  const already = steps.filter((s) => !s.doneAt && s.tooth != null && teeth.includes(s.tooth))
  const heading = general ? 'Без зуба: чистка, консультация…' : `Что сделать: ${teeth.join(', ')}`
  return (
    <Sheet label={heading} title={heading} onClose={onClose} wide>
      <form className="plan-step-sheet" aria-label="Новый этап" onSubmit={submit}>
        {already.length > 0 && (
          <div className="plan-step-already" role="note">
            <span className="hint small">Уже в плане:</span>
            <ul>{already.map((s) => <li key={s.id}><b className="num">{s.tooth}</b> · {s.title}{s.priceSom != null ? ` · ${somText(s.priceSom)}` : ''}</li>)}</ul>
          </div>
        )}
        {quick.length > 0 && !service && (
          <div className="chips-pick plan-step-quick" role="group" aria-label={general ? 'Частые процедуры без зуба' : 'Частые услуги'}>
            {quick.map((x) => (
              <button key={x.id} type="button" className="chip" onClick={() => pick(x)}>
                {x.name}{x.priceSom != null ? <span className="hint"> · {somText(x.priceSom)}</span> : null}
              </button>
            ))}
          </div>
        )}
        {!service && active.length > 0 && (
          <div className="plan-step-search">
            <input type="search" aria-label="Найти услугу в прайсе" placeholder="🔍 Найти в прайсе: пломба, имплант…" value={query}
              onChange={(e) => setQuery(e.target.value)} />
            {found.length > 0 && (
              <ul className="plan-step-found" aria-label="Услуги прайса">
                {found.map((x) => (
                  <li key={x.id}>
                    <button type="button" className="row-link" onClick={() => pick(x)}>
                      <span>{x.name}</span><span className="num nowrap">{x.priceSom != null ? somText(x.priceSom) : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {q && found.length === 0 && <p className="hint small">В прайсе такого нет — впишите ниже своими словами.</p>}
          </div>
        )}
        {service && (
          <p className="plan-step-picked">
            Из прайса: <b>{service.name}</b>
            <button type="button" className="link small" onClick={() => setService(null)}>другая услуга</button>
          </p>
        )}
        <div className="plan-step-fields">
          <label className="field plan-step-title"><span>{service ? 'Название в плане' : 'Или опишите сами'}</span>
            <input aria-label="Что сделать" placeholder="Что сделать: пломба, коронка…" maxLength={200} value={title}
              onChange={(e) => { setTitle(e.target.value); setMissing(false) }} />
          </label>
          <label className="field"><span>{teeth.length > 1 ? 'Цена за зуб' : 'Цена'}</span>
            <input aria-label="Цена, сом" placeholder="сом" type="number" min={0} inputMode="numeric" value={price}
              onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="field"><span>Когда</span>
            <Select aria-label="Этап лечения" value={stage} onChange={(e) => setStage(e.target.value)}>
              {STAGES.map((n) => <option key={n} value={String(n)}>Этап {n}</option>)}
              <option value="end">В конце плана (этап {lastStage(steps)})</option>
            </Select>
          </label>
        </div>
        {teeth.length > 1 && each > 0 && (
          <p className="hint small num">{somText(each)} × {teeth.length} зуба = <b>{somText(each * teeth.length)}</b></p>
        )}
        {missing && <p className="error" role="alert">Впишите, что сделать, — или выберите услугу из прайса</p>}
        {add.error && <p className="error" role="alert">{Object.values(add.error.fieldErrors)[0] ?? add.error.message}</p>}
        <div className="actions">
          <button type="submit" className="btn primary" disabled={add.isPending}>＋ Добавить в план</button>
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
        </div>
      </form>
    </Sheet>
  )
}
