# Инструкция по деплою Motivation Bot

## Подготовка к деплою

### 1. Требования

- Docker и Docker Compose установлены на сервере
- Доступ к серверу (SSH)
- Telegram Bot Token от [@BotFather](https://t.me/BotFather)

### 2. Переменные окружения

Создайте файл `.env` в корне проекта со следующими переменными:

```env
# Telegram Bot Token (обязательно)
BOT_TOKEN=your_bot_token_here

# PostgreSQL (обязательно)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=motivation_bot

# Redis (обязательно)
REDIS_PASSWORD=your_redis_password_here

# Опционально
LOG_LEVEL=info  # error, warn, info, debug
```

**⚠️ ВАЖНО:** Не коммитьте файл `.env` в Git! Он должен быть в `.gitignore`.

### 3. Подготовка сервера

#### На сервере выполните:

```bash
# Обновите систему
sudo apt update && sudo apt upgrade -y

# Установите Docker (если не установлен)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Установите Docker Compose (если не установлен)
sudo apt install docker-compose-plugin -y

# Добавьте пользователя в группу docker (чтобы не использовать sudo)
sudo usermod -aG docker $USER
# Выйдите и войдите снова для применения изменений
```
ssh motivationBot@212.41.28.147
## Деплой на сервер

### Вариант 1: Деплой через Docker Compose (рекомендуется)

1. **Клонируйте репозиторий на сервер:**

```bash
git clone https://github.com/petruhinmaxim/motivation-bot motivation-bot

cd motivation-bot
```

2. **Создайте файл `.env`:**

```bash
nano .env
# Вставьте переменные окружения (см. выше)
```

3. **Соберите и запустите контейнеры:**

```bash
# Соберите образы
docker compose -f docker-compose.prod.yml build

# Запустите сервисы
docker compose -f docker-compose.prod.yml up -d

# Проверьте статус
docker compose -f docker-compose.prod.yml ps

# Просмотрите логи
docker compose -f docker-compose.prod.yml logs -f bot
```

4. **Дашборд** доступен по адресу `http://<ваш-сервер>:3000`:
   - Логин: `toha`
   - Пароль: `krasava`

5. **Проверьте работу бота:**

```bash
# Проверьте логи на наличие ошибок
docker compose -f docker-compose.prod.yml logs bot

# Проверьте, что бот запущен
docker compose -f docker-compose.prod.yml ps
```

### Вариант 2: Деплой только приложения (если БД и Redis уже есть)

Если у вас уже есть PostgreSQL и Redis на сервере:

1. **Соберите Docker образ:**

```bash
docker build -t motivation-bot:latest .
```

2. **Запустите контейнер:**

```bash
docker run -d \
  --name motivation-bot \
  --restart unless-stopped \
  -e BOT_TOKEN=your_bot_token \
  -e DATABASE_URL=postgresql://user:password@host:5432/dbname \
  -e REDIS_HOST=your_redis_host \
  -e REDIS_PORT=6379 \
  -e REDIS_PASSWORD=your_redis_password \
  -e LOG_LEVEL=info \
  motivation-bot:latest
```

### Вариант 3: Деплой без Docker (напрямую на Node.js)

1. **Установите зависимости:**

```bash
# Установите Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Установите зависимости проекта
npm ci --only=production
```

2. **Соберите проект:**

```bash
npm run build
```

3. **Настройте переменные окружения:**

```bash
# Создайте .env файл (см. выше)
nano .env
```

4. **Запустите приложение:**

```bash
# Используйте process manager (PM2 рекомендуется)
npm install -g pm2

# Запустите приложение
pm2 start dist/index.js --name motivation-bot

# Сохраните конфигурацию PM2
pm2 save
pm2 startup
```

## Управление после деплоя

### Просмотр логов

```bash
# Docker Compose
docker compose -f docker-compose.prod.yml logs -f bot

# Docker
docker logs -f motivation-bot

# PM2
pm2 logs motivation-bot
```

### Остановка/Запуск

```bash
# Docker Compose
docker compose -f docker-compose.prod.yml stop
docker compose -f docker-compose.prod.yml start

# Docker
docker stop motivation-bot
docker start motivation-bot

# PM2
pm2 stop motivation-bot
pm2 start motivation-bot
```

### Обновление приложения

```bash
# 1. Получите последние изменения
git pull origin main

# 2. Пересоберите образ (Docker)
docker compose -f docker-compose.prod.yml build bot
docker compose -f docker-compose.prod.yml up -d bot

# Или для PM2
npm run build
pm2 restart motivation-bot
```

### Выполнение миграций БД

Миграции выполняются автоматически при запуске приложения. Если нужно выполнить вручную:

```bash
# Docker Compose
docker compose -f docker-compose.prod.yml exec bot npm run db:migrate

# Docker
docker exec motivation-bot npm run db:migrate

# PM2 (локально)
npm run db:migrate
```

## Мониторинг и обслуживание

### Проверка здоровья сервисов

```bash
# Проверка статуса контейнеров
docker compose -f docker-compose.prod.yml ps

# Проверка использования ресурсов
docker stats

# Проверка логов на ошибки
docker compose -f docker-compose.prod.yml logs bot | grep -i error
```

### Резервное копирование

#### PostgreSQL

```bash
# Создание бэкапа
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U postgres motivation_bot > backup_$(date +%Y%m%d_%H%M%S).sql

# Восстановление из бэкапа
docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres motivation_bot < backup.sql
```

#### Redis

```bash
# Redis сохраняет данные автоматически (AOF включен)
# Ручное сохранение
docker compose -f docker-compose.prod.yml exec redis redis-cli --no-auth-warning -a $REDIS_PASSWORD BGSAVE
```

## Решение проблем

### Бот не запускается

1. Проверьте логи: `docker compose -f docker-compose.prod.yml logs bot`
2. Убедитесь, что все переменные окружения установлены
3. Проверьте подключение к БД и Redis

### Ошибки подключения к БД

1. Проверьте, что PostgreSQL запущен: `docker compose -f docker-compose.prod.yml ps postgres`
2. Проверьте DATABASE_URL в .env
3. Проверьте логи PostgreSQL: `docker compose -f docker-compose.prod.yml logs postgres`

### Ошибки подключения к Redis

1. Проверьте, что Redis запущен: `docker compose -f docker-compose.prod.yml ps redis`
2. Проверьте REDIS_PASSWORD в .env
3. Проверьте логи Redis: `docker compose -f docker-compose.prod.yml logs redis`

## Безопасность

1. **Никогда не коммитьте `.env` файл в Git**
2. **Используйте сильные пароли** для PostgreSQL и Redis
3. **Ограничьте доступ** к портам БД и Redis (не открывайте их наружу)
4. **Регулярно обновляйте** зависимости: `npm audit` и `npm update`
5. **Используйте firewall** для защиты сервера

## Производительность

- Для production рекомендуется использовать минимум 2GB RAM
- Настройте лимиты ресурсов в docker-compose.prod.yml при необходимости
- Регулярно проверяйте использование дискового пространства

## Поддержка

При возникновении проблем:
1. Проверьте логи приложения
2. Проверьте документацию
3. Создайте issue в репозитории проекта

