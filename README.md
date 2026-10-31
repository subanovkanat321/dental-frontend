# Tish — фронтенд

Интерфейс приложения записи к стоматологу. Сейчас — **CRM для работы за компьютером**:
расписание всех врачей, карточки сбоку, дальше — пациенты, касса и склад таблицами. Со временем
сюда переедет весь фронт из бэкенда (`static/js`): приложение сотрудников на телефоне и пациента. Бэкенд и Mini App —
репозиторий [`subanovkanat321/dental`](https://github.com/subanovkanat321/dental), решение —
его `docs/adr/0001-web-crm.md`.

- React 19 + TypeScript + Vite, данные — TanStack Query, запросы — `openapi-fetch` с типами из
  контракта `api/openapi.json` (копия `docs/api/openapi.json` бэкенда).
- Адрес на проде — `/crm/` того же домена, что и Mini App; вход — тот же («Войти через
  Telegram» на `/login`), cookie-сессия сайта.

## Команды

```bash
npm ci                 # зависимости
npm run dev            # http://localhost:5173/crm/ — нужен бэкенд на :8080 (./mvnw spring-boot:run в dental)
npm test               # Vitest + Testing Library + MSW
npm run lint && npm run typecheck && npm run build
npm run api:sync       # контракт из ../dental/docs/api/openapi.json → api/openapi.json и src/api/schema.d.ts
```

## Что готово

- [x] Каркас, CI, вход (401 → «Войти через Telegram»), раскладка: меню слева, рабочая область.
- [x] «Расписание»: день, все врачи колонками, статусы как в Mini App, карточка приёма справа (Esc — закрыть).
- [ ] Запись кликом в пустое место, действия в карточке (отметить, оплата), перенос мышкой.
- [ ] Пациенты таблицей, касса, «К оплате», долги, поиск и горячие клавиши, вход по QR.
