#!/bin/bash
# =============================================================================
# GPS SISTEMA C.A. — Configuración inicial del servidor Contabo
# Ejecutar UNA SOLA VEZ como root en Ubuntu 22.04
# Uso: bash 1-setup-server.sh
# =============================================================================
set -euo pipefail

echo "============================================"
echo " GPS Admin — Setup inicial del servidor"
echo "============================================"

# ── 1. Actualizar sistema ─────────────────────────────────────────────────────
echo "[1/8] Actualizando paquetes del sistema..."
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Instalar dependencias base ─────────────────────────────────────────────
echo "[2/8] Instalando dependencias base..."
apt-get install -y -qq curl git build-essential ufw nginx certbot python3-certbot-nginx

# ── 3. Instalar Node.js 20 ────────────────────────────────────────────────────
echo "[3/8] Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y -qq nodejs
node --version && npm --version

# ── 4. Instalar pnpm ─────────────────────────────────────────────────────────
echo "[4/8] Instalando pnpm..."
npm install -g pnpm@latest
pnpm --version

# ── 5. Instalar PM2 ──────────────────────────────────────────────────────────
echo "[5/8] Instalando PM2..."
npm install -g pm2
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

# ── 6. Instalar PostgreSQL 16 ─────────────────────────────────────────────────
echo "[6/8] Instalando PostgreSQL 16..."
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt jammy-pgdg main" > /etc/apt/sources.list.d/postgresql.list
apt-get update -qq
apt-get install -y -qq postgresql-16 postgresql-client-16

systemctl enable postgresql
systemctl start postgresql

# ── 7. Crear base de datos y usuario PostgreSQL ───────────────────────────────
echo "[7/8] Configurando PostgreSQL..."

# Genera una contraseña segura
DB_PASS=$(openssl rand -base64 24 | tr -d '=+/' | head -c 20)
DB_NAME="gpsadmin"
DB_USER="gpsadmin"

sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" 2>/dev/null || \
  echo "  → Usuario ya existe, actualizando contraseña..." && \
  sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"

sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" 2>/dev/null || \
  echo "  → Base de datos ya existe."

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"

# Guardar credenciales en archivo seguro
mkdir -p /root/gps-config
cat > /root/gps-config/db-credentials.txt <<EOF
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
APP_DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}
EOF
chmod 600 /root/gps-config/db-credentials.txt

echo ""
echo "  ✅ PostgreSQL configurado."
echo "  📄 Credenciales guardadas en: /root/gps-config/db-credentials.txt"
echo "  APP_DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
echo ""

# ── 8. Configurar Firewall ────────────────────────────────────────────────────
echo "[8/8] Configurando firewall (UFW)..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo ""
echo "============================================"
echo " ✅ Setup completo!"
echo "============================================"
echo ""
echo "Próximos pasos:"
echo "  1. Copia el código al servidor"
echo "  2. Crea el archivo /root/gps-config/.env (ver .env.example)"
echo "  3. Ejecuta: bash 2-deploy.sh"
echo "  4. Copia nginx.conf a /etc/nginx/sites-available/gpsadmin"
echo ""
cat /root/gps-config/db-credentials.txt
