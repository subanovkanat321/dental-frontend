import type { Schemas } from '../api/client'
import type { Page } from '../lib/route'
import { isAssistant, seesAllMoney, seesOwnEarnings } from '../lib/roles'

type Me = Schemas['BookingViewsMe']

/**
 * Шаг тура: на что указать (значения `data-tour` — один элемент или несколько, тогда рамка вокруг всех),
 * короткий заголовок и 1–2 строки. `page` — раздел, который надо открыть перед шагом (кнопка
 * «＋ Новая запись» есть только в «Расписании», вкладки подразделов — в «Пациентах»).
 */
export type TourStep = { id: string; target: string[]; title: string; text: string; page?: Page }

/** Роль для текстов — так же, как подпись под именем в блоке «Я» (Shell). */
export type TourRole = 'admin' | 'doctor' | 'reception' | 'assistant'

export function tourRole(me: Me): TourRole {
  if (me.admin) return 'admin'
  if (me.reception) return 'reception'
  if (isAssistant(me)) return 'assistant'
  return 'doctor'
}

/**
 * Шаги тура для роли и устройства (4–6). Компьютер — боковое меню и полоса вкладок над страницей,
 * внизу меню «Помощь» и блок «Я»; телефон — нижнее меню, вкладки вверху и «Ещё» (там профиль и
 * «Помощь»). Ассистенту «Кассы» нет — денег он не видит (Shell.sectionsOf). Шаг, чей элемент не нашёлся
 * на экране, тур пропускает сам (Tour) — набор здесь только «что стоит показать».
 *
 * `telegramApp` — открыто в Telegram: там нет «Выйти» (выходить не из чего), о нём не пишем.
 */
export function tourSteps(me: Me, phone: boolean, telegramApp = false): TourStep[] {
  const role = tourRole(me)
  const steps: TourStep[] = []
  steps.push({
    id: 'schedule', target: ['nav-schedule'], page: 'schedule',
    title: role === 'doctor' ? 'Расписание — здесь ваш день' : role === 'assistant' ? 'Расписание — день ваших врачей' : 'Расписание — здесь день клиники',
    text: role === 'doctor' ? 'Ваши приёмы по времени. Нажмите на приём — откроется его карточка.'
      : role === 'assistant' ? 'Приёмы врачей, которым вы помогаете. Нажмите на приём — откроется карточка.'
        : role === 'reception' ? 'Приёмы всех врачей. Нажмите на приём — отметить «пришёл», перенести или отправить на кассу.'
          : 'Приёмы всех врачей по времени. Нажмите на приём — откроется его карточка.',
  })
  steps.push({
    id: 'new', target: ['new-appointment'], page: 'schedule',
    title: '＋ Новая запись',
    text: 'Записать пациента: врач, время и услуга. Пришёл без записи — там же «⚡ Сейчас».',
  })
  steps.push({
    id: 'patients', target: ['nav-patients'],
    title: 'Пациенты',
    text: 'Карточки пациентов: поиск по имени или телефону, история визитов, запись на приём.',
  })
  steps.push({
    id: 'tabs', target: ['sub-tabs'], page: 'patients',
    title: 'Вкладки подразделов',
    text: phone
      ? 'В разделах — вкладки: «Записаны», «Лист ожидания», «Вопросы»… Листайте вбок или нажмите ⌄ — весь список.'
      : 'В разделах — вкладки над страницей: «Записаны», «Лист ожидания», «Вопросы»… Нажмите, чтобы переключить.',
  })
  if (role !== 'assistant') {
    steps.push({ id: 'cash', target: ['nav-cash'], title: 'Касса', text: cashText(me) })
  }
  if (phone) {
    steps.push({
      id: 'more', target: ['more'],
      title: 'Ещё: профиль и Помощь',
      text: `Здесь ваш профиль${telegramApp ? '' : ' и выход'}, другие разделы и «Помощь» — там короткие видео «Как сделать в Tish» и группа врачей Tish.`,
    })
  } else {
    steps.push({
      id: 'help', target: ['help', 'me'],
      title: 'Помощь — если что-то непонятно',
      text: `Там короткие видео «Как сделать в Tish», группа врачей Tish, руководство и чат. Ниже — ваш профиль${telegramApp ? '' : ' и выход'}.`,
    })
  }
  return steps
}

/** «Касса» — что в ней у этого человека: деньги клиники, свой заработок или только «к оплате». */
function cashText(me: Me): string {
  if (seesAllMoney(me)) return 'Деньги клиники: оплаты за день, расходы, долги, зарплата и отчёты.'
  if (seesOwnEarnings(me)) return 'Оплаты ваших пациентов и «Мой заработок».'
  return 'Кто ждёт оплаты на кассе — примите оплату здесь.'
}
