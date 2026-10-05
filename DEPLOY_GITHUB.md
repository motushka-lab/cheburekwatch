# Деплой CheburekWatch через GitHub

## Важный момент

Это не статический сайт. GitHub Pages не запускает Node.js/Express API, авторизацию и SSE. Проект запускается как Docker Web Service вместе с Local Telegram Bot API. GitHub остаётся репозиторием исходников.

Если CheburekWatch уже работает на Render, используй [инструкцию обновления существующего сервиса](TELEGRAM_LARGE_FILES.md), чтобы сохранить его базу и диск.

В репозитории уже есть `render.yaml`, поэтому после загрузки кода можно создать Render Blueprint из репозитория.

## 1. GitHub

Создай новый пустой репозиторий и загрузить в него **содержимое этой папки**, включая:

```text
server.js
package.json
package-lock.json
public/
render.yaml
Dockerfile
scripts/
lib/
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

- Docker Web Service с сайтом и Local Telegram Bot API;
- сборку официального Telegram API и установку npm-зависимостей;
- `node scripts/start-container.js` как команду контейнера;
- `/health` как health check;
- `NODE_ENV=production`;
- 2 ГБ памяти и persistent disk размером 20 ГБ (платная конфигурация);
- `DATA_DIR=/var/data`.

Persistent disk нужен, потому что без него изменения файловой системы Render теряются при redeploy/restart. Текущая версия приложения хранит данные в `data/db.json`.

Для бота нужны четыре секрета: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_ID`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`. Их вводят в Render Environment; в GitHub их не сохраняют.

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
GitHub commit/push → Render automatic deploy → Docker build → сайт + Local Bot API
```

`.github/workflows/check.yml` дополнительно проверяет синтаксис Node.js-файлов на каждом push и pull request.
