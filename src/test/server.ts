import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

/**
 * Фальшивый бэкенд для тестов: обработчики добавляет каждый тест (server.use). Здесь — только
 * фоновые запросы полосы «Сегодня» (склад, выручка, касса): пусто, если тест не задал своё.
 */
export const server = setupServer(
  http.get('*/api/supplies', () => HttpResponse.json([])),
  http.get('*/api/appointments/revenue', () => HttpResponse.json({ totalSom: 0, paidCount: 0, unpaidCount: 0, byMethod: {}, days: [] })),
  http.get('*/api/appointments/to-pay', () => HttpResponse.json([])),
)
