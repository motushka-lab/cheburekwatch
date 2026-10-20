# Развёртывание на Render

[Вернуться к README](../README.md)

Конфигурация находится в [render.yaml](../render.yaml). Docker-контейнер запускает Node.js/Express-сайт и официальный Local Telegram Bot API. База сохраняется в `/var/data/db.json`, файлы Telegram — в `/var/data/telegram` на том же постоянном диске.

| Параметр | Значение в конфигурации |
| --- | --- |
| Runtime | Docker |
| Dockerfile | `./Dockerfile` |
| Docker Command | Пусто; используется команда из Dockerfile |
| Health check | `/health` |
| План | `1c-2g`, 1 CPU / 2 ГБ памяти |
| Диск | `cheburekwatch-data`, 20 ГБ, путь `/var/data` |
| Переменная `DATA_DIR` | `/var/data` |

Это платная конфигурация. Перед применением проверь её стоимость в Render.

## Настройка и переход

Следуй [инструкции больших Telegram-файлов](telegram-large-files.md): она описывает получение API ID/hash, переменные Environment, переход существующего сервиса на Docker и проверку загрузки видео.

Сохраняй существующий сервис, диск и путь `/var/data`: там находятся пользователи, сессии, комнаты, сообщения и библиотека. Обновляй подключённую ветку `main`; если сервис управляется Blueprint, применяй `render.yaml` через синхронизацию этого Blueprint.

Для бота нужны `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_ID`, `TELEGRAM_API_ID` и `TELEGRAM_API_HASH`. Их значения вводятся непосредственно в Render Environment.

## Проверка после деплоя

Открой `https://<адрес-сервиса>/health`: ожидается `{"ok":true}`. Затем проверь вход, создание комнаты, видео, синхронизацию во второй вкладке и чат.

GitHub Actions проверяет код, интеграционные тесты, сборку Docker и запуск `/health`. Настоящая доставка больших файлов проверяется после добавления секретов и деплоя.
