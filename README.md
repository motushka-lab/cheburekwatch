# CheburekWatch

Совместный просмотр с realtime-синхронизацией, чатами, профилями, уровнями, титулами и достижениями.

## Архитектура

Проект является полноценным Node.js/Express-приложением. GitHub используется для хранения исходников и CI, а само приложение запускается как Node.js Web Service.

Для публичного запуска подготовлен `render.yaml`: Docker Web Service запускает сайт и официальный Local Telegram Bot API на общем persistent disk. База находится в `/var/data/db.json`, Telegram-файлы — в `/var/data/telegram`.

**Большие серии через Telegram:** [переход существующего Render-сервиса и настройка секретов](TELEGRAM_LARGE_FILES.md). Конфигурация предполагает 2 ГБ памяти и диск 20 ГБ; применение увеличивает оплату Render.

GitHub Pages для этого проекта не подходит: Pages не запускает Node.js/Express API и SSE.

## Локальный запуск

Требуется Node.js 18+.

```bash
npm ci
npm start
```

Открой:

```text
http://localhost:3000
```

Проверка сервера:

```text
http://localhost:3000/health
```

Локально база хранится в `data/db.json`. Этот файл специально добавлен в `.gitignore`, чтобы пользовательские данные никогда случайно не попали в GitHub.

## GitHub → Render

1. Создай пустой репозиторий GitHub.
2. Загрузи содержимое этого проекта в ветку `main`.
3. В Render создай Blueprint из этого репозитория.
4. Render использует `render.yaml`.
5. Будет создан Docker Web Service. Укажи `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_ID`, `TELEGRAM_API_ID` и `TELEGRAM_API_HASH` в Environment; контейнер запускает оба процесса.
6. Каталог `/var/data` будет подключён как persistent disk и передан приложению через `DATA_DIR=/var/data`.
7. После deploy сайт будет доступен по адресу `https://<имя-сервиса>.onrender.com`.

Подробная инструкция находится в `DEPLOY_GITHUB.md`.

## Возможности

- аккаунты и HttpOnly-сессии;
- комнаты и приглашения;
- удаление комнаты создателем;
- SSE realtime;
- play/pause/seek sync;
- YouTube, VK Video, mp4/webm/ogg;
- чат;
- уровни и время просмотра;
- префиксы/титулы;
- достижения;
- расширенный профиль;
- тёмно-красный glow UI.

## Production notes

Текущая версия рассчитана на один экземпляр Node.js и persistent disk. Это соответствует текущей SSE-архитектуре и не требует отдельного backend-домена или CORS.

Перед большим публичным запуском желательно перейти с JSON-файла на PostgreSQL и добавить rate limiting, CSRF/Origin checks и автоматические резервные копии.
