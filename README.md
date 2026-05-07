# creo-cleaner

Сервис автоматической очистки HTML5-креативов от запрещённой кликовой логики
перед загрузкой в рекламные платформы (Yandex, и т.п.).

Вход: ZIP-архив(ы) с креативом.
Выход: ZIP-архивы той же структуры, в которых нейтрализованы все клики,
анимации и canvas сохранены.

## Что удаляется

### HTML
- Теги `<a>` (включая обёртку всего креатива) — заменяются на `<div>` с
  сохранением содержимого и невредных атрибутов.
- Атрибуты `href`, `target`, `ping`, `rel`, `download` на `<a>`.
- Все inline-обработчики: `onclick`, `onmousedown`, `onmouseup`,
  `onpointerdown/up`, `ontouchstart/end` и пр. — со всех элементов.
- `clicktag`, `data-clicktag` атрибуты.

> Раньше cleaner также инжектил
> `html, body, body * { pointer-events: none !important; ... }` как
> страховку. Это убрано: на платформах которые сами оборачивают креос
> click-overlay'ем (Adfox / MyTarget / DSPs), клик ожидает bubble или
> прохождение сквозь DOM креатива, а `pointer-events:none` гасил его на
> старте. Замена `<a>→<div>` + вычистка JS-API навигации достаточны для
> "no internal click logic" без поломки внешнего click-tracker'а.

### JavaScript (через Babel AST, surgical edits — без минификации)
- `addEventListener('click'|'mousedown'|...)` и аналогичные
  `removeEventListener`, `.on(...)`, `.bind(...)`, `.one(...)`, etc.
- `window.open(...)`, `self.open()`, `top.open()`, `parent.open()`.
- `getClickURL()`, `getClickTag()`, `getClickURLNum(...)` — как голые
  идентификаторы, так и в составе `*.getClickURLNum(0)` (Яндекс API).
- `el.onclick = ...`, `el.onmousedown = ...` и любые
  `on{click,mousedown,mouseup,pointerdown,pointerup,touchstart,touchend,tap}`.
- `location.href = ...`, `window.location = ...`, `document.location = ...`,
  `location.assign(...)`, `location.replace(...)`.
- `el.style.cursor = "pointer"`.
- `clickTag = "..."` / `clickTAG = "..."` — присваивания и инициализаторы
  переменных (значение обнуляется до пустой строки, чтобы хост, который
  обращается к этой переменной, не сломался).

### CSS
- Декларации `cursor: pointer` (включая `!important`) — и в `<style>`,
  и в `.css` файлах.

## Что НЕ трогается

- Изображения, шрифты, JSON, аудио, видео и любые не-HTML/JS/CSS ассеты.
- Анимация (`requestAnimationFrame`, GSAP-tweens, CreateJS-таймлайны).
- Canvas-рисование, layout, неинтерактивные DOM-структуры.
- JS-форматирование: правки точечные, через диапазоны исходника, без
  пересборки кода через генератор.

## Запуск

```bash
cd C:\Users\suici\Desktop\GitHub\creo
npm install
npm start
```

Откройте http://localhost:3000 — UI с drag-and-drop. Можно загружать
несколько архивов одновременно.

### REST API

```
POST /api/clean
  multipart/form-data, поле "files" (можно несколько)
  -> JSON: { batchId, bulkDownloadUrl, results: [{ id, originalName, cleanedName,
              bytesIn, bytesOut, report, downloadUrl }, ...] }

GET /api/download/:batchId/:archiveId    — скачать один очищенный архив
GET /api/download-all/:batchId           — скачать все архивы пакетом (zip-of-zips)
GET /healthz                             — health-check
```

Архивы хранятся в памяти и удаляются через 30 минут после загрузки.

### CLI вариант через curl

```bash
curl -F "files=@creative1.zip" -F "files=@creative2.zip" http://localhost:3000/api/clean
```

## Тесты

```bash
npm test
```

Покрывает: HTML-замену `<a>`, удаление inline-обработчиков, AST-удаление
click-API, end-to-end ZIP, защиту от zip-slip, обработку «архив без
кликов».

## Пример «было / стало»

### Было (`index.html`)
```html
<!doctype html>
<html>
  <head>
    <style>.btn { cursor: pointer; }</style>
  </head>
  <body>
    <a href="https://track.example/c?id=42" target="_blank" onclick="trackClick()">
      <canvas id="canvas" width="300" height="250"></canvas>
    </a>
    <script>
      var clickTag = "https://track.example/c?id=42";
      document.querySelector('a').addEventListener('click', function () {
        window.open(yandexHTML5BannerApi.getClickURLNum(0), '_blank');
      });
      requestAnimationFrame(function tick(){ /* анимация */ requestAnimationFrame(tick); });
    </script>
  </body>
</html>
```

### Стало
```html
<!doctype html>
<html>
  <head>
    <style>.btn { }</style>
  </head>
  <body>
    <div>
      <canvas id="canvas" width="300" height="250"></canvas>
    </div>
    <script>
      var clickTag = "";

      requestAnimationFrame(function tick(){ /* анимация */ requestAnimationFrame(tick); });
    </script>
  </body>
</html>
```

Отчёт по этому кейсу:
```
- index.html [html]: <a> -> <div>, onclick, href, target
- index.html [html] inline-script: addEventListener("click"), *.getClickURLNum(), window.open, var clickTag = ...
- index.html [html] inline-style: cursor: pointer removed
```

## Архитектура

```
creo/
├── server.js                  # Express + multer + endpoints
├── public/                    # web UI: drag-drop, multi-file
│   ├── index.html
│   ├── style.css
│   └── app.js
└── src/cleaner/
    ├── index.js               # pipeline: распаковка → cleaners → упаковка
    ├── zipHandler.js          # ZIP, защита от zip-slip
    ├── htmlCleaner.js         # cheerio (parse5/htmlparser2)
    ├── jsCleaner.js           # @babel/parser + traverse, surgical edits
    └── cssCleaner.js          # rule-based regex
```

### Принципы реализации
- HTML — настоящий парсер (cheerio), не regex.
- JS — AST: парсим, обходим, собираем диапазоны узлов для удаления,
  применяем правки на исходной строке от конца к началу. Это сохраняет
  оригинальное форматирование и не требует генератора.
- ZIP — entry-by-entry с проверкой пути (path traversal / zip-slip).
- Чистый pipeline: каждый файл → один из трёх cleaners по расширению,
  иначе байт-в-байт.

## Краевые случаи (поведение)

| Случай | Поведение |
| --- | --- |
| Несколько HTML-файлов | Все обрабатываются. |
| Вложенные обработчики (a > div onclick) | Снимаются и `<a>`, и handler на `<div>`. |
| Логика в HTML и JS одновременно | Оба пути закрыты на уровне DOM и AST. |
| Повреждённый JS | Файл оставляется как есть, в отчёт пишется warning. |
| Архив без кликов | Возвращается без изменений. |
| zip-slip (`../evil`) | Архив отклоняется с ошибкой. |

## Известные ограничения

- Динамически собираемые URL/обработчики через `eval`, `new Function`,
  string-concat атрибутов — не ловятся (как и любым статическим анализом).
  Если креатив пытается обойти AST через runtime-склейку строк, такие
  вызовы пройдут.
- Если внешняя библиотека (CreateJS, GSAP) ловит клики через
  `stage.on('click', ...)` — мы это удалим (любой `.on('click', ...)`
  снимается). Если используется кастомный диспетчер событий с другим
  именем метода — добавьте его в `EVENT_BIND_METHODS` в
  `src/cleaner/jsCleaner.js`.
