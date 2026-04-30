module.exports = {
  apps : [{
    name: 'gps-mock-server',
    script: './server/src/main/index-headless.js',
    cwd: '/opt/gps-mock',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 8080,
      DEBUG: 'true',
      PYTHON_PATH: '/opt/gps-venv/bin/python3',
      ENABLE_GO_IOS_AGENT: 'user'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    merge_logs: true
  }]
};
