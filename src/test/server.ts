import { setupServer } from 'msw/node'

/** Фальшивый бэкенд для тестов: обработчики добавляет каждый тест (server.use). */
export const server = setupServer()
