#!/bin/bash
# =============================================================================
# GPS SISTEMA C.A. — Migración de base de datos desde Neon → PostgreSQL local
# Ejecutar en el servidor Contabo DESPUÉS de setup y ANTES del primer deploy
# Uso: bash deploy/3-migrate-db.sh "postgresql://user:pass@ep-xxx.neon.tech/neondb"
# =============================================================================
set -euo pipefail

NEON_URL="${1:-}"
ENV_FILE="/root/gps-config/.env"

if [ -z "$NEON_URL" ]; then
  # Intentar leer desde .env
  if [ -f "$ENV_FILE" ]; then
    source "$ENV_FILE"
    NEON_URL="${APP_DATABASE_URL:-}"
  fi
fi

if [ -z "$NEON_URL" ]; then
  echo "❌ Uso: bash 3-migrate-db.sh \"postgresql://user:pass@ep-xxx.neon.tech/neondb\""
  exit 1
fi

# Leer credenciales locales
DB_CREDS="/root/gps-config/db-credentials.txt"
if [ ! -f "$DB_CREDS" ]; then
  echo "❌ No se encontró $DB_CREDS — ejecuta primero 1-setup-server.sh"
  exit 1
fi
source "$DB_CREDS"

DUMP_FILE="/tmp/gpsadmin-backup-$(date +%Y%m%d-%H%M%S).sql"

echo "============================================"
echo " GPS Admin — Migración de BD Neon → Local"
echo "============================================"
echo ""
echo "Origen:  Neon (${NEON_URL:0:40}...)"
echo "Destino: postgresql://localhost:5432/${DB_NAME}"
echo ""

# ── 1. Dump desde Neon ───────────────────────────────────────────────────────
echo "[1/3] Exportando datos desde Neon..."
PGPASSWORD="" pg_dump \
  --no-owner \
  --no-acl \
  --if-exists \
  --clean \
  --format=plain \
  "$NEON_URL" \
  -f "$DUMP_FILE"

echo "  ✅ Backup guardado en: $DUMP_FILE"
echo "  📦 Tamaño: $(du -sh $DUMP_FILE | cut -f1)"

# ── 2. Importar en PostgreSQL local ──────────────────────────────────────────
echo "[2/3] Importando en PostgreSQL local..."
PGPASSWORD="$DB_PASS" psql \
  -h localhost \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -f "$DUMP_FILE" \
  --quiet

echo "  ✅ Datos importados correctamente"

# ── 3. Verificar tablas ──────────────────────────────────────────────────────
echo "[3/3] Verificando tablas..."
PGPASSWORD="$DB_PASS" psql \
  -h localhost \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -c "\dt" \
  --quiet

echo ""
echo "============================================"
echo " ✅ Migración completada!"
echo "============================================"
echo ""
echo "Backup guardado en: $DUMP_FILE"
echo ""
echo "Ahora actualiza APP_DATABASE_URL en $ENV_FILE:"
echo "  APP_DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
