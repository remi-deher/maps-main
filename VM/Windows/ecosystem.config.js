module.exports = {
  apps: [
    {
      name: 'gps-mock-server',
      script: './server/src/main/index-headless.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 8080,
        DEBUG: 'true'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true
    },
    {
      name: 'gps-mock-tunnel',
      script: 'powershell.exe',
      args: '-ExecutionPolicy Bypass -File ./VM/Windows/start_bridge.ps1',
      autorestart: true,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/tunnel-error.log',
      out_file: './logs/tunnel-out.log'
    }
  ]
}
