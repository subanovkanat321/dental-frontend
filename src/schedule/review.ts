import type { Schemas } from '../api/client'
import type { Surface, ToothState } from '../medical/toothStates'
import { asSections, joinText, mergeSections, renderSections, type Sections } from './noteSections'

type Proposal = Schemas['VisitDictationProposal']

export type ToothRow = { on: boolean; tooth: string; state: ToothState; surfaces: Surface[]; note: string; was?: ToothState }
export type StepRow = { on: boolean; tooth: string; title: string }

/**
 * Экран «Проверьте» — общий у диктовки и шаблона приёма: изменения зубов, шаги плана, заметка (простая или
 * разделами), услуги приёма (только шаблон). Ничего не пишется без «Сохранить»; сохраняет один запрос
 * /dictation/apply — шаблон и диктовка ведут себя одинаково.
 */
export type Review = {
  teeth: ToothRow[]
  plan: StepRow[]
  /** Простая заметка (клиника без разделов) */
  note: string
  /** Заметка разделами (other — текст вне разделов); null — простая заметка */
  sections: Sections | null
  /** Услуги шаблона (шаг 5А): добавятся в приём, если их там ещё нет; зубы — выбранные перед шаблоном */
  services: { id: number; name: string; teeth: number[]; on: boolean }[]
  next: string | null
  ai: boolean
  problem?: string
  /** Откуда предложение: «Шаблон «Кариес»» — заголовок экрана */
  source?: string
}

/** Текущая заметка карточки: к ней добавится предложенное. */
export type CurrentNote = { note: string; sections: Sections | null; sectionsMode: boolean }

function nextText(next: Proposal['next']): string | null {
  if (!next) return null
  if (next.text) return next.text
  return next.inDays ? `через ${next.inDays} дн.` : null
}

/** Предложение (ИИ или шаблона) + то, что уже написано: разделы — к своим разделам, текст — строкой ниже. */
export function reviewOf(p: Proposal, current: CurrentNote, ai: boolean, source?: string): Review {
  const added = p.note ?? ''
  return {
    teeth: (p.teeth ?? []).map((t) => ({ on: true, tooth: String(t.tooth), state: t.state ?? 'HEALTHY', surfaces: t.surfaces ?? [], note: t.note ?? '', was: t.was })),
    plan: (p.plan ?? []).map((s) => ({ on: true, tooth: s.tooth != null ? String(s.tooth) : '', title: s.title ?? '' })),
    note: current.sectionsMode ? '' : joinText(joinText(current.note, added), renderSections(p.sections)),
    sections: current.sectionsMode
      ? mergeSections(asSections(current.note, current.sections), { ...(p.sections ?? {}), other: joinText(p.sections?.other, added) })
      : null,
    services: (p.services?.length ? p.services : p.service ? [p.service] : [])
      .map((x) => ({ id: x.id, name: x.name ?? '', teeth: x.teeth ?? [], on: true })),
    next: nextText(p.next),
    ai,
    source,
  }
}

