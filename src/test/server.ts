import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import type { Schemas } from '../api/client'

/** «Откуда узнал о клинике» — как стандартный набор новой клиники (V110 бэкенда), часть вариантов. */
export const SOURCES: Schemas['PatientSourcesOption'][] = [
  { id: 11, code: 'INSTAGRAM', emoji: '📱', title: 'Instagram', titleKy: 'Instagram', active: true, position: 10, patients: 3 },
  { id: 12, code: 'MAPS', emoji: '🗺', title: '2ГИС', titleKy: '2ГИС', active: true, position: 20, patients: 0 },
  { id: 16, code: 'RECOMMENDATION', emoji: '🤝', title: 'Посоветовали знакомые', titleKy: 'Тааныштар сунушташты', active: true, position: 60, patients: 1 },
  { id: 19, code: 'ADS', emoji: '📣', title: 'Реклама', titleKy: 'Жарнама', active: false, position: 90, patients: 2 },
  { id: 20, code: 'OTHER', emoji: '✨', title: 'Другое', titleKy: 'Башка', active: true, position: 100, patients: 0 },
]

/** «Приведи друга» выключено — как у новой клиники. */
export const REFERRAL_OFF: Schemas['PatientReferralsSettingsView'] = {
  enabled: false, validDays: 60, previewRu: '', previewKy: '',
  friend: { kind: 'PERCENT', percent: 10, label: 'скидка 10 %' }, inviter: { kind: 'PERCENT', percent: 10, label: 'скидка 10 %' },
}

/**
 * Фальшивый бэкенд для тестов: обработчики добавляет каждый тест (server.use). Здесь — только
 * фоновые запросы полосы «Сегодня» (склад, выручка, касса) и карточки приёма (материалы, услуги): пусто, если тест не задал своё.
 */
export const server = setupServer(
  // Отчёты об ошибках приложения (lib/clientErrors): сервер всегда отвечает 204
  http.post('*/web/client-error', () => new HttpResponse(null, { status: 204 })),
  http.get('*/api/supplies', () => HttpResponse.json([])),
  // Вход через Google (ADR 0008 бэкенда): по умолчанию не подключён — блока в «Моём профиле» нет
  http.get('*/api/me/identities', () => HttpResponse.json([] satisfies Schemas['ExternalLoginControllerIdentityView'][])),
  // WhatsApp через Tish (V256): по умолчанию не подключён — напоминания как раньше (бот или WhatsApp вручную)
  http.get('*/api/clinic/whatsapp', () => HttpResponse.json({ available: false, connected: false, confirmation: true, reminder: true, soon: true,
    templates: [], recent: [] } satisfies Schemas['WhatsAppAdminClinicView'])),
  http.get('*/api/platform/whatsapp', () => HttpResponse.json({ enabled: false, webhookReady: false, graphVersion: 'v23.0',
    webhookPath: '/api/whatsapp/webhook', secretsKey: false, connections: [], last24h: {}, failures: [] } satisfies Schemas['WhatsAppAdminPlatformView'])),
  // «Кто может давать скидку» (форма оплаты): по умолчанию — только руководитель, и он же вошёл (fixtures.me — админ)
  http.get('*/api/clinic/discounts', () => HttpResponse.json(
    { who: 'ADMIN', maxPercent: 10, canGive: true, myMaxPercent: 100 } satisfies Schemas['DiscountPoliciesPolicy'])),
  // Диагнозы (шаг 3): подсказки в «Диагнозе» и «Аналитика → Диагнозы за период» — по умолчанию пусто
  http.get('*/api/diagnoses/suggest', () => HttpResponse.json({ codes: [], own: [] } satisfies Schemas['DiagnosesSuggestions'])),
  http.get('*/api/diagnoses/report', () => HttpResponse.json([] satisfies Schemas['DiagnosesCodeCount'][])),
  // Загрузка и конверсия (шаг 5Б, «Аналитика»): по умолчанию пусто
  http.get('*/api/appointments/load', ({ request }) => {
    const q = new URL(request.url).searchParams
    return HttpResponse.json({ from: q.get('from')!, to: q.get('to')!, doctors: [], chairs: [], plannedMinutes: 0, bookedMinutes: 0, doneMinutes: 0 } satisfies Schemas['OwnerReportsLoadView'])
  }),
  http.get('*/api/appointments/conversion', ({ request }) => {
    const q = new URL(request.url).searchParams
    return HttpResponse.json({ from: q.get('from')!, to: q.get('to')!, booked: 0, done: 0, cancelled: 0, noShow: 0, waiting: 0, patients: 0, continued: 0,
      newPatients: 0, returningPatients: 0, money: false } satisfies Schemas['OwnerReportsConversionView'])
  }),
  // Долги (полоса «Сегодня», карточка приёма): по умолчанию нет. Без обработчика запрос падал бы обрывом
  // сети — а это плашка «Tish обновляется» (api/updating.ts) поверх того, что проверяет тест
  http.get('*/api/appointments/debts', () => HttpResponse.json([] satisfies Schemas['PaymentQueryDebt'][])),
  // Долги из прежней программы (шаблон переезда): по умолчанию нет — блока в «Должниках» и карточке пациента нет
  http.get('*/api/opening-debts', () => HttpResponse.json([] satisfies Schemas['OpeningDebtsView'][])),
  // Аванс пациента (V243, шапка карточки, «Деньги», форма оплаты): по умолчанию пуст — строки «аванс …» и «С аванса» нет
  http.get('*/api/patients/:patientId/advance', ({ params }) => HttpResponse.json(
    { patientId: Number(params.patientId), balanceSom: 0, members: [], entries: [] } satisfies Schemas['AdvancesView'])),
  // Подсказка «🪑 время коллеги по креслу» в «Новой записи» и переносе: по умолчанию коллеги в это время нет
  http.get('*/api/appointments/chair-check', () => HttpResponse.json({ strict: false, freeChairs: [], notified: [] } satisfies Schemas['ChairCheckView'])),
  http.get('*/api/appointments/chair-options', () => HttpResponse.json([] satisfies Schemas['ChairOptionView'][])),
  // «🎁 Пригласите коллег» и /join?ref=…: по умолчанию нет — блоков нет (их тесты — account/invite.test.tsx, site/joinRef.test.tsx)
  http.get('*/api/clinic/referral', () => HttpResponse.json({ detail: 'нет' }, { status: 404 })),
  // «Приведи друга» пациентов (V260): по умолчанию выключено — подсказок в оплате, блока в карточке и карточки Mini App нет
  // (их тесты — refer/*.test.tsx)
  http.get('*/api/clinic/referral-settings', () => HttpResponse.json(REFERRAL_OFF)),
  http.get('*/api/appointments/:id/referral-offers', () => HttpResponse.json([] satisfies Schemas['PatientReferralsOffer'][])),
  http.get('*/api/patients/:id/referral', () => HttpResponse.json({ enabled: false, invited: 0, came: 0, rewardsAvailable: 0, rewardsUsed: 0,
    friends: [] } satisfies Schemas['PatientReferralsCard'])),
  http.get('*/api/reports/referrals', ({ request }) => {
    const q = new URL(request.url).searchParams
    return HttpResponse.json({ from: q.get('from')!, to: q.get('to')!, enabled: false, invited: 0, came: 0, revenueSom: 0, rewardsGiven: 0,
      rewardsUsed: 0, top: [] } satisfies Schemas['PatientReferralsReport'])
  }),
  http.get('*/api/patient/referral', () => HttpResponse.json({ enabled: false, validDays: 60, invited: 0, came: 0,
    rewardsUntil: [] } satisfies Schemas['PatientReferralsPatientLink'])),
  http.get('*/web/referral', () => HttpResponse.json({ detail: 'Приглашение не найдено' }, { status: 404 })),
  // Кейс на /join не заполнен — блока нет; черновик в «Платформа → Настройки» — пустой
  // Демо-клиника без регистрации: по умолчанию выключена (как на сервере) — кнопок «Посмотреть демо» нет
  http.get('*/api/platform/demo/entries', () => HttpResponse.json({ days: [], total: 0, enabled: false } satisfies Schemas['DemoControllerEntries'])),
  http.get('*/web/demo', () => HttpResponse.json({ enabled: false } satisfies Schemas['DemoControllerInfo'])),
  http.get('*/web/case', () => HttpResponse.json({ metrics: [], consent: false, shown: false } satisfies Schemas['JoinCaseCase'])),
  http.get('*/api/platform/case', () => HttpResponse.json({ metrics: [], consent: false, shown: false } satisfies Schemas['JoinCaseCase'])),
  // Ролик и презентация на /join: по умолчанию каталога материалов нет — блока нет
  http.get('*/web/materials/public', () => HttpResponse.json({ video: null, poster: null, presentation: null })),
  // «Помощь → Видео: как сделать»: по умолчанию роликов нет
  http.get('*/web/materials/howto', () => HttpResponse.json([])),
  // «Клиники»: воронка пустая — тесты своих экранов задают своё
  http.get('*/api/platform/funnel', () => HttpResponse.json({ total: 0, stages: [], leads: [] } satisfies Schemas['SalesFunnelFunnel'])),
  // «Контент»: Instagram на сервере не подключён — кнопок публикации нет
  http.get('*/api/platform/content/instagram', () => HttpResponse.json({ enabled: false } satisfies Schemas['InstagramTokensState'])),
  http.get('*/api/platform/content/settings', () => HttpResponse.json({ reelsAuto: false, storiesAuto: false } satisfies Schemas['ContentSettingsSettings'])),
  // Уведомления в приложение: по умолчанию на сервере не включены — блок в «Настройках» скрыт
  http.get('*/api/push', () => HttpResponse.json({ enabled: false, channel: 'TELEGRAM', devices: [] })),
  // «Логин и пароль»: по умолчанию вошли через Telegram — блока нет
  http.get('*/api/me/name', () => HttpResponse.json({ fullName: 'Айпери', editable: true } satisfies Schemas['StaffMembersOwnName'])),
  http.get('*/api/me/password', () => HttpResponse.json({ phoneLogin: false, passwordSet: false, temporary: false, sms: false, telegram: false, telegramCode: false } satisfies Schemas['PasswordControllerPasswordState'])),
  // «Мой профиль → Почта»: по умолчанию почта на сервере не настроена — блока нет (почту проверяет profileEmail.test)
  http.get('*/api/me/email', () => HttpResponse.json({ email: undefined, phoneLogin: false, available: false } satisfies Schemas['MyEmailControllerMyEmail'])),
  // Сведения о платформе: по умолчанию пусто — группы врачей в «Помощи» нет (её тест — layout/helpFab.test.tsx)
  http.get('*/api/platform-info', () => HttpResponse.json({ accessLog: false, accessNotify: false, accessRequiresGrant: false } satisfies Schemas['PlatformInfoInfo'])),
  // Тур при первом входе: по умолчанию уже пройден — не закрывает экраны остальных тестов (тесты тура — tour/tour.test.tsx)
  http.get('*/api/me/tour', () => HttpResponse.json({ seenAt: '2026-11-01T06:00:00Z' } satisfies Schemas['StaffTourTourView'])),
  http.put('*/api/me/tour', () => HttpResponse.json({ seenAt: '2026-11-01T06:00:00Z' } satisfies Schemas['StaffTourTourView'])),
  // «Совет дня»: по умолчанию сегодня уже показали — карточки нет (свои тесты — tips/tips.test.tsx)
  http.get('*/api/me/tips', () => HttpResponse.json({ ready: false, shownToday: true, seen: [], off: false, groupShows: 0, groupDone: false, groupDue: false, used: [] } satisfies Schemas['StaffTipsTipsView'])),
  // Код на свой номер не ждём (шаг «Код» в «Логин и пароль» после перезагрузки — свои тесты)
  http.get('*/api/me/password/code', () => HttpResponse.json({ pending: false, secondsLeft: 0, resendSeconds: 0 } satisfies Schemas['PasswordControllerCodePending'])),
  // Экран входа: незаконченного входа нет (шаг после перезагрузки — свои тесты)
  http.get('*/web/login/phone/pending', () => new HttpResponse(null, { status: 204 })),
  http.delete('*/web/login/phone/pending', () => new HttpResponse(null, { status: 204 })),
  // «Войти через Telegram»: подтверждения не ждём (ожидание и вход — layout/telegramLogin.test.tsx)
  http.get('*/web/login/telegram/status', () => HttpResponse.json({ state: 'none', secondsLeft: 0, link: null })),
  http.get('*/api/patient-sources', () => HttpResponse.json(SOURCES)),
  // Промокоды (V122): по умолчанию у клиники их нет
  http.get('*/api/promo-codes', () => HttpResponse.json([])),
  http.get('*/api/appointments/promo-codes', () => HttpResponse.json({ rows: [], money: false })),
  // «Пациенты от Tish» (V232): по умолчанию никого — тест отчёта (cash/tish.test.tsx) задаёт своё
  http.get('*/api/appointments/from-tish', () => HttpResponse.json({
    month: '2026-11', from: '2026-11-01', to: '2026-11-18', previousFrom: '2026-10-01', previousTo: '2026-10-18', partial: true,
    current: { newPatients: 0, came: 0, revenueSom: 0, allNewPatients: 0 }, previous: { newPatients: 0, came: 0, revenueSom: 0, allNewPatients: 0 }, channels: [],
  } satisfies Schemas['TishReportControllerTishReport'])),
  http.get('*/api/appointments/revenue', () => HttpResponse.json({ totalSom: 0, paidCount: 0, unpaidCount: 0, byMethod: {}, days: [] })),
  http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
  // «⭐ Попросить оценку» (V222): по умолчанию просить некого и в карточке кнопки нет — тесты оценки задают своё
  http.get('*/api/appointments/review-asks', () => HttpResponse.json([] satisfies Schemas['ReviewLinksCandidate'][])),
  http.get('*/api/appointments/:id/review-link', () => HttpResponse.json({ available: false, reason: 'rated' } satisfies Schemas['ReviewLinksDraft'])),
  // «Мой заработок» — по умолчанию нет (как у админа без кресла): тесты своих экранов не видят лишний чип
  http.get('*/api/me/earnings', () => HttpResponse.json({ status: 403, title: 'Forbidden' }, { status: 403 })),
  // «Чистыми за месяц»: по умолчанию врач работает за клинику (блока нет), итога по врачам нет
  http.get('*/api/me/net-month', () => HttpResponse.json({ month: '2026-11', purchasedSom: 0 } satisfies Schemas['NetMonthMine'])),
  // Расходы: по умолчанию пусто (общие с долями — тоже), касса «Деньги» показывает приход, расход и итог
  http.get('*/api/expenses/shared', () => HttpResponse.json([] satisfies Schemas['ExpensesExpense'][])),
  http.get('*/api/expenses', () => HttpResponse.json([] satisfies Schemas['ExpensesExpense'][])),
  http.get('*/api/finance/net-month', () => HttpResponse.json({ status: 403, title: 'Forbidden' }, { status: 403 })),
  http.get('*/api/appointments/report', () => HttpResponse.json([])),
  http.get('*/api/appointments/:id/supplies', () => HttpResponse.json([])),
  http.get('*/api/appointments/:id/supplies/suggested', () => HttpResponse.json([])),
  http.get('*/api/service-types/:id/supplies', () => HttpResponse.json([])),
  http.get('*/api/supplies/starter', () => HttpResponse.json({ missing: [], services: [] })),
  http.get('*/api/care-memos/starter', () => HttpResponse.json([])),
  http.get('*/api/clinic/starter', () => HttpResponse.json({ services: [], memos: [], questions: [], sources: [] })),
  http.get('*/api/families', () => HttpResponse.json([])),
  http.get('*/api/comebacks', () => HttpResponse.json({ patients: [], planSom: 0, planPatients: 0, noShows: 0, recalls: 0 })),
  http.get('*/api/dropped', () => HttpResponse.json({ patients: [], total: 0, leftSom: 0, days: 30 } satisfies Schemas['PlanStatesBoard'])),
  // «Пациенты → Группы» (шаг 9А): по умолчанию ничего не делали — плитки в «Аналитике» нет
  // «Позвать снова»: числа карточек групп и группа карточки — пусто, пока тест не задал своё
  http.get('*/api/patient-groups', () => HttpResponse.json({ ready: [], tags: [], custom: [] } satisfies Schemas['SegmentServiceGroups'])),
  http.get('*/api/patient-groups/members', () => HttpResponse.json({ name: 'Группа', total: 0, inBot: 0, optedOut: 0, patients: [], taskTitle: 'Позвонить',
    messageText: 'Здравствуйте, {имя}!', history: [] } satisfies Schemas['SegmentServiceMembers'])),
  http.get('*/api/patient-groups/results', () => HttpResponse.json({ days: 90, messaged: 0, messagedBooked: 0, called: 0, calledBooked: 0 } satisfies Schemas['SegmentServiceResults'])),
  http.get('*/api/comebacks/result', () => HttpResponse.json({ invited: 0, returned: 0, returnedPlanSom: 0, paidSom: 0 })),
  http.get('*/api/appointments/:id/visit-report', () => new HttpResponse(null, { status: 204 })),
  http.get('*/api/clinic/visit-report-ai', () => HttpResponse.json({ available: false, on: false } satisfies Schemas['VisitReportControllerAiSetting'])),
  http.get('*/api/patients/:id/family', () => new HttpResponse(null, { status: 204 })),
  http.get('*/api/service-types', () => HttpResponse.json([])),
  // «Часто» в выборе услуги: по умолчанию записей нет; раздел новой услуги — «Другое»
  http.get('*/api/service-types/popular', () => HttpResponse.json({ ids: [] } satisfies Schemas['ServiceTypeControllerPopular'])),
  http.get('*/api/service-types/group-guess', () => HttpResponse.json({ group: 'OTHER' } satisfies Schemas['ServiceTypeControllerGroupGuess'])),
  http.get('*/api/appointments/:id/payments', () => HttpResponse.json([])),
  http.get('*/api/waitlist', () => HttpResponse.json([])),
  // Шаг 6Б: окна для листа ожидания и кто подходит — по умолчанию никого; именинников нет, авто-поздравление выключено
  http.get('*/api/waitlist/windows', () => HttpResponse.json([] satisfies Schemas['WaitlistWindowsFreeWindow'][])),
  http.get('*/api/waitlist/fits', () => HttpResponse.json([] satisfies Schemas['WaitlistWindowsMatch'][])),
  http.get('*/api/birthdays/today', () => HttpResponse.json({ date: '2026-11-20', items: [] } satisfies Schemas['BirthdaysToday'])),
  http.get('*/api/clinic/birthday-settings', () => HttpResponse.json({ autoGreet: false, greetHour: 10 } satisfies Schemas['BirthdaysSettings'])),
  // График смен (V150): по умолчанию смен нет — в «Сводке дня» строки «На смене» нет
  // Неделя сотрудника (строка «Часы» в «Персонале»): по умолчанию — как у клиники
  http.get('*/api/shifts/weekly/:telegramId', () => HttpResponse.json({ telegramId: 0, custom: false, days: [] } satisfies Schemas['ShiftServiceWeekly'])),
  http.get('*/api/shifts', () => HttpResponse.json({ people: [], shifts: [], canEdit: false, me: 0 } satisfies Schemas['ShiftControllerSchedule'])),
  // «Склад → Заказ»: число у подраздела, список, поставщики, цены материала
  http.get('*/api/purchases/count', () => HttpResponse.json({ count: 0 } satisfies Schemas['PurchaseViewsCount'])),
  http.get('*/api/purchases', () => HttpResponse.json({ count: 0, groups: [], orders: [] } satisfies Schemas['PurchaseViewsPurchaseList'])),
  http.get('*/api/suppliers', () => HttpResponse.json([] satisfies Schemas['PurchaseViewsSupplierView'][])),
  http.get('*/api/supplies/:id/prices', () => HttpResponse.json({ suppliers: [], entries: [] } satisfies Schemas['PurchaseViewsPriceHistory'])),
  // Задачи (V218): по умолчанию нет ни одной — ни числа у «Задач», ни строки в расписании
  http.get('*/api/tasks/summary', () => HttpResponse.json({ overdue: 0 } satisfies Schemas['TaskControllerSummary'])),
  http.get('*/api/leads/summary', () => HttpResponse.json({ attention: 0 } satisfies Schemas['LeadControllerSummary'])),
  http.get('*/api/leads', () => HttpResponse.json([] satisfies Schemas['LeadView'][])),
  http.get('*/api/leads/conversion', () => HttpResponse.json({ from: '2026-11-01', to: '2026-11-30', total: 0, booked: 0, refused: 0, channels: [] } satisfies Schemas['LeadServiceConversion'])),
  http.get('*/api/tasks/assignees', () => HttpResponse.json([] satisfies Schemas['TaskControllerAssignee'][])),
  http.get('*/api/tasks', () => HttpResponse.json([] satisfies Schemas['TaskView'][])),
  // Лаборатория (V221): по умолчанию ни работ, ни лабораторий, ни долгов
  http.get('*/api/lab-orders/debts', () => HttpResponse.json({ totalSom: 0, labs: [] } satisfies Schemas['LabControllerDebts'])),
  http.get('*/api/lab-orders/visits', () => HttpResponse.json([] satisfies Schemas['LabControllerVisit'][])),
  http.get('*/api/lab-orders', () => HttpResponse.json([] satisfies Schemas['LabOrderView'][])),
  http.get('*/api/labs', () => HttpResponse.json([] satisfies Schemas['LabView'][])),
  // Вопросы пациентов (V142): по умолчанию новых нет — бейджа у «Пациентов» нет
  http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 0 } satisfies Schemas['QuestionControllerNewCount'])),
  // Кресла (V185): по умолчанию у клиники их нет — значков и штриховки «кресло занято» нет
  http.get('*/api/chairs', () => HttpResponse.json([] satisfies Schemas['ChairOverview'][])),
  // Новый врач в «＋ Добавить сотрудника» по умолчанию получает новое кресло: создать и назначить
  http.post('*/api/chairs', () => HttpResponse.json({ id: 1, name: 'Кресло 1' } satisfies Schemas['ChairsChair'], { status: 201 })),
  http.put('*/api/doctors/:id/chair', () => HttpResponse.json([] satisfies Schemas['ChairOverview'][])),
  // «Персонал»: по умолчанию сотрудников без кресла и приглашений нет — только врачи
  http.get('*/api/members', () => HttpResponse.json([] satisfies Schemas['StaffMembersMemberView'][])),
  http.get('*/api/members/invites', () => HttpResponse.json([] satisfies Schemas['StaffMembersInviteView'][])),
  http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [], free: [], breaks: [] })),
  // Свободные дни врача за месяц: по умолчанию отметок нет — календарь как обычный
  http.get('*/api/slots/month', () => HttpResponse.json([] satisfies Schemas['SlotServiceFreeDay'][])),
  // ❗ «Важно для врача»: по умолчанию ни у кого нет отметок в анкете
  http.post('*/api/anamnesis/alerts', () => HttpResponse.json([] satisfies Schemas['AnamnesisAlert'][])),
  http.get('*/api/appointments/:id/note', () => HttpResponse.json({ note: '' })),
  http.get('*/api/patients/:id/notes', () => HttpResponse.json([])),
  // Шаг 8А: похожих карточек и событий ленты по умолчанию нет
  http.get('*/api/patients/duplicates', () => HttpResponse.json([] satisfies Schemas['PatientDuplicatesPair'][])),
  http.get('*/api/patients/:id/duplicates', () => HttpResponse.json([] satisfies Schemas['PatientDuplicatesMatch'][])),
  http.get('*/api/patients/:id/timeline', () => HttpResponse.json({ items: [] } satisfies Schemas['PatientTimelinePage'])),
  // «Зубы этого приёма» и история зубов по визитам (V155): по умолчанию ничего не отмечено
  http.get('*/api/appointments/:id/teeth', () => HttpResponse.json([] satisfies Schemas['VisitToothView'][])),
  // Карта зубов — у формулы в плане лечения (план с зубов); по умолчанию все здоровы
  http.get('*/api/patients/:id/teeth', () => HttpResponse.json([] satisfies Schemas['ToothView'][])),
  http.get('*/api/patients/:id/teeth/history', () => HttpResponse.json([] satisfies Schemas['VisitTeethView'][])),
  http.get('*/api/patients/:id/plan', () => HttpResponse.json([] satisfies Schemas['TreatmentStepView'][])),
  // Статус плана (V236): плана нет — status пусто, нули
  // Варианты плана (V254): по умолчанию — пусто, план работает как один вариант
  http.get('*/api/patients/:id/plan/variants', () => HttpResponse.json({ variants: [], switchable: true } satisfies Schemas['PlanVariantsVariants'])),
  http.get('*/api/patients/:id/plan/next', () => HttpResponse.json({ planActive: false, stepIds: [] } satisfies Schemas['TreatmentPlanNextStep'])),
  http.get('*/api/patients/:id/plan/status', () => HttpResponse.json({ done: 0, total: 0, doneSom: 0, totalSom: 0, manualAgreed: false } satisfies Schemas['PlanStatesProgress'])),
  http.get('*/api/patients/:id/expenses', () => HttpResponse.json([])),
  http.get('*/api/patients/:id/anamnesis', () => HttpResponse.json({ items: [] })),
  // Согласие на публикацию фото (V139): по умолчанию его нет — «До / после» выключена
  http.get('*/api/patients/:id/files', () => HttpResponse.json([] satisfies Schemas['PatientFilesView'][])),
  // Договор с пациентом (V181): по умолчанию не подписан
  http.get('*/api/patients/:id/contract', () => HttpResponse.json({ signed: false, title: 'Договор', text: 'Текст договора', canSign: true, hasSignature: false, hasScan: false } satisfies Schemas['PatientContractsView'])),
  http.get('*/api/patients/:id/publication-consent', () => HttpResponse.json({} satisfies Schemas['PublicationConsentsView'])),
  // Опрос команды Tish (src/survey): по умолчанию ответа никто не ждёт — приглашения нет
  http.get('*/api/surveys/current', () => HttpResponse.json({} satisfies Schemas['SurveyAnswersCurrent'])),
  // Напоминания админу (AdminNotices): по умолчанию всё в порядке — напоминаний нет
  http.get('*/api/clinic/agreement', () => HttpResponse.json({ scans: [] })),
  http.get('*/api/clinic', () => HttpResponse.json({ legalName: 'ИП Тест', address: 'Бишкек' })),
  // «Перерывы и выходные» (их видят и часы работы): по умолчанию нет; врач работает каждый день 09–18
  http.get('*/api/time-off', () => HttpResponse.json([])),
  // «Как оплатить мне» в карточке врача (V225): по умолчанию не заполнено, выручку собирает клиника
  http.get('*/api/doctors/:id/pay', () => HttpResponse.json({ hasQr: false, ownRevenue: false } satisfies Schemas['PayRequisitesDoctorPay'])),
  // «Телефон для пациентов» врача (V252): по умолчанию не указан
  http.get('*/api/doctors/:id/patient-phone', () => HttpResponse.json({} satisfies Schemas['DoctorServicePatientPhone'])),
  http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: (['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const)
    .map((weekday) => ({ weekday, start: '09:00:00', end: '18:00:00' })) } satisfies Schemas['DoctorHoursView'])),
  http.get('*/api/settings', () => HttpResponse.json({ clinicSignature: 'Стоматология «Тест»', reminderContact: 'CLINIC', doctorPhones: {} })),
  // Документы приёма и плана (src/print): по умолчанию у услуги памятки нет, квитанция пустая
  http.get('*/api/appointments/:id/care-memo', () => HttpResponse.json({ telegram: false, ky: false } satisfies Schemas['CareMemosAppointmentMemo'])),
  http.get('*/api/care-memos', () => HttpResponse.json([] satisfies Schemas['CareMemosCareMemoView'][])),
  http.get('*/api/care-memos/links', () => HttpResponse.json([] satisfies Schemas['CareMemosLink'][])),
  http.get('*/api/appointments/:id/receipt', () => HttpResponse.json({ payments: [], text: '', telegram: false, appointmentId: 0, paidSom: 0, debtSom: 0 } satisfies Schemas['ReceiptsReceiptView'])),
  // План с ценами (V140): по умолчанию не отправляли, у пациента в Mini App плана нет
  http.get('*/api/patients/:id/plan/offers', () => HttpResponse.json([] satisfies Schemas['PlanOffersOfferView'][])),
  http.get('*/api/patient/plans', () => HttpResponse.json([] satisfies Schemas['PlanOffersPatientPlan'][])),
  http.get('*/api/patients/:id/plan/message', () => HttpResponse.json({ text: '', telegram: false } satisfies Schemas['PatientMessage'])),
  // Метки пациентов (V239): по умолчанию у клиники только встроенная «ВИП» (свои тесты — tags/tags.test.tsx)
  http.get('*/api/patient-tags', () => HttpResponse.json([{ id: 1, code: 'VIP', name: 'ВИП', color: 'yellow', position: 10, patients: 0 }] satisfies Schemas['PatientTagsTag'][])),
)
