import type { Schemas } from '../api/client'
import type { Page } from '../lib/route'
import { isAssistant, seesAllMoney, seesOwnEarnings } from '../lib/roles'
import { CLINIC_ITEMS, SETTINGS_GROUPS } from '../settings/items'

type Me = Schemas['BookingViewsMe']

/**
 * Подраздел в меню: адрес (#/раздел/key), подпись; у «Настроек» — группа. Эмодзи пунктов «Настроек» в
 * меню не ставим: значки меню без цвета (DESIGN.md → Colors), эмодзи — только в списке на главной «Настроек».
 */
export type Sub = { key: string; title: string; group?: string }

/** Числа у подразделов («Вопросы» — ждут ответа, «Лист ожидания» — сколько ждут). */
export type Counts = Partial<Record<string, number>>

/** Заметное число (бирюзовое) — ждёт действия; остальные — серым. */
export const LOUD: ReadonlySet<string> = new Set(['patients/questions'])

/**
 * Подразделы раздела — те же, что были вкладками сверху, по тем же правам (сервер всё равно
 * проверяет сам). Первый — подраздел по умолчанию. Пусто — у раздела подразделов нет.
 */
export function subsOf(page: Page, me: Me): Sub[] {
  switch (page) {
    case 'patients':
      // «Позвать снова» — деньги на столе и приглашения; ассистенту (денег не видит) — прежний «Профосмотр»
      return [{ key: 'all', title: 'Все' }, { key: 'booked', title: 'Записаны' }, { key: 'waitlist', title: 'Лист ожидания' },
        isAssistant(me) ? { key: 'recall', title: 'Профосмотр' } : { key: 'comeback', title: 'Позвать снова' },
        { key: 'questions', title: 'Вопросы' }]
    case 'cash': {
      // Без денег (регистратура без кресла) у «Кассы» один экран — «К оплате на кассе»
      if (!seesAllMoney(me) && me.doctorId == null) return []
      const subs: Sub[] = [{ key: 'money', title: 'Деньги' }, { key: 'earnings', title: 'Мой заработок' }, { key: 'analytics', title: 'Аналитика' },
        { key: 'expenses', title: 'Расходы' }, { key: 'debtors', title: 'Должники' }, { key: 'salary', title: 'Зарплата' },
        { key: 'stats', title: 'Статистика' }, { key: 'report', title: 'Отчёт' }]
      // «Мой заработок» — только у врача со своим креслом
      return subs.filter((s) => s.key !== 'earnings' || seesOwnEarnings(me))
    }
    case 'stock':
      // «Расходы на склад» (покупки по месяцам) — руководителю; остальным — только материалы
      return me.admin ? [{ key: 'materials', title: 'Материалы' }, { key: 'spending', title: 'Расходы на склад' }] : []
    case 'platform':
      // «Аналитика», «Финансы» и всё, что после «Опросов», — только владелец (сервер тоже: менеджеру 403)
      return [{ key: 'clinics', title: 'Клиники' },
        ...(me.owner ? [{ key: 'analytics', title: 'Аналитика' }, { key: 'finance', title: 'Финансы' }] : []),
        { key: 'surveys', title: 'Опросы' },
        ...(me.owner ? [['tickets', 'Обращения'], ['outreach', 'Написать клиникам'], ['broadcast', 'Сообщение клиникам'], ['agreements', 'Договор'],
          ['tariffs', 'Тарифы'], ['content', 'Контент'], ['materials', 'Материалы'], ['ai', 'Расход ИИ'], ['health', 'Здоровье'], ['settings', 'Настройки']]
          .map(([key, title]) => ({ key: key!, title: title! })) : [])]
    case 'clinic':
      // «Клиника» (с 2026-11-10 — раздел меню): о клинике, персонал, услуги, рабочее время, кресла
      return CLINIC_ITEMS.filter((i) => !i.hidden && i.show(me)).map((i) => ({ key: i.key, title: i.title }))
    case 'settings':
      // Пусто (у роли нет ни одного пункта) — раздела «Настройки» в меню нет (Shell)
      return SETTINGS_GROUPS.flatMap(([group, items]) => items
        .filter((i) => !i.hidden && i.show(me))
        .map((i) => ({ key: i.key, title: i.title, group })))
    default:
      return []
  }
}

/** Открытый подраздел: из адреса, если он есть в списке; иначе первый. */
export function currentSub(subs: Sub[], chosen: string | null | undefined): string | null {
  if (!subs.length) return null
  return subs.some((s) => s.key === chosen) ? chosen! : subs[0]!.key
}

/** Число у подраздела и сумма у свёрнутого раздела. */
export function countOf(counts: Counts, page: Page, key: string): number {
  return counts[`${page}/${key}`] ?? 0
}

export function sumOf(counts: Counts, page: Page, subs: Sub[]): { total: number; loud: boolean } {
  let total = 0
  let loud = false
  for (const s of subs) {
    const n = countOf(counts, page, s.key)
    total += n
    if (n > 0 && LOUD.has(`${page}/${s.key}`)) loud = true
  }
  return { total, loud }
}
