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

/**
 * Фальшивый бэкенд для тестов: обработчики добавляет каждый тест (server.use). Здесь — только
 * фоновые запросы полосы «Сегодня» (склад, выручка, касса) и карточки приёма (материалы, услуги): пусто, если тест не задал своё.
 */
export const server = setupServer(
  // Отчёты об ошибках приложения (lib/clientErrors): сервер всегда отвечает 204
  http.post('*/web/client-error', () => new HttpResponse(null, { status: 204 })),
  http.get('*/api/supplies', () => HttpResponse.json([])),
  // Долги из прежней программы (шаблон переезда): по умолчанию нет — блока в «Должниках» и карточке пациента нет
  http.get('*/api/opening-debts', () => HttpResponse.json([] satisfies Schemas['OpeningDebtsView'][])),
  // Подсказка «🪑 время коллеги по креслу» в «Новой записи» и переносе: по умолчанию коллеги в это время нет
  http.get('*/api/appointments/chair-check', () => HttpResponse.json({ strict: false } satisfies Schemas['ChairCheckView'])),
  // Кейс на /join не заполнен — блока нет; черновик в «Платформа → Настройки» — пустой
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
  // «Пароль и вход»: по умолчанию вошли через Telegram — блока нет
  http.get('*/api/me/name', () => HttpResponse.json({ fullName: 'Айпери', editable: true } satisfies Schemas['StaffMembersOwnName'])),
  http.get('*/api/me/password', () => HttpResponse.json({ phoneLogin: false, passwordSet: false, temporary: false, sms: false, telegram: false, telegramCode: false } satisfies Schemas['PasswordControllerPasswordState'])),
  // Сведения о платформе: по умолчанию пусто — группы врачей в «Помощи» нет (её тест — layout/helpFab.test.tsx)
  http.get('*/api/platform-info', () => HttpResponse.json({ accessLog: false, accessNotify: false, accessRequiresGrant: false } satisfies Schemas['PlatformInfoInfo'])),
  // Тур при первом входе: по умолчанию уже пройден — не закрывает экраны остальных тестов (тесты тура — tour/tour.test.tsx)
  http.get('*/api/me/tour', () => HttpResponse.json({ seenAt: '2026-11-01T06:00:00Z' } satisfies Schemas['StaffTourTourView'])),
  http.put('*/api/me/tour', () => HttpResponse.json({ seenAt: '2026-11-01T06:00:00Z' } satisfies Schemas['StaffTourTourView'])),
  // Код на свой номер не ждём (шаг «Код» в «Пароль и вход» после перезагрузки — свои тесты)
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
  http.get('*/api/appointments/revenue', () => HttpResponse.json({ totalSom: 0, paidCount: 0, unpaidCount: 0, byMethod: {}, days: [] })),
  http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
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
  // График смен (V150): по умолчанию смен нет — в «Сводке дня» строки «На смене» нет
  http.get('*/api/shifts', () => HttpResponse.json({ people: [], shifts: [], canEdit: false, me: 0 } satisfies Schemas['ShiftControllerSchedule'])),
  // Вопросы пациентов (V142): по умолчанию новых нет — бейджа у «Пациентов» нет
  http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 0 } satisfies Schemas['QuestionControllerNewCount'])),
  // Кресла (V185): по умолчанию у клиники их нет — значков и штриховки «кресло занято» нет
  http.get('*/api/chairs', () => HttpResponse.json([] satisfies Schemas['ChairOverview'][])),
  // «Персонал»: по умолчанию сотрудников без кресла и приглашений нет — только врачи
  http.get('*/api/members', () => HttpResponse.json([] satisfies Schemas['StaffMembersMemberView'][])),
  http.get('*/api/members/invites', () => HttpResponse.json([] satisfies Schemas['StaffMembersInviteView'][])),
  http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [], free: [], breaks: [] })),
  http.get('*/api/appointments/:id/note', () => HttpResponse.json({ note: '' })),
  http.get('*/api/patients/:id/notes', () => HttpResponse.json([])),
  // «Зубы этого приёма» и история зубов по визитам (V155): по умолчанию ничего не отмечено
  http.get('*/api/appointments/:id/teeth', () => HttpResponse.json([] satisfies Schemas['VisitToothView'][])),
  http.get('*/api/patients/:id/teeth/history', () => HttpResponse.json([] satisfies Schemas['VisitTeethView'][])),
  http.get('*/api/patients/:id/plan', () => HttpResponse.json([] satisfies Schemas['TreatmentStepView'][])),
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
  http.get('*/api/clinic/billing', () => HttpResponse.json({ state: 'FREE' })),
  http.get('*/api/clinic/agreement', () => HttpResponse.json({ scans: [] })),
  http.get('*/api/clinic', () => HttpResponse.json({ legalName: 'ИП Тест', address: 'Бишкек' })),
  // «Перерывы и выходные» (их видят и часы работы): по умолчанию нет; врач работает каждый день 09–18
  http.get('*/api/time-off', () => HttpResponse.json([])),
  http.get('*/api/doctors/:id/hours', () => HttpResponse.json({ custom: false, days: (['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const)
    .map((weekday) => ({ weekday, start: '09:00:00', end: '18:00:00' })) } satisfies Schemas['DoctorHoursView'])),
  http.get('*/api/settings', () => HttpResponse.json({ clinicSignature: 'Стоматология «Тест»' })),
  // Документы приёма и плана (src/print): по умолчанию у услуги памятки нет, квитанция пустая
  http.get('*/api/appointments/:id/care-memo', () => HttpResponse.json({ telegram: false, ky: false } satisfies Schemas['CareMemosAppointmentMemo'])),
  http.get('*/api/care-memos', () => HttpResponse.json([] satisfies Schemas['CareMemosCareMemoView'][])),
  http.get('*/api/care-memos/links', () => HttpResponse.json([] satisfies Schemas['CareMemosLink'][])),
  http.get('*/api/appointments/:id/receipt', () => HttpResponse.json({ payments: [], text: '', telegram: false, appointmentId: 0, paidSom: 0, debtSom: 0 } satisfies Schemas['ReceiptsReceiptView'])),
  // План с ценами (V140): по умолчанию не отправляли, у пациента в Mini App плана нет
  http.get('*/api/patients/:id/plan/offers', () => HttpResponse.json([] satisfies Schemas['PlanOffersOfferView'][])),
  http.get('*/api/patient/plans', () => HttpResponse.json([] satisfies Schemas['PlanOffersPatientPlan'][])),
  http.get('*/api/patients/:id/plan/message', () => HttpResponse.json({ text: '', telegram: false } satisfies Schemas['PatientMessage'])),
)
