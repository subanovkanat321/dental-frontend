# 3D-модели атласа

Все модели, которые сейчас в атласе, **процедурные** — построены кодом в браузере, файлов моделей нет:

- зуб в разрезе (моляр 36/46, слои, кариес, каналы, пломба, коронка, имплант) — `src/atlas/geometry/toothModel.ts`;
- зубы челюсти по типам и дуга из 32 зубов — `src/atlas/geometry/jawModel.ts`;
- сосуды, нерв, эндодонтический файл, имплант, абатмент — `src/atlas/engine/toothScene.ts`.

Авторские права — Tish; атрибуция не нужна.

## Модели с Wikimedia Commons (проверены, пока не используются)

Лицензии проверены через API Commons (`prop=imageinfo&iiprop=url|extmetadata|size`, 2026-11-05):

| Файл | Размер | Лицензия | Автор |
|---|---|---|---|
| [3D partial human mandible with teeth.stl](https://commons.wikimedia.org/wiki/File:3D_partial_human_mandible_with_teeth.stl) | 15,5 МБ | CC BY 4.0 | boosty (embodi3d.com) |
| [3D model of the human mouth.stl](https://commons.wikimedia.org/wiki/File:3D_model_of_the_human_mouth.stl) | 2,3 МБ | CC BY 4.0 | Mince (Sketchfab) |
| [BodyParts3D Tooth.stl](https://commons.wikimedia.org/wiki/File:BodyParts3D_Tooth.stl) | 2,0 МБ | CC BY-SA 2.1 JP | Database Center for Life Science (DBCLS), BodyParts3D |
| [Zahn 20230620 001.stl](https://commons.wikimedia.org/wiki/File:Zahn_20230620_001.stl) | 1,2 МБ | CC0 | PantheraLeo1359531 |

Все четыре по лицензии подходят, но скачать их не удалось: `upload.wikimedia.org` отвечал 429
(Too Many Requests) на все попытки с паузами до 5 минут. Поэтому челюсть сделана процедурной
(как и было предусмотрено запасным вариантом).

Если модель подключат позже: положить в `public/atlas/` (грузится лениво, не в бандл), суммарно
≤ 3–4 МБ (STL → GLB с квантованием: `npx @gltf-transform/cli`), и указать атрибуцию здесь и мелко в
интерфейсе: «Модель: автор, лицензия, Wikimedia Commons». Для CC BY-SA (BodyParts3D) изменённая
модель распространяется под той же лицензией.
