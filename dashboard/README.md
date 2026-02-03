# Motivation Bot Dashboard

Дашборд для просмотра статистики и данных Motivation Bot.

## Локальный запуск

```bash
# Установка зависимостей
npm install

# Создайте .env с DATABASE_URL (скопируйте из .env.example)
# DATABASE_URL=postgresql://postgres:password@localhost:5432/motivation_bot

# Режим разработки (порт 3001)
npm run dev

# Сборка
npm run build

# Production (порт 3000)
npm run start
```

## Аутентификация

- **Логин:** toha
- **Пароль:** krasava

При первом заходе браузер запросит учётные данные (HTTP Basic Auth).

## Docker

Дашборд собирается и запускается вместе с ботом через `docker-compose.prod.yml`:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Доступ: http://localhost:3000 (или IP вашего сервера).
