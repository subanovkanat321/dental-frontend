import type { Schemas } from '../api/client'
import { TOOTH_STATES } from '../medical/toothStates'
import { renderSections } from './noteSections'

type Template = Schemas['VisitTemplatesView']

/** Коротко, что заполняет шаблон: первая строка текста, зубы, план, услуга. */
export function templateSummary(t: Template): string {
  const text = (t.note ?? renderSections(t.sections)).split('\n')[0]?.trim() ?? ''
  return [
    text.length > 60 ? `${text.slice(0, 60)}…` : text,
    t.toothState ? `зубы: ${TOOTH_STATES[t.toothState][0].toLowerCase()}` : '',
    t.plan?.length ? `план: ${t.plan.length}` : '',
    (t.serviceNames?.length ?? 0) > 1 ? `услуги: ${t.serviceNames!.join(', ')}` : t.serviceName ? `услуга: ${t.serviceName}` : '',
  ].filter(Boolean).join(' · ')
}

/** «36 37», «36, 37» → [36, 37]: двузначные номера по порядку, без повторов. */
export function parseTeeth(text: string): number[] {
  return [...new Set((text.match(/\d{2}/g) ?? []).map(Number))]
}

