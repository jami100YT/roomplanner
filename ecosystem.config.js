// pm2-Konfiguration (Alternative zu Docker)
// Start:   pm2 start ecosystem.config.js && pm2 save
// Update:  git pull && npm ci --omit=dev && pm2 reload ecosystem.config.js
module.exports = {
  apps: [{
    name: 'raumplaner',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,            // genau EIN Prozess – die Echtzeit-Daten liegen im Speicher dieses Prozesses
    exec_mode: 'fork',
    kill_timeout: 5000,      // Zeit zum Speichern beim Neustart
    max_memory_restart: '300M',
    env: { NODE_ENV: 'production', PORT: 3000 }
  }]
};
