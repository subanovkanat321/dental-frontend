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
  http.get('*/api/supplies', () => HttpResponse.json([])),
  // Уведомления в приложение: по умолчанию на сервере не включены — блок в «Настройках» скрыт
  http.get('*/api/push', () => HttpResponse.json({ enabled: false, channel: 'TELEGRAM', devices: [] })),
  http.get('*/api/patient-sources', () => HttpResponse.json(SOURCES)),
  // Промокоды (V122): по умолчанию у клиники их нет
  http.get('*/api/promo-codes', () => HttpResponse.json([])),
  http.get('*/api/appointments/promo-codes', () => HttpResponse.json({ rows: [], money: false })),
  http.get('*/api/appointments/revenue', () => HttpResponse.json({ totalSom: 0, paidCount: 0, unpaidCount: 0, byMethod: {}, days: [] })),
  http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
  // «Мой заработок» — по умолчанию нет (как у админа без кресла): тесты своих экранов не видят лишний чип
  http.get('*/api/me/earnings', () => HttpResponse.json({ status: 403, title: 'Forbidden' }, { status: 403 })),
  http.get('*/api/appointments/report', () => HttpResponse.json([])),
  http.get('*/api/appointments/:id/supplies', () => HttpResponse.json([])),
  http.get('*/api/appointments/:id/supplies/suggested', () => HttpResponse.json([])),
  http.get('*/api/service-types/:id/supplies', () => HttpResponse.json([])),
  http.get('*/api/supplies/starter', () => HttpResponse.json({ missing: [], services: [] })),
  http.get('*/api/care-memos/starter', () => HttpResponse.json([])),
  http.get('*/api/families', () => HttpResponse.json([])),
  http.get('*/api/comebacks', () => HttpResponse.json({ patients: [], planSom: 0, planPatients: 0, noShows: 0, recalls: 0 })),
  http.get('*/api/comebacks/result', () => HttpResponse.json({ invited: 0, returned: 0, returnedPlanSom: 0, paidSom: 0 })),
  http.get('*/api/appointments/:id/visit-report', () => new HttpResponse(null, { status: 204 })),
  http.get('*/api/patients/:id/family', () => new HttpResponse(null, { status: 204 })),
  http.get('*/api/service-types', () => HttpResponse.json([])),
  http.get('*/api/appointments/:id/payments', () => HttpResponse.json([])),
  http.get('*/api/waitlist', () => HttpResponse.json([])),
  // График смен (V150): по умолчанию смен нет — в «Сводке дня» строки «На смене» нет
  http.get('*/api/shifts', () => HttpResponse.json({ people: [], shifts: [], canEdit: false, me: 0 } satisfies Schemas['ShiftControllerSchedule'])),
  // Вопросы пациентов (V142): по умолчанию новых нет — бейджа у «Пациентов» нет
  http.get('*/api/patient-questions/new-count', () => HttpResponse.json({ count: 0 } satisfies Schemas['QuestionControllerNewCount'])),
  http.get('*/api/slots', () => HttpResponse.json({ workingDay: true, starts: [], free: [], breaks: [] })),
  http.get('*/api/appointments/:id/note', () => HttpResponse.json({ note: '' })),
  http.get('*/api/patients/:id/notes', () => HttpResponse.json([])),
  http.get('*/api/patients/:id/plan', () => HttpResponse.json([] satisfies Schemas['TreatmentStepView'][])),
  http.get('*/api/patients/:id/expenses', () => HttpResponse.json([])),
  http.get('*/api/patients/:id/anamnesis', () => HttpResponse.json({ items: [] })),
  // Согласие на публикацию фото (V139): по умолчанию его нет — «До / после» выключена
  http.get('*/api/patients/:id/files', () => HttpResponse.json([] satisfies Schemas['PatientFilesView'][])),
  http.get('*/api/patients/:id/publication-consent', () => HttpResponse.json({} satisfies Schemas['PublicationConsentsView'])),
  // Опрос команды Tish (src/survey): по умолчанию ответа никто не ждёт — приглашения нет
  http.get('*/api/surveys/current', () => HttpResponse.json({} satisfies Schemas['SurveyAnswersCurrent'])),
  // Напоминания админу (AdminNotices): по умолчанию всё в порядке — напоминаний нет
  http.get('*/api/clinic/billing', () => HttpResponse.json({ state: 'FREE' })),
  http.get('*/api/clinic/agreement', () => HttpResponse.json({ scans: [] })),
  http.get('*/api/clinic', () => HttpResponse.json({ legalName: 'ИП Тест', address: 'Бишкек' })),
  http.get('*/api/settings', () => HttpResponse.json({ clinicSignature: 'Стоматология «Тест»' })),
  // Документы приёма и плана (src/print): по умолчанию у услуги памятки нет, квитанция пустая
  http.get('*/api/appointments/:id/care-memo', () => HttpResponse.json({ telegram: false } satisfies Schemas['CareMemosAppointmentMemo'])),
  http.get('*/api/care-memos', () => HttpResponse.json([] satisfies Schemas['CareMemosCareMemoView'][])),
  http.get('*/api/care-memos/links', () => HttpResponse.json([] satisfies Schemas['CareMemosLink'][])),
  http.get('*/api/appointments/:id/receipt', () => HttpResponse.json({ payments: [], text: '', telegram: false } satisfies Schemas['ReceiptsReceiptView'])),
  // План с ценами (V140): по умолчанию не отправляли, у пациента в Mini App плана нет
  http.get('*/api/patients/:id/plan/offers', () => HttpResponse.json([] satisfies Schemas['PlanOffersOfferView'][])),
  http.get('*/api/patient/plans', () => HttpResponse.json([] satisfies Schemas['PlanOffersPatientPlan'][])),
  http.get('*/api/patients/:id/plan/message', () => HttpResponse.json({ text: '', telegram: false } satisfies Schemas['PatientMessage'])),
)
