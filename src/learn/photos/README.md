# Фото для презентаций «Показать пациенту»

Настоящие фото и медицинские иллюстрации к слайдам. Где фото нет — показывается свой SVG-рисунок
(`src/learn/art.tsx`). Список того, что уже лежит здесь, с авторами и лицензиями — `CREDITS.md`.

## Требования

- **Лицензия** — только свободная, с разрешённым коммерческим использованием: CC0, Public domain,
  CC BY, CC BY-SA. Не брать: GFDL-only, CC BY-NC, CC BY-ND, «fair use», файлы без явной лицензии.
  Лицензию брать со страницы файла (у Wikimedia — из API: `LicenseShortName`, `Artist`,
  `AttributionRequired`).
- **Содержание** — спокойно и профессионально: рентгеновские снимки, схемы, модели, инструменты,
  чистые клинические фото зубов. Без лиц и узнаваемых людей, без крови, ран и «страшных» фото.
  Медицинская иллюстрация лучше пугающего снимка.
- **Файл** — JPEG или WebP, до ~1200 px по длинной стороне и до ~150 КБ. Брать уменьшенную копию
  (у Wikimedia — `iiurlwidth`), не оригинал.
- **Не на каждый слайд**: 1–2 фото на тему, только где фото понятнее рисунка.

## Где искать

- Wikimedia Commons (https://commons.wikimedia.org) — запросы: `root canal radiograph`,
  `Zahnfilm Wurzelfüllung`, `dental implant`, `X-ray dental implant`, `panoramic radiograph wisdom tooth`,
  `ultrasonic scaler`, `dental instruments`, `zirconia crown`, `VITA shade guide`, `dental sealant`,
  `gingivitis`, `dental caries bitewing`. Wikimedia просит User-Agent с контактом и не чаще
  1 запроса в 1–2 секунды.
- Servier Medical Art (https://smart.servier.com) — медицинские иллюстрации, CC BY 4.0, атрибуция
  «Servier Medical Art, CC BY 4.0».

## Как добавить фото к слайду

1. Положить файл сюда: `src/learn/photos/<тема>-<что>.jpg` (например `canals-xray.jpg`).
2. В `src/learn/topics.tsx` импортировать его (Vite отдаст адрес с хешем) и дописать слайду поле
   `photo` — оно есть у слайдов `what`, `stages` и `list`:

   ```tsx
   import canalsXray from './photos/canals-xray.jpg'

   { kind: 'list', title: T.care, art: …, photo: {
     src: canalsXray,
     alt: { ru: 'Рентген: запломбированные каналы зуба', ky: 'Рентген: пломбаланган тиш каналдары' },
     credit: { author: 'Svonf', license: 'CC BY-SA 3.0', source: 'Wikimedia Commons',
       url: 'https://commons.wikimedia.org/wiki/File:…' },
   }, points: [ … ] }
   ```

   Фото встаёт на место рисунка; под ним мелко: «Фото: автор, лицензия, источник» — ссылкой на
   страницу файла (для CC BY и CC BY-SA ссылка обязательна). Рисунок (`art`) оставить: он — запас и
   обложка.
3. Дописать строку в `CREDITS.md`: файл → страница источника, автор, лицензия, что изменено (уменьшено,
   обрезано).
4. Проверить слайд на телефоне и планшете: фото не обрезается, подпись читается.
