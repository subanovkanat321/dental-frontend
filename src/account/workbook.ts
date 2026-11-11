import type { Schemas } from '../api/client'

type Sheet = Schemas['WorkbookImportSheetReport']

/** Что на листе: «248 пациентов» — слово для числа (1 пациент, 2 пациента, 5 пациентов). */
const WORDS: Record<NonNullable<Sheet['kind']>, [string, string, string]> = {
  PATIENTS: ['пациента', 'пациентов', 'пациента'],
  SERVICES: ['услуги', 'услуг', 'услугу'],
  STAFF: ['сотрудника', 'сотрудников', 'сотрудника'],
  SUPPLY: ['материала', 'материалов', 'материал'],
  APPOINTMENTS: ['записи', 'записей', 'запись'],
  DEBTS: ['долга', 'долгов', 'долг'],
}

/** «35 услуг», «1 услугу», «2 услуги» — после «добавим». */
export function counted(n: number, kind: NonNullable<Sheet['kind']>): string {
  const [few, many, one] = WORDS[kind]
  const tens = n % 100
  const last = n % 10
  const word = tens >= 11 && tens <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many
  return `${n} ${word}`
}

