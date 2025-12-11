# Motivation Bot

Telegram бот для мотивации, построенный на Grammy, XState, PostgreSQL и Redis.

## Технологии

- **Grammy** - фреймворк для Telegram ботов
- **XState** - управление состоянием сцен
- **PostgreSQL** - база данных пользователей
- **Drizzle ORM** - работа с БД
- **Redis** - хранение состояний пользователей
- **Winston** - логирование
- **TypeScript** - типобезопасность

## Установка

1. Установите зависимости:
```bash
npm install
```

2. Скопируйте `.env.example` в `.env` и заполните переменные:
```bash
cp .env.example .env
```

3. Запустите базы данных через Docker:
```bash
docker-compose up -d
```

4. Сгенерируйте миграции (если нужно):
```bash
npm run db:generate
```

5. Запустите бота (миграции применятся автоматически при старте):
```bash
npm run dev
```

**Примечание:** При первом запуске миграции применятся автоматически. Если вы изменили схему БД, сначала запустите `npm run db:generate`, а затем перезапустите бота.

## Структура проекта

```
src/
├── bot/           # Конфигурация Grammy бота
├── scenes/        # Сцены бота
├── state/         # XState машина состояний
├── database/      # Drizzle схемы и миграции
├── redis/         # Redis клиент
├── services/      # Бизнес-логика
└── utils/         # Утилиты (логгер, env)
```

## Команды

- `npm run dev` - запуск в режиме разработки
- `npm run build` - сборка проекта
- `npm run start` - запуск собранного проекта
- `npm run db:generate` - генерация миграций
- `npm run db:migrate` - применение миграций
- `npm run db:studio` - открыть Drizzle Studio

