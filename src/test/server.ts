import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

/**
 * Фальшивый бэкенд для тестов: обработчики добавляет каждый тест (server.use). Здесь — только
 * фоновые запросы полосы «Сегодня» (склад, выручка, касса) и карточки приёма (материалы, услуги): пусто, если тест не задал своё.
 */
export const server = setupServer(
  http.get('*/api/supplies', () => HttpResponse.json([])),
  http.get('*/api/appointments/revenue', () => HttpResponse.json({ totalSom: 0, paidCount: 0, unpaidCount: 0, byMethod: {}, days: [] })),
  http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
  http.get('*/api/appointments/report', () => HttpResponse.json([])),
  http.get('*/api/appointments/:id/supplies', () => HttpResponse.json([])),
  http.get('*/api/service-types', () => HttpResponse.json([])),
  http.get('*/api/waitlist', () => HttpResponse.json([])),
  http.get('*/api/appointments/:id/note', () => HttpResponse.json({ note: '' })),
  http.get('*/api/patients/:id/anamnesis', () => HttpResponse.json({ items: [] })),
  // Напоминания админу (AdminNotices): по умолчанию всё в порядке — напоминаний нет
  http.get('*/api/clinic/billing', () => HttpResponse.json({ state: 'FREE' })),
  http.get('*/api/clinic/agreement', () => HttpResponse.json({ scans: [] })),
  http.get('*/api/clinic', () => HttpResponse.json({ legalName: 'ИП Тест', address: 'Бишкек' })),
  http.get('*/api/settings', () => HttpResponse.json({ clinicSignature: 'Стоматология «Тест»' })),
)
