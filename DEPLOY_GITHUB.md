# Деплой CheburekWatch через GitHub

## Важный момент

Это не статический сайт. GitHub Pages не запускает Node.js/Express API, авторизацию и SSE, поэтому проект должен запускаться как Node.js Web Service. GitHub при этом остаётся репозиторием исходников.

В репозитории уже есть `render.yaml`, поэтому после загрузки кода можно создать Render Blueprint из репозитория.

## 1. GitHub

Создай новый пустой репозиторий и загрузить в него **содержимое этой папки**, включая:

```text
server.js
package.json
package-lock.json
public/
render.yaml
.github/
```

Не загружай:

```text
node_modules/
.env
data/db.json
```

`data/db.json` добавлен в `.gitignore`, поэтому пользовательские данные не должны попасть в Git.

## 2. Render

В Render выбери создание Blueprint из GitHub-репозитория.

`render.yaml` настроит:

- Node.js Web Service;
- `npm ci` как build command;
- `npm start` как start command;
- `/health` как health check;
- `NODE_ENV=production`;
- persistent disk размером 1 GB;
- `DATA_DIR=/var/data`.

Persistent disk нужен, потому что без него изменения файловой системы Render теряются при redeploy/restart. Текущая версия приложения хранит данные в `data/db.json`.

## 3. После deploy

Открой URL сервиса и проверь:

```text
/health
```

Должен вернуться:

```json
{"ok":true}
```

Затем проверь регистрацию, создание комнаты, открытие комнаты во второй вкладке, play/pause и чат.

## 4. Важная особенность бесплатного запуска

У Render Free есть ограничения, включая остановку неактивного Web Service. Persistent disk на Free Web Service недоступен, поэтому `render.yaml` использует платный Web Service с диском. Если нужна полностью бесплатная тестовая версия, можно временно убрать disk, но тогда `data/db.json` не является постоянным хранилищем.

## 5. Домен

После проверки можно подключить собственный домен непосредственно к Render. Frontend и `/api` остаются на одном origin, поэтому текущая HttpOnly-cookie авторизация продолжает работать без CORS.

## 6. Обновления

После изменения кода:

```text
GitHub commit/push → Render automatic deploy → npm ci → npm start
```

`.github/workflows/check.yml` дополнительно проверяет синтаксис Node.js-файлов на каждом push и pull request.
