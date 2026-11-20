import type { Schemas } from '../api/client'
import { shortDate } from '../lib/time'

/** «20 нояб» — когда пригласили (без года и времени). */
export function dayMonth(instant: string): string {
  return shortDate(instant, true).split(',')[0]!
}

/** «пригласили 20 нояб» — мелко под пунктом и в списке «Без бота»; не приглашали — undefined. */
export function invitedHint(at?: string | null): string | undefined {
  return at ? `пригласили ${dayMonth(at)}` : undefined
}

/** «42 % (120 из 285)» — доля пациентов в боте: шапка «Без бота» и плитка «Касса → Аналитика». */
export function coverageText(c: Schemas['BotCoverageControllerCoverage']): string {
  return `${c.percent} % (${c.inBot} из ${c.total})`
}
