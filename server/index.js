// server/index.js
// LOCAL entry point only. Do not add routes or middleware here — they go in app.js.
// Vercel never runs this file; it uses api/index.js -> app.js.

var app              = require('./app');
var { logAudit }     = require('./middleware/middleware');
var bmsPollingEngine = require('./services/bmsPollingEngine');

var PORT = process.env.PORT || 5000;

console.log('');
console.log('  +=============================================+');
console.log('  |          PharmaMES.AI Server               |');
console.log('  |   GAMP5 Cat.5 | 21 CFR Part 11            |');
console.log('  |   Neon PostgreSQL + JWT + Helmet           |');
console.log('  +=============================================+');
console.log('');

app.locals.migrationsReady.then(function(ok) {
  if (!ok) {
    console.error('\n  [FATAL] Server startup failed: migrations did not complete.');
    process.exit(1);
  }

  app.listen(PORT, function() {
    console.log('  -> Running on http://localhost:' + PORT);
    console.log('  -> AI:       ' + (process.env.GROQ_API_KEY ? 'Enabled (Groq/Llama 3.3 70B)' : 'Disabled'));
    console.log('  -> DB:       Neon PostgreSQL');
    console.log('  -> Security: Helmet + express-validator + CORS');
    console.log('');
  });

  Promise.resolve(logAudit({
    userId:       'SYSTEM',
    action:       'STARTUP',
    resourceType: 'SYSTEM',
    details:      'PharmaMES.AI server started (local)',
  })).catch(function(err) {
    console.warn('  -> Audit: Failed to log startup —', err.message);
  });

  // Background BMS polling — local only. On Vercel, use /api/env/poll/trigger via Cron.
  bmsPollingEngine.startPolling().catch(function(err) {
    console.warn('  -> BMS Polling: Failed to start —', err.message);
  });
});
