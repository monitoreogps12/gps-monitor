// PM2 ecosystem — GPS SISTEMA C.A.
// Uso: pm2 start ecosystem.config.cjs --env production

module.exports = {
  apps: [
    {
      name: "gpsadmin",
      script: "./artifacts/api-server/dist/index.mjs",
      cwd: "/opt/gpsadmin",
      interpreter: "node",
      interpreter_args: "--enable-source-maps",

      // Entorno de producción
      env_production: {
        NODE_ENV: "production",
        PORT: "3000",
      },

      // Archivo con variables de entorno (SESSION_SECRET, TELEGRAM_BOT_TOKEN, APP_DATABASE_URL)
      env_file: "/root/gps-config/.env",

      // Reiniciar si usa más de 500MB
      max_memory_restart: "500M",

      // Reinicio automático ante caídas
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,

      // Logs
      out_file: "/var/log/gpsadmin/app.log",
      error_file: "/var/log/gpsadmin/error.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",

      // Modo cluster: 1 proceso (la app no es stateless puro por los intervals de bots)
      instances: 1,
      exec_mode: "fork",
    },
  ],
};
