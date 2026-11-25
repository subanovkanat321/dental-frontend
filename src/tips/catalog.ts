import type { Schemas } from '../api/client'
import { subsOf } from '../layout/nav'
import type { Page } from '../lib/route'
import { TISH_INSTAGRAM } from '../lib/brand'
import { isAssistant, seesAllMoney, seesOwnEarnings } from '../lib/roles'

type Me = Schemas['BookingViewsMe']

/** Где человек открыл приложение: «Неделя» с перетаскиванием — только на компьютере, «Установить» — не в Telegram. */
export type TipContext = { phone: boolean; telegram: boolean }

/**
 * «Показать» — раздел или пункт, куда ведёт кнопка (адрес без «#»: 'stock/purchase', 'settings/memos', 'me/calendar');
 * «Подробнее» — раздел руководства (глава/раздел из site/guide/content.ts); «Открыть» — ссылка наружу (Instagram Tish).
 */
export type TipAction = { show: string } | { guide: string } | { link: string }

export type Tip = {
  /** Неизменный id: по нему сервер помнит, что совет уже показывали (V233). Латиница, цифры и «-». */
  id: string
  title: string
  /** 1–2 короткие строки */
  text: string
  action: TipAction
  /** Кому совет: права и роль — те же проверки, что у меню (lib/roles, layout/nav) */
  show: (me: Me, ctx: TipContext) => boolean
  /**
   * Тема для «уже пользуетесь»: сервер отдаёт в `used` темы, по которым в клинике есть данные (просили оценку, есть
   * задачи, заказы…), — такие советы идут после остальных. Нет — по порядку.
   */
  feature?: string
}

/** Подраздел есть у этого человека в меню (Касса — не у ассистента: денег он не видит). */
function hasSub(me: Me, page: Page, sub: string): boolean {
  if (page === 'cash' && isAssistant(me)) return false
  return subsOf(page, me).some((s) => s.key === sub)
}

const all = () => true
/** Медкарта и план лечения: руководитель, врач и ассистент (регистратура медкарт не видит). */
const clinical = (me: Me) => Boolean(me.admin || me.doctorId != null || isAssistant(me))

/**
 * Набор «Советов дня» — короткие подсказки о том, что умеет Tish. Порядок — какой показывать раньше (сначала то,
 * что пригодится в первые дни). Каждый совет сверен с руководством (site/guide/content.ts) и кодом; «Показать»
 * ведёт только туда, что этому человеку видно. Деньги — только тем, кто видит деньги.
 *
 * Новый совет — в конец (или по смыслу), с новым id; id показанного раньше совета не менять — иначе он покажется снова.
 */
export const TIPS: Tip[] = [
  {
    id: 'drag',
    title: 'Перенос перетаскиванием',
    text: 'В «Неделе» врача приём можно перетащить мышью на другой день и время. Перетащили случайно — «↩ Вернуть как было».',
    action: { guide: 'raspisanie/nedelya-i-peretaskivanie' },
    show: (_, ctx) => !ctx.phone,
  },
  {
    id: 'walk-in',
    title: 'Пришёл без записи — «⚡ Сейчас»',
    text: '«＋ Новая запись» → «⚡ Сейчас»: приём с этой минуты, врач подставится сам.',
    action: { guide: 'raspisanie/pacient-prishel-bez-zapisi' },
    show: all,
  },
  {
    id: 'dictation',
    title: '🎤 Надиктуйте приём — ИИ разложит сам',
    text: 'Карточка приёма → микрофон «🎤» у заметки: скажите, что сделали, — Tish разложит по карте зубов, плану лечения и заметке.',
    action: { guide: 'raspisanie/nadiktovat-priem-v-medkartu' },
    show: (me) => me.doctorId != null,
  },
  {
    id: 'discount',
    title: '🏷 Скидка в оплате и «Касса дня»',
    text: 'В форме оплаты «＋ Скидка» — процент или сумма и причина: итог посчитает Tish. А «Касса → Касса дня» покажет, сколько наличных должно быть в ящике.',
    action: { guide: 'raspisanie/skidka' },
    show: (me) => Boolean(me.admin),
  },
  {
    id: 'advance',
    title: '👛 Аванс пациента — на брекеты и долгое лечение',
    text: 'Карточка пациента → «Деньги» → «＋ Внести аванс». Приёмы потом оплачиваются «С аванса», а у семьи — один общий аванс.',
    action: { guide: 'raspisanie/avans' },
    show: (me) => Boolean(me.admin || me.reception),
  },
  {
    id: 'visit-templates',
    title: '📄 Шаблон приёма — заметка одной кнопкой',
    text: 'В карточке приёма «📄 Шаблон» заполнит заметку, зубы и план. Свой шаблон — «Сохранить как шаблон» под заметкой.',
    action: { guide: 'raspisanie/shablony-priema' },
    show: (me) => me.doctorId != null,
  },
  {
    id: 'plan-templates',
    title: '🗂 План из шаблона и срок у этапа',
    text: 'В плане лечения «📄 Из шаблона» — «Имплант под ключ» или «Санация» одним нажатием; «👤» у этапа — врач и срок, просроченный подсветится.',
    action: { guide: 'pacienty/plan-vrach-srok-shablony' },
    show: (me) => me.doctorId != null || Boolean(me.admin),
  },
  {
    id: 'diagnosis-icd',
    title: '🩺 Диагноз по МКБ-10 — с подсказками',
    text: 'В заметке «＋ Диагноз»: печатайте «K02» или «пульп» — Tish подскажет код МКБ-10 и частые формулировки вашей клиники.',
    action: { guide: 'raspisanie/diagnoz-mkb' },
    show: (me) => me.doctorId != null,
  },
  {
    id: 'remind',
    title: 'Напоминание в один клик',
    text: 'Бот сам напоминает тем, кто записался через него. Остальным — «📞 Связаться ▾» → «Напомнить о приёме» в карточке приёма: текст уже готов.',
    action: { guide: 'raspisanie/napominaniya-i-otvety-pacientov' },
    show: all,
  },
  {
    id: 'reviews',
    title: '«⭐ Попросить оценку»',
    text: 'Пациенту без Telegram — «📞 Связаться ▾» в карточке состоявшегося приёма: WhatsApp с готовой ссылкой. Довольных позовёт в 2ГИС.',
    action: { guide: 'raspisanie/ocenka-priema' },
    show: all,
    feature: 'reviews',
  },
  {
    id: 'stock',
    title: 'Склад сам подскажет, что кончается',
    text: 'Задайте материалу минимум — дойдёт до него, и в «Складе» появится «⚠️ Заканчивается».',
    action: { show: 'stock/materials' },
    show: all,
    feature: 'stock',
  },
  {
    id: 'purchase',
    title: '«Заказ» поставщику в WhatsApp',
    text: 'Список к закупке собирается сам из того, что на минимуме. «Отправить в WhatsApp» — поставщику уйдёт готовый текст.',
    action: { show: 'stock/purchase' },
    show: (me) => hasSub(me, 'stock', 'purchase'),
    feature: 'purchase',
  },
  {
    id: 'memos',
    title: 'Памятки пациенту после процедур',
    text: 'Что делать после удаления, чистки, пломбы — памятка уходит пациенту вместе с «Сообщением после приёма».',
    action: { show: 'settings/memos' },
    show: (me) => hasSub(me, 'settings', 'memos'),
    feature: 'memos',
  },
  {
    id: 'after-visit',
    title: 'Сообщение после приёма',
    text: 'Одно сообщение вместо отчёта и памятки: что сделали, что дальше, уход дома. Карточка приёма → «📝 Сообщение после приёма ▾» → «С ИИ ✨» — текст готов за секунды.',
    action: { guide: 'raspisanie/soobschenie-posle-priema' },
    show: all,
  },
  {
    id: 'plan-link',
    title: 'План лечения — по ссылке',
    text: 'Отправьте план пациенту в Telegram или WhatsApp: пациент прочитает дома и нажмёт «Согласен».',
    action: { guide: 'pacienty/otpravit-plan-pacientu' },
    show: clinical,
    feature: 'plan-link',
  },
  {
    id: 'atlas',
    title: '3D-атлас для пациента',
    text: 'Покажите на консультации зуб в разрезе, каналы, коронку или имплант — вращайте пальцем или мышью.',
    action: { show: 'learn' },
    show: all,
  },
  {
    id: 'debtors',
    title: 'Должники — одним списком',
    text: 'Кто и сколько должен, старые долги и просрочки. «Принять оплату» — прямо из строки.',
    action: { show: 'cash/debtors' },
    show: (me) => hasSub(me, 'cash', 'debtors'),
  },
  {
    id: 'links',
    title: 'Ссылки для записи и QR на ресепшн',
    text: 'Своя ссылка для Instagram, 2ГИС, WhatsApp-статуса и QR на стойку — видно, откуда пришли пациенты.',
    action: { show: 'clinic/about' },
    show: (me) => Boolean(me.admin || (me.doctorId != null && !isAssistant(me))) && hasSub(me, 'clinic', 'about'),
    feature: 'links',
  },
  {
    id: 'from-tish',
    title: '«Пациенты от Tish»',
    text: 'В «Аналитике» — сколько новых пациентов записалось через Tish в этом месяце, по каждой ссылке.',
    action: { show: 'cash/analytics' },
    show: (me) => seesAllMoney(me) && hasSub(me, 'cash', 'analytics'),
  },
  {
    id: 'cancel-reasons',
    title: 'Почему пациенты не приходят',
    text: 'При «Отменён» и «Неявка» выберите причину — в «Аналитике» видно, что чаще: дубли, болезнь или «передумал».',
    action: { show: 'cash/analytics' },
    show: (me) => hasSub(me, 'cash', 'analytics'),
  },
  {
    id: 'load-report',
    title: 'Загрузка врачей и конверсия',
    text: 'В «Аналитике» — сколько рабочих часов занято записями (меньше 50 % — есть свободные окна) и сколько пациентов дошли до лечения, средний чек.',
    action: { show: 'cash/analytics' },
    show: (me) => hasSub(me, 'cash', 'analytics'),
  },
  {
    id: 'referral',
    title: 'Пригласите коллег — +3 месяца',
    text: 'Клиника по вашей ссылке пробует Tish дольше, а когда оплатит — вам +3 месяца бесплатно.',
    action: { show: 'settings/plan' },
    show: (me) => hasSub(me, 'settings', 'plan'),
    feature: 'referral',
  },
  {
    id: 'timeoff',
    title: 'Выходные и перерывы',
    text: 'Отпуск, обед, праздник клиники — в это время запись закрыта, в «Месяце» день заштрихован.',
    action: { show: 'clinic/hours' },
    show: (me) => hasSub(me, 'clinic', 'hours'),
    feature: 'timeoff',
  },
  {
    id: 'tasks',
    title: 'Задачи с напоминанием',
    text: '«Перезвонить после удаления», «заказать композит» — задача себе или коллеге со сроком: в срок придёт напоминание.',
    action: { show: 'patients/tasks' },
    show: all,
    feature: 'tasks',
  },
  {
    id: 'waitlist',
    title: 'Лист ожидания',
    text: 'Кто хочет прийти раньше — в лист ожидания. Освободилось время — «Новая запись» сама предложит пациентов из листа.',
    action: { show: 'patients/waitlist' },
    show: all,
    feature: 'waitlist',
  },
  {
    id: 'comeback',
    title: '«Позвать снова»',
    text: 'Кто бросил лечение, отменил, не пришёл или давно не был — карточки с числом, приглашение в WhatsApp и «Позвать всех».',
    action: { show: 'patients/comeback' },
    show: (me) => hasSub(me, 'patients', 'comeback'),
  },
  {
    id: 'bot-invite',
    title: 'Пригласите пациентов в бот — напоминания бесплатно',
    text: '«📞 Связаться ▾» → «📲 Пригласить в Telegram-бот»: личная ссылка в WhatsApp или SMS. Кого ещё нет в боте — «Пациенты → Без бота».',
    action: { show: 'patients/nobot' },
    show: (me) => hasSub(me, 'patients', 'nobot'),
  },
  {
    id: 'dropped',
    title: '«Бросили лечение»',
    text: '«Позвать снова» → «Бросили лечение»: кто согласился с планом или начал лечение и пропал — с суммой остатка, звонком и готовым текстом в WhatsApp.',
    action: { show: 'patients/comeback/dropped' },
    show: (me) => hasSub(me, 'patients', 'comeback'),
  },
  {
    id: 'recall',
    title: '«Профосмотр»',
    text: 'Кому пора на осмотр или чистку — список с готовым приглашением.',
    action: { show: 'patients/recall' },
    show: (me) => hasSub(me, 'patients', 'recall'),
  },
  {
    id: 'questions',
    title: 'Вопросы пациентов',
    text: 'Пациенты пишут вопросы в боте — ответ отсюда придёт им в Telegram. Число у «Вопросов» — сколько ждут ответа.',
    action: { show: 'patients/questions' },
    show: all,
  },
  {
    id: 'lab',
    title: 'Лаборатория: работы техника',
    text: 'Заказ-наряды зубному технику: что ждём, когда примерка, что уже готово.',
    action: { show: 'stock/lab' },
    show: (me) => hasSub(me, 'stock', 'lab'),
    feature: 'lab',
  },
  {
    id: 'expenses',
    title: 'Расходы клиники',
    text: 'Аренда, коммуналка, реклама — внесите в «Расходы», и «Чистыми за месяц» посчитается само.',
    action: { show: 'cash/expenses' },
    show: (me) => hasSub(me, 'cash', 'expenses'),
    feature: 'expenses',
  },
  {
    id: 'salary',
    title: 'Зарплата: проценты и оклад',
    text: 'Процент от приёмов, оклад по табелю или аренда кресла — Tish посчитает зарплату каждого за месяц.',
    action: { show: 'cash/salary' },
    show: (me) => seesAllMoney(me) && hasSub(me, 'cash', 'salary'),
  },
  {
    id: 'earnings',
    title: '«Мой заработок»',
    text: 'Сколько вы заработали за месяц — по приёмам, без вопросов к бухгалтеру.',
    action: { show: 'cash/earnings' },
    show: (me) => seesOwnEarnings(me) && hasSub(me, 'cash', 'earnings'),
  },
  {
    id: 'debt-text',
    title: 'Вежливое напоминание о долге',
    text: 'Свой текст для «Напомнить» в «Должниках» — от имени клиники, без неловкости.',
    action: { show: 'settings/debt' },
    show: (me) => hasSub(me, 'settings', 'debt'),
  },
  {
    id: 'calendar',
    title: 'Приёмы в календаре телефона',
    text: 'Ваши приёмы — в Google или Apple Календаре рядом с личными делами. Включается один раз.',
    action: { show: 'me/calendar' },
    show: (me) => me.doctorId != null,
  },
  {
    id: 'bot-words',
    title: 'Пишите боту словами',
    text: '«Что у меня сегодня», «запиши Бакыта на пятницу в 15:00» — бот Tish покажет, что сделает, и сделает после «✅ Да».',
    action: { guide: 'pacienty/pisat-botu-slovami' },
    show: all,
  },
  {
    id: 'install',
    title: 'Tish значком на телефоне',
    text: 'Установите Tish как приложение — откроется с главного экрана, уведомления придут без Telegram.',
    action: { show: 'me/install' },
    show: (_, ctx) => !ctx.telegram,
  },
  {
    id: 'import',
    title: 'Переезд из Excel',
    text: 'Пациенты, услуги и долги из старой программы — одним шаблоном в «Импорт, выгрузка, журнал».',
    action: { show: 'settings/data' },
    show: (me) => Boolean(me.admin) && hasSub(me, 'settings', 'data'),
  },
  {
    id: 'ai-on',
    title: 'ИИ в клинике ✨',
    text: 'Включите ИИ: он пишет сообщения пациентам после приёма, раскладывает диктовку врача и помогает с постами.',
    action: { show: 'settings/ai' },
    show: (me) => hasSub(me, 'settings', 'ai'),
  },
  {
    id: 'ratings-list',
    title: 'Оценки пациентов — списком',
    text: 'Кто какую оценку поставил после приёма — «Пациенты → Оценки». «Только 1–3 ★» — жалобы, на которые стоит ответить.',
    action: { show: 'patients/ratings' },
    show: (me) => hasSub(me, 'patients', 'ratings'),
  },
  {
    id: 'quick-menu',
    title: 'Действия с записью — без карточки',
    text: 'Наведите на приём в расписании и нажмите «⋯» (или правой кнопкой мыши; на телефоне — долгое нажатие): «Приём состоялся», «Неявка», оплата, позвонить, перенести, записать повторно.',
    action: { guide: 'raspisanie/den-na-kompyutere' },
    show: (me) => Boolean(me.admin || me.reception || me.doctorId != null || isAssistant(me)),
  },
  {
    id: 'visit-marks',
    title: 'Статусы проще: «Приём состоялся» или «Неявка»',
    text: 'Отмечать «Пришёл» не нужно: в день приёма главная кнопка — «Приём состоялся», «Неявка» — рядом. Ответ пациента («Подтвердил», «Просит перенести», «Нет ответа») — в списке статуса.',
    action: { guide: 'raspisanie/den-na-kompyutere' },
    show: (me) => Boolean(me.admin || me.reception || me.doctorId != null),
  },
  {
    id: 'patient-tags',
    title: 'Свои метки пациентов',
    text: '«Боится», «Опаздывает», «По рекомендации» — цветные точки у имени в расписании и в карточке пациента. Список — «Настройки → Метки пациентов».',
    action: { show: 'settings/tags' },
    show: (me) => hasSub(me, 'settings', 'tags'),
  },
  {
    id: 'schedule-colors',
    title: 'Календарь врача и «чем красить»',
    text: 'Нажмите на имя врача над колонкой — месяц: рабочие дни, отпуск, сколько свободно. Под расписанием — «Красить запись»: по статусу, врачу или услуге.',
    action: { guide: 'raspisanie/chitat-raspisanie' },
    show: (me) => Boolean(me.admin || me.reception || me.doctorId != null || isAssistant(me)),
  },
  {
    id: 'several-services',
    title: '🦷 Несколько услуг в одном приёме',
    text: 'Профгигиена и лечение кариеса за один визит? В «Новой записи» выберите обе услуги, в карточке — «＋ Услуга» и зубы у строки. В оплате сумма услуг подставится сама.',
    action: { guide: 'raspisanie/uslugi-priema' },
    show: (me) => Boolean(me.admin || me.reception || me.doctorId != null),
  },
  {
    id: 'waitlist-windows',
    title: '🔔 Освободилось окно — кому предложить',
    text: 'Укажите в листе ожидания, когда пациенту удобно. Освободится подходящее время — в «Расписании» появится «🔔 Окна»: «Предложить» в бот или WhatsApp.',
    action: { guide: 'pacienty/osvobodilos-okno' },
    show: (me) => Boolean(me.admin || me.reception),
  },
  {
    id: 'instagram',
    title: 'Tish в Instagram',
    text: 'Короткие видео «как сделать» и юмор про будни стоматолога. Подпишитесь — рилсы можно репостить в Instagram клиники.',
    action: { link: TISH_INSTAGRAM },
    show: all,
  },
]

/** Id приглашения в группу врачей: на сервере — свой учёт (не больше 3 раз, раз в 3 дня). */
export const GROUP_TIP = 'group'

/**
 * Советы этому человеку по порядку: только доступные, без увиденных; сначала то, чем клиника ещё не пользовалась.
 */
export function tipsFor(me: Me, ctx: TipContext, seen: readonly string[], used: readonly string[]): Tip[] {
  const left = TIPS.filter((t) => !seen.includes(t.id) && t.show(me, ctx))
  const fresh = left.filter((t) => !t.feature || !used.includes(t.feature))
  const known = left.filter((t) => t.feature && used.includes(t.feature))
  return [...fresh, ...known]
}
