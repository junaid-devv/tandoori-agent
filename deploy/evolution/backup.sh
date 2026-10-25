#!/usr/bin/env bash
# Run as the deployment owner, with permission to run sudo docker noninteractively.
set -euo pipefail
umask 077
cd /home/azureuser/evolution-api
backup_dir=/home/azureuser/evolution-backups
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
exec 9>"$backup_dir/.lock"
flock -n 9 || exit 0
prefix="$backup_dir/evolution-$(date -u +%Y%m%dT%H%M%SZ)"
compose=(sudo -n docker compose -f docker-compose.yml -f docker-compose.https.yml)

"${compose[@]}" exec -T postgres pg_dump -U evolution -d evolution -Fc > "$prefix-postgres.dump"
"${compose[@]}" exec -T redis redis-cli --rdb /tmp/evolution-backup.rdb >/dev/null
"${compose[@]}" cp redis:/tmp/evolution-backup.rdb "$prefix-redis.rdb" >/dev/null
"${compose[@]}" exec -T evolution tar -C /evolution/instances -czf - . > "$prefix-instances.tar.gz"
config_files=(.env docker-compose.yml docker-compose.https.yml Caddyfile redact-logs.cjs Dockerfile patch-interactive.cjs check-interactive.cjs .dockerignore)
if [[ -f webhook-worker.json ]]; then config_files+=(webhook-worker.json retry-webhooks.py); fi
tar -czf "$prefix-config.tar.gz" "${config_files[@]}"

# Restrict retention cleanup to this script's files in its fixed backup directory.
find "$backup_dir" -maxdepth 1 -type f -name 'evolution-*' -mtime +7 -delete
echo "Evolution backup completed: $(basename "$prefix")"
