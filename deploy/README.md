# GPS SISTEMA C.A. — Guía de migración a Contabo

## Configuración recomendada del VPS

| Parámetro | Valor |
|-----------|-------|
| Plan | Cloud VPS 4 |
| CPU | 4 vCPU |
| RAM | 8 GB |
| Disco | 100 GB SSD |
| OS | Ubuntu 22.04 |
| Región | **US Central** (menor latencia desde Venezuela) |
| Auto Backup | ✅ Recomendado (€1.65/mes) |

---

## Paso a paso

### 1. Comprar y conectarse al servidor

Después de crear el VPS en Contabo, conéctate por SSH:

```bash
ssh root@IP_DEL_SERVIDOR
```

---

### 2. Subir el código al servidor

**Opción A — desde tu máquina local (recomendado):**
```bash
# En tu máquina local, desde la raíz del proyecto:
rsync -avz --exclude='node_modules' --exclude='.git' --exclude='dist' \
  ./ root@IP_DEL_SERVIDOR:/opt/gpsadmin/
```

**Opción B — desde GitHub (si el repo es privado, configura SSH key primero):**
```bash
# En el servidor:
git clone https://github.com/TU_USUARIO/TU_REPO.git /opt/gpsadmin
```

---

### 3. Ejecutar setup inicial del servidor

```bash
# En el servidor, como root:
cd /opt/gpsadmin
bash deploy/1-setup-server.sh
```

Esto instala: Node.js 20, pnpm, PM2, PostgreSQL 16, Nginx, UFW.

Al final muestra las credenciales de la BD — **guárdalas**.

---

### 4. Crear el archivo de variables de entorno

```bash
mkdir -p /root/gps-config
cp /opt/gpsadmin/deploy/.env.example /root/gps-config/.env
nano /root/gps-config/.env
```

Completa estos valores:

```env
APP_DATABASE_URL=postgresql://gpsadmin:LA_CONTRASEÑA_DEL_PASO_3@localhost:5432/gpsadmin
TELEGRAM_BOT_TOKEN=TU_TOKEN_DE_TELEGRAM
SESSION_SECRET=$(openssl rand -base64 48)
```

Los demás valores (GPS_URL, GPS_EMAIL, GPS_PASSWORD) ya vienen configurados correctamente.

```bash
chmod 600 /root/gps-config/.env
```

---

### 5. Migrar la base de datos desde Neon

Necesitas la URL de conexión de Neon (APP_DATABASE_URL actual de Replit):

```bash
bash /opt/gpsadmin/deploy/3-migrate-db.sh \
  "postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"
```

Esto hace un dump completo de Neon y lo importa en PostgreSQL local.

---

### 6. Desplegar la aplicación

```bash
cd /opt/gpsadmin
bash deploy/2-deploy.sh
```

Esto compila el frontend y la API, ejecuta migraciones y arranca PM2.

---

### 7. Configurar Nginx

```bash
# Crear directorio de logs
mkdir -p /var/log/gpsadmin

# Instalar configuración
cp /opt/gpsadmin/deploy/nginx.conf /etc/nginx/sites-available/gpsadmin
ln -sf /etc/nginx/sites-available/gpsadmin /etc/nginx/sites-enabled/gpsadmin
rm -f /etc/nginx/sites-enabled/default

# Verificar y recargar
nginx -t && systemctl reload nginx
```

---

### 8. Verificar que todo funciona

```bash
# Estado del proceso Node.js
pm2 status

# Logs en tiempo real
pm2 logs gpsadmin

# Probar la API
curl http://localhost:3000/api/gps/connection

# Probar desde afuera (reemplaza con la IP del servidor)
curl http://IP_DEL_SERVIDOR/api/gps/connection
```

---

### 9. (Opcional) Configurar dominio con SSL

Si tienes un dominio, edita `/etc/nginx/sites-available/gpsadmin` y reemplaza:
```
server_name _;
```
por:
```
server_name tudominio.com www.tudominio.com;
```

Luego activa SSL gratuito con Let's Encrypt:
```bash
certbot --nginx -d tudominio.com -d www.tudominio.com
```

---

## Actualizaciones futuras

Para subir cambios después del despliegue inicial:

```bash
# Desde tu máquina local:
rsync -avz --exclude='node_modules' --exclude='.git' --exclude='dist' \
  ./ root@IP_DEL_SERVIDOR:/opt/gpsadmin/

# En el servidor:
cd /opt/gpsadmin
bash deploy/2-deploy.sh
```

---

## Comandos útiles de PM2

```bash
pm2 status           # Ver estado
pm2 logs gpsadmin    # Ver logs en tiempo real
pm2 restart gpsadmin # Reiniciar
pm2 stop gpsadmin    # Detener
pm2 monit            # Monitor visual
```

## Comandos útiles de PostgreSQL

```bash
# Conectarse a la BD
sudo -u postgres psql -d gpsadmin

# Backup manual
pg_dump -U gpsadmin -d gpsadmin > backup-$(date +%Y%m%d).sql

# Restaurar backup
psql -U gpsadmin -d gpsadmin < backup.sql
```
