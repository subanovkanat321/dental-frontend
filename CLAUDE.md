# dental-frontend — инструкции для Claude

Фронтенд приложения записи к стоматологу (Tish): сейчас — CRM для компьютера (`/crm/`); по
плану сюда переедет весь фронт из бэкенда (`static/js`) по экрану, старый убираем, когда новый
умеет всё то же. Бэкенд — репозиторий
`subanovkanat321/dental` (Spring Boot, REST `/api`), решение — его `docs/adr/0001-web-crm.md`.
Владелец — Java-разработчик, учится фронтенду; код пишет Claude, объясняя решения. Общение на русском.

## Команды

- `npm ci`, `npm run dev` (http://localhost:5173/crm/, нужен бэкенд на :8080), `npm test`, `npm run lint`,
  `npm run typecheck`, `npm run build`.
- `npm run api:sync` — контракт из `../dental/docs/api/openapi.json` → `api/openapi.json` и `src/api/schema.d.ts`.

## Правила

- Запросы — только через `src/api/client.ts` (`api`, `unwrap`): он ставит заголовок `X-Dental-Web`
  (защита от CSRF у сайта) и превращает ошибки Problem Details в `ApiError`.
- Типы ответов не писать руками: `Schemas['...']` из сгенерированного `schema.d.ts`. Поменялся API —
  `npm run api:sync` в том же PR, что и код под него.
- Цену, сумму, наличие и права проверяет сервер; фронт — только показывает.
- Время в API — UTC; показываем по Бишкеку (`src/lib/time.ts`). Деньги — целые сомы.
- Персональные данные пациентов (имя, телефон, медданные) не писать в консоль, URL и localStorage.
  В скриншотах, тестах и роликах — только вымышленные пациенты: в проде настоящие.
- Тесты — Vitest + Testing Library + MSW (`src/test/server.ts`), ответы типизировать схемами контракта.
