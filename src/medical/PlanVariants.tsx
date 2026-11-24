import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, ApiError, unwrap, type Schemas } from '../api/client'
import { ask } from '../lib/confirm'
import { chosenText, MAX_VARIANTS, variantsKey } from '../lib/planVariants'
import { somText } from '../lib/time'
import { StepPriceText } from './StepPrice'
import { totalsOf } from './stepDiscount'

type Variants = Schemas['PlanVariantsVariants']
type Variant = Schemas['PlanVariantsVariantView']

/**
 * Варианты плана (V254) над этапами: вкладки «Вариант 1 · 63 000 сом», «Вариант 2 — Эконом · 33 000 сом» (на телефоне —
 * сегменты, на компьютере ниже ещё сравнение столбцами), действия с выбранным: название, копия, удалить, «Пациент выбрал».
 * Пациент выбрал — остальные свёрнуты в «Другие варианты». Права и итоги — на сервере; здесь только показ.
 *
 * @param selected открытый вариант (его этапы ниже); null — основной
 */
export function PlanVariantBar({ patientId, data, selected, onSelect, readOnly }: {
  patientId: number
  data: Variants
  selected: Variant
  onSelect: (id: number | null) => void
  readOnly: boolean
}) {
  const client = useQueryClient()
  const variants = data.variants ?? []
  const chosen = variants.find((v) => v.chosenAt)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const saved = (fresh: Variants) => {
    client.setQueryData(variantsKey(patientId), fresh)
    // Основной вариант мог смениться — план, статус и «Что сделали сегодня?» перечитать
    void client.invalidateQueries({ queryKey: ['plan', patientId] })
  }
  const path = { patientId, variantId: selected.id ?? 0 }
  const copy = useMutation<Variants, ApiError>({
    mutationFn: () => unwrap(api.POST('/api/patients/{patientId}/plan/variants', {
      params: { path: { patientId } }, body: { copyFrom: selected.id ?? undefined },
    })),
    onSuccess: (fresh) => {
      saved(fresh)
      onSelect(fresh.variants?.[fresh.variants.length - 1]?.id ?? null)
    },
  })
  const rename = useMutation<Variants, ApiError>({
    mutationFn: () => unwrap(api.PUT('/api/patients/{patientId}/plan/variants/{variantId}', { params: { path }, body: { name: name.trim() } })),
    onSuccess: (fresh) => { saved(fresh); setRenaming(false) },
  })
  const remove = useMutation<Variants, ApiError>({
    mutationFn: () => unwrap(api.DELETE('/api/patients/{patientId}/plan/variants/{variantId}', { params: { path } })),
    onSuccess: (fresh) => { saved(fresh); onSelect(null) },
  })
  const choose = useMutation<Variants, ApiError, number>({
    mutationFn: (variantId) => unwrap(api.POST('/api/patients/{patientId}/plan/variants/{variantId}/choose', { params: { path: { patientId, variantId } } })),
    onSuccess: (fresh) => { saved(fresh); onSelect(null) },
  })
  const error = copy.error ?? rename.error ?? remove.error ?? choose.error
  const canChoose = !readOnly && selected.id != null && !selected.chosenAt && (selected.current || data.switchable)
  // Выбрал — вкладки только у выбранного и открытого; остальные — в «Другие варианты»
  const tabs = chosen ? variants.filter((v) => v.chosenAt || v.id === selected.id) : variants
  const others = chosen ? variants.filter((v) => !v.chosenAt) : []

  return (
    <div className="plan-variants">
      <div className="segments wrap plan-variant-tabs" role="tablist" aria-label="Варианты плана">
        {tabs.map((v) => (
          <button key={v.id ?? 0} type="button" role="tab" aria-selected={v.id === selected.id} onClick={() => onSelect(v.id ?? null)}>
            <span>{v.label}</span>
            {v.totalSom != null && <span className="num plan-variant-total">{somText(v.totalSom)}</span>}
            {v.chosenAt && <span className="chip small s-ok">✅ выбран</span>}
          </button>
        ))}
        {!readOnly && variants.length < MAX_VARIANTS && (
          <button type="button" className="plan-variant-add" disabled={copy.isPending} onClick={() => copy.mutate()}
            title="Копия открытого варианта — поменяйте в ней материалы или способ лечения">⧉ Ещё вариант</button>
        )}
      </div>
      {!chosen && <VariantCompare variants={variants} selected={selected} onSelect={onSelect} />}
      {chosen && !selected.chosenAt && <p className="hint small" role="status">Этот вариант пациент не выбрал — он в «Других вариантах».</p>}
      {selected.chosenAt && <p className="tone-ok small plan-variant-chosen">✅ {selected.label} — {chosenText(selected)}</p>}
      {!readOnly && (
        <div className="actions plan-variant-actions">
          {canChoose && (
            <button type="button" className="btn primary" disabled={choose.isPending} onClick={() => choose.mutate(selected.id!)}>✅ Пациент выбрал этот вариант</button>
          )}
          {!selected.current && !data.switchable && !selected.chosenAt && (
            <span className="hint small">Лечение по выбранному варианту уже началось — переключиться нельзя.</span>
          )}
          <button type="button" className="btn" onClick={() => { setName(selected.name ?? ''); setRenaming(!renaming) }}>✏️ Название</button>
          <button type="button" className="btn ghost" disabled={remove.isPending}
            onClick={() => void ask(`Удалить «${selected.label}» со всеми его этапами?`).then((ok) => ok && remove.mutate())}>🗑 Удалить вариант</button>
        </div>
      )}
      {renaming && (
        <form className="plan-variant-rename" aria-label="Название варианта" onSubmit={(e) => { e.preventDefault(); rename.mutate() }}>
          <input aria-label="Название варианта" placeholder="Например: Эконом, Премиум" maxLength={40} value={name} autoFocus
            onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn primary" disabled={rename.isPending}>Сохранить</button>
          <button type="button" className="btn ghost" onClick={() => setRenaming(false)}>Отмена</button>
        </form>
      )}
      {others.length > 0 && (
        <details className="plan-variant-others">
          <summary>Другие варианты ({others.length})</summary>
          <ul>
            {others.map((v) => (
              <li key={v.id}>
                <button type="button" className="row-link" onClick={() => onSelect(v.id ?? null)}>{v.label}</button>
                {v.totalSom != null && <span className="num nowrap"> · {somText(v.totalSom)}</span>}
                {!readOnly && data.switchable && (
                  <button type="button" className="btn small" disabled={choose.isPending} onClick={() => choose.mutate(v.id!)}>Пациент выбрал этот</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="error" role="alert">{Object.values(error.fieldErrors)[0] ?? error.message}</p>}
    </div>
  )
}

/** Сравнение вариантов столбцами (компьютер; на телефоне CSS прячет — там вкладки): этапы, цены и итог каждого. */
function VariantCompare({ variants, selected, onSelect }: { variants: Variant[]; selected: Variant; onSelect: (id: number | null) => void }) {
  return (
    <div className="plan-compare" aria-label="Сравнение вариантов" style={{ ['--cols' as string]: variants.length }}>
      {variants.map((v) => {
        const open = (v.steps ?? []).filter((s) => !s.doneAt)
        return (
          <section key={v.id ?? 0} className={v.id === selected.id ? 'plan-compare-col active' : 'plan-compare-col'} aria-label={v.label}>
            <button type="button" className="row-link" onClick={() => onSelect(v.id ?? null)}>{v.label}</button>
            <ul>
              {open.map((s) => (
                <li key={s.id}><span>{s.tooth ? <b className="num">{s.tooth} · </b> : null}{s.title}</span>
                  <span className="num nowrap"><StepPriceText step={s} /></span></li>
              ))}
              {open.length === 0 && <li className="hint">Этапов нет</li>}
            </ul>
            {v.totalSom != null && (
              <p className="plan-compare-total">Итого: <b className="num">{somText(v.leftSom ?? v.totalSom)}</b>
                {totalsOf(open).off > 0 && <span className="hint small"> · скидка −{somText(totalsOf(open).off)}</span>}</p>
            )}
          </section>
        )
      })}
    </div>
  )
}
