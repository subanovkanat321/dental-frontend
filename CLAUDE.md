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

## Design System
Read DESIGN.md before visual or UI work: it defines the fonts, colors, spacing, and
aesthetic direction. Ask the user before departing from it. When reviewing or QA-ing
UI, flag code that doesn't match DESIGN.md.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. Route only to skills in the session's available-skills list; answer directly for quick questions or small scoped edits.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
