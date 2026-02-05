#!/bin/bash
set -e

# Скрипт автоматического бэкапа PostgreSQL для Motivation Bot
# Использование: ./scripts/backup-postgres.sh
# Или с переменными: BACKUP_DIR=/opt/backups RETENTION_DAYS=14 ./scripts/backup-postgres.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

# Загрузка переменных из .env
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-motivation_bot}"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

cd "$PROJECT_DIR"

# Проверка, что контейнер postgres запущен
if ! docker compose -f "$COMPOSE_FILE" ps postgres 2>/dev/null | grep -q "Up"; then
  echo "Error: PostgreSQL container is not running. Start it with: docker compose -f $COMPOSE_FILE up -d postgres"
  exit 1
fi

# Создание бэкапа
BACKUP_FILE="$BACKUP_DIR/backup_$DATE.sql.gz"
docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$BACKUP_FILE"

echo "Backup created: $BACKUP_FILE"

# Удаление старых бэкапов
if [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -name "backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete
  echo "Old backups (older than $RETENTION_DAYS days) removed"
fi
