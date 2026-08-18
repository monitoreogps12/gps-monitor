#!/bin/bash
# =============================================================================
# GPS SISTEMA C.A. — Script de despliegue / actualización
# Ejecutar desde la raíz del proyecto en el servidor Contabo
# Uso: bash deploy/2-deploy.sh
# =============================================================================
set -euo pipefail

APP_DIR="/opt/gpsadmin"
ENV_FILE="/root/gps-config/.env"

echo "============================================"
echo " GPS Admin — Despliegue"
echo "============================================"

# ── Verificar .env ────────────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ERROR: No existe $ENV_FILE"
  echo "   Crea el archivo copiando deploy/.env.example y completando los valores."
  exit 1
fi

# Cargar variables de entorno
set -a; source "$ENV_FILE"; set +a

# ── Copiar código al directorio de la app ────────────────────────────────────
echo "[1/6] Sincronizando código..."
mkdir -p "$APP_DIR"

# Si hay un repositorio git, hacer pull; si no, copiar desde directorio actual
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git pull origin main
else
  # Copiar todo excepto node_modules y .git
  rsync -a --exclude='node_modules' --exclude='.git' --exclude='*.log' \
        "$(pwd)/" "$APP_DIR/"
  cd "$APP_DIR"
fi

# ── Instalar dependencias ─────────────────────────────────────────────────────
echo "[2/6] Instalando dependencias (pnpm install)..."
pnpm install --frozen-lockfile

# ── Build del frontend (React/Vite) ──────────────────────────────────────────
echo "[3/6] Compilando frontend..."
export NODE_ENV=production
export BASE_PATH="/"
pnpm --filter @workspace/gps-admin run build
echo "  ✅ Frontend compilado en artifacts/gps-admin/dist/public/"

# ── Build del API server ──────────────────────────────────────────────────────
echo "[4/6] Compilando API server..."
pnpm --filter @workspace/api-server run build
echo "  ✅ API compilado en artifacts/api-server/dist/"

# ── Ejecutar migraciones de BD ────────────────────────────────────────────────
echo "[5/6] Ejecutando migraciones de base de datos..."
cd "$APP_DIR"
NODE_ENV=production node -e "
  const { execSync } = require('child_process');
  process.env.APP_DATABASE_URL = process.env.APP_DATABASE_URL;
  execSync('pnpm --filter @workspace/db run migrate', { stdio: 'inherit' });
" 2>/dev/null || \
  pnpm --filter @workspace/db run migrate 2>/dev/null || \
  echo "  ⚠️  Migraciones Drizzle: ejecuta manualmente si hay cambios de esquema"

# ── Reiniciar con PM2 ─────────────────────────────────────────────────────────
echo "[6/6] Reiniciando servicio con PM2..."
cd "$APP_DIR"

# Copiar .env al directorio de la app para PM2
cp "$ENV_FILE" "$APP_DIR/.env.production"

if pm2 describe gpsadmin > /dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --env production
else
  pm2 start ecosystem.config.cjs --env production
fi

pm2 save

echo ""
echo "============================================"
echo " ✅ Despliegue completado!"
echo "============================================"
pm2 status gpsadmin
