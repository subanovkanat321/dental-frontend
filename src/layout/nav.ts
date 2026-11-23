import type { Schemas } from '../api/client'
import type { Page } from '../lib/route'
import { isAssistant, seesAllMoney, seesOwnEarnings, seesOwnPurchases, seesRatings } from '../lib/roles'
import { CLINIC_ITEMS, SETTINGS_GROUPS } from '../settings/items'

type Me = Schemas['BookingViewsMe']

/**
 * Подраздел в меню: адрес (#/раздел/key), подпись; у «Настроек» — группа (подзаголовком в листе и панели).
 * Иконка — по разделу и ключу (layout/subIcons.tsx), в оттенке раздела.
 */
export type Sub = { key: string; title: string; group?: string; hint?: string }

/**
 * Короткая подсказка под названием подраздела в листе из нижнего меню (телефон, layout/NavSheet.tsx): что там,
 * в 2–5 словах. «Клиника» и «Настройки» берут свою из settings/items.
 */
const SUB_HINTS: Partial<Record<Page, Record<string, string>>> = {
  patients: {
    all: 'Вся база и поиск', booked: 'У кого есть запись', waitlist: 'Ждут свободного времени', leads: 'Позвонили, ещё не записаны', comeback: 'Кого пригласить снова',
    recall: 'Пора на профосмотр', dropped: 'Начали и пропали', groups: 'Позвать сразу многих', nobot: 'Пригласить в бот клиники', questions: 'Вопросы из бота',
    tasks: 'Позвонить, напомнить', ratings: 'Как оценили приёмы',
  },
  cash: {
    money: 'Оплаты и к оплате', day: 'Наличные за день', earnings: 'Мои приёмы и проценты', analytics: 'Выручка и средний чек',
    expenses: 'Аренда, закупки, прочее', debtors: 'Кто должен клинике', salary: 'Расчёт врачам и персоналу', stats: 'Услуги, врачи, источники',
    report: 'Итоги месяца',
  },
  stock: {
    materials: 'Остатки и списания', spending: 'Покупки по месяцам', purchase: 'Что купить у поставщиков', lab: 'Заказ-наряды технику',
  },
  platform: {
    clinics: 'Все клиники и тарифы', analytics: 'Рост и активность', finance: 'Оплаты клиник', feedback: 'Обращения и опросы',
    mailing: 'WhatsApp и бот руководителям', marketing: 'Контент-план и материалы', health: 'Ошибки и задачи сервера', ai: 'Сколько тратит ИИ',
    settings: 'Договор и тарифы',
  },
}

function withHints(page: Page, subs: Sub[]): Sub[] {
  const hints = SUB_HINTS[page]
  return hints ? subs.map((s) => (s.hint || !hints[s.key] ? s : { ...s, hint: hints[s.key] })) : subs
}

/** Числа у подразделов («Вопросы» — ждут ответа, «Лист ожидания» — сколько ждут, «Задачи» — мои просроченные). */
export type Counts = Partial<Record<string, number>>

/**
 * Заметное число — красная точка-счётчик (с 2026-11-20, шаг 6А; раньше бирюзовое): новое, что ждёт действия;
 * остальные — серым. Всегда заметные — вопросы пациентов, просроченные задачи и обращения (новые и «перезвонить» сегодня); «Лист ожидания» — когда в нём
 * есть новые с прошлого захода (Shell, layout/waitlistSeen.ts).
 */
export const LOUD: ReadonlySet<string> = new Set(['patients/questions', 'patients/tasks', 'patients/leads'])

/** Заметное ли число у подраздела: `loud` — набор от Shell (LOUD + то, что заметно сейчас), без него — LOUD. */
export function isLoud(loud: ReadonlySet<string> | undefined, page: Page, key: string): boolean {
  return (loud ?? LOUD).has(`${page}/${key}`)
}

/** «Склад → Заказ» — список к закупке у поставщиков; «Склад → Лаборатория» — заказ-наряды технику. */
const PURCHASE_SUB: Sub = { key: 'purchase', title: 'Заказ' }
const LAB_SUB: Sub = { key: 'lab', title: 'Лаборатория' }

/**
 * Подразделы раздела — те же, что были вкладками сверху, по тем же правам (сервер всё равно
 * проверяет сам). Первый — подраздел по умолчанию. Пусто — у раздела подразделов нет.
 */
export function subsOf(page: Page, me: Me): Sub[] {
  return withHints(page, rawSubsOf(page, me))
}

function rawSubsOf(page: Page, me: Me): Sub[] {
  switch (page) {
    case 'patients':
      // «Позвать снова» — деньги на столе и приглашения; «Бросили лечение» — кто начал или согласился и пропал; ассистенту (денег не видит) — прежний «Профосмотр»
      // «Оценки» (2026-11-19) — в конце: смотрят реже, чем записывают и отвечают; кто чьи оценки видит — lib/roles
      return [{ key: 'all', title: 'Все' }, { key: 'booked', title: 'Записаны' }, { key: 'waitlist', title: 'Лист ожидания' },
        // «Обращения» (шаг 8Б) — кто позвонил или написал, а записи ещё нет; ассистенту нет (сервер — 403)
        ...(isAssistant(me) ? [] : [{ key: 'leads', title: 'Обращения' }]),
        isAssistant(me) ? { key: 'recall', title: 'Профосмотр' } : { key: 'comeback', title: 'Позвать снова' },
        // «Бросили лечение» (волна 1, часть B) — рядом с «Позвать снова»; ассистенту нет (в списке суммы, сервер — 403)
        ...(isAssistant(me) ? [] : [{ key: 'dropped', title: 'Бросили лечение' }]),
        // «Группы» (шаг 9А) — готовые и свои группы: задачи на обзвон или сообщение сразу многим; ассистенту нет (сервер — 403)
        ...(isAssistant(me) ? [] : [{ key: 'groups', title: 'Группы' }]),
        // «Без бота» (2026-11-20) — кого пригласить в бот клиники: напоминания станут бесплатными
        { key: 'nobot', title: 'Без бота' },
        { key: 'questions', title: 'Вопросы' }, { key: 'tasks', title: 'Задачи' },
        ...(seesRatings(me) ? [{ key: 'ratings', title: 'Оценки' }] : [])]
    case 'cash': {
      // Без денег (регистратура без кресла) у «Кассы» один экран — «К оплате на кассе»
      if (!seesAllMoney(me) && me.doctorId == null) return []
      // «Касса дня» (шаг 3Б) — наличные в ящике за день: деньги всей клиники, как выручка клиники (сервер: seesAllDoctors)
      const subs: Sub[] = [{ key: 'money', title: 'Деньги' }, { key: 'day', title: 'Касса дня' }, { key: 'earnings', title: 'Мой заработок' }, { key: 'analytics', title: 'Аналитика' },
        { key: 'expenses', title: 'Расходы' }, { key: 'debtors', title: 'Должники' }, { key: 'salary', title: 'Зарплата' },
        { key: 'stats', title: 'Статистика' }, { key: 'report', title: 'Отчёт' }]
      // «Мой заработок» — только у врача со своим креслом
      return subs.filter((s) => (s.key !== 'earnings' || seesOwnEarnings(me)) && (s.key !== 'day' || seesAllMoney(me)))
    }
    case 'stock':
      // «Расходы на склад» (покупки по месяцам) — тому, кто видит деньги всех врачей (сервер: seesAllDoctors):
      // админ-врач при «врачи работают независимо» закупок чужих складов не видит. Врачу в независимой
      // клинике со своим складом — «Мои закупки»: тот же экран по его складу; остальным — только материалы
      // «Лаборатория» (заказ-наряды технику) — всем: ждём работу, примерка, деньги технику (их — кто видит расходы)
      // «Заказ» (что купить у поставщиков) — всем, кто ведёт склад: права как у поставки
      if (seesAllMoney(me)) return [{ key: 'materials', title: 'Материалы' }, { key: 'spending', title: 'Расходы на склад' }, PURCHASE_SUB, LAB_SUB]
      return seesOwnPurchases(me)
        ? [{ key: 'materials', title: 'Материалы' }, { key: 'spending', title: 'Мои закупки' }, PURCHASE_SUB, LAB_SUB]
        : [{ key: 'materials', title: 'Материалы' }, PURCHASE_SUB, LAB_SUB]
    case 'platform':
      // 14 вкладок в строку не влезали — с 2026-11-14 их 9: «Обратная связь» (обращения + опросы), «Рассылка клиникам»
      // (по одной в WhatsApp + всем сразу в бот), «Маркетинг» (контент-план + материалы); «Договор» и «Тарифы» — в
      // «Настройках». Старые адреса — lib/route (PLATFORM_MOVED). Менеджеру — «Клиники» и опросы (сервер: остальное 403)
      if (!me.owner) return [{ key: 'clinics', title: 'Клиники' }, { key: 'feedback', title: 'Опросы' }]
      return [['clinics', 'Клиники'], ['analytics', 'Аналитика'], ['finance', 'Финансы'], ['feedback', 'Обратная связь'],
        ['mailing', 'Рассылка клиникам'], ['marketing', 'Маркетинг'], ['health', 'Здоровье'], ['ai', 'Расход ИИ'], ['settings', 'Настройки']]
        .map(([key, title]) => ({ key: key!, title: title! }))
    case 'clinic':
      // «Клиника» (с 2026-11-10 — раздел меню): о клинике, персонал, услуги, рабочее время, кресла
      return CLINIC_ITEMS.filter((i) => !i.hidden && i.show(me)).map((i) => ({ key: i.key, title: i.title, hint: i.hint }))
    case 'settings':
      // Пусто (у роли нет ни одного пункта) — раздела «Настройки» в меню нет (Shell)
      return SETTINGS_GROUPS.flatMap(([group, items]) => items
        .filter((i) => !i.hidden && i.show(me))
        .map((i) => ({ key: i.key, title: i.title, group, hint: i.hint })))
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

export function sumOf(counts: Counts, page: Page, subs: Sub[], loudSet?: ReadonlySet<string>): { total: number; loud: boolean } {
  let total = 0
  let loud = false
  for (const s of subs) {
    const n = countOf(counts, page, s.key)
    total += n
    if (n > 0 && isLoud(loudSet, page, s.key)) loud = true
  }
  return { total, loud }
}
