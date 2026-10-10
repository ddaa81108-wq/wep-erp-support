import console from 'node:console';
import https from 'node:https';
import process from 'node:process';

const url = process.argv[2] ?? 'https://localhost/erp';
const request = https.get(url, { rejectUnauthorized: false, timeout: 5_000 }, (response) => {
  response.resume();
  if (response.statusCode !== 200) {
    console.error(`HTTPS check returned status ${response.statusCode}.`);
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({ ok: true, url, statusCode: response.statusCode }));
});
request.on('timeout', () => request.destroy(new Error('HTTPS check timed out.')));
request.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 2;
});
