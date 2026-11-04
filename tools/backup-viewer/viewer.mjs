import { createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

const root = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const hiddenTable = /session|oauth|login_failure|recovery|two_factor|mfa|totp|user_identities|push_subscription|idempotency|_requests$|app_meta|notification_speech_settings/i;
const hiddenColumn = /password|secret|token|csrf|credential|recovery|private_key|totp|salt/i;
const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);

function decode(text, length) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('ملف التشفير غير صالح.');
  const bytes = Buffer.from(text, 'base64');
  if (bytes.toString('base64') !== text || (length && bytes.length !== length)) throw new Error('ملف التشفير غير صالح.');
  return bytes;
}

export function readBackup(config) {
  const path = resolve(config.backupPath);
  const live = resolve(process.env.ProgramData || 'C:\\ProgramData', 'AbdoErpLocal/data/abdo-erp.sqlite');
  if (path.toLowerCase() === live.toLowerCase()) throw new Error('اختر نسخة احتياطية؛ فتح قاعدة السيرفر الحالية غير مسموح.');
  if (statSync(path).size > 72 * 1024 * 1024) throw new Error('الملف يتجاوز 72 ميجابايت.');
  const file = readFileSync(path);
  let manifest = 'غير مرفق';
  if (existsSync(path + '.json')) {
    const m = JSON.parse(readFileSync(path + '.json', 'utf8'));
    if (m.manifestVersion !== 1 || m.file !== basename(path) || m.fileSizeBytes !== file.length || m.sha256 !== hash(file))
      throw new Error('النسخة لا تطابق ملف التحقق المرفق.');
    manifest = 'البصمة والحجم مطابقان';
  }
  let bytes = file;
  let encrypted = false;
  if (file.subarray(0, 16).toString() !== 'SQLite format 3\0') {
    const value = JSON.parse(file.toString('utf8'));
    if (value.format === 'abdo-erp-encrypted-backup') {
      if (value.version !== 1 || value.cipher !== 'aes-256-gcm' || value.kdf !== 'scrypt') throw new Error('صيغة التشفير غير مدعومة.');
      const password = config.keyFile ? readFileSync(resolve(config.keyFile), 'utf8').trim() : config.password;
      if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('أدخل كلمة التشفير الصحيحة.');
      const key = scryptSync(password, decode(value.salt, 32), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, decode(value.iv, 12));
        decipher.setAAD(Buffer.from('abdo-erp-encrypted-backup:1'));
        decipher.setAuthTag(decode(value.tag, 16));
        bytes = Buffer.concat([decipher.update(decode(value.ciphertext)), decipher.final()]);
        encrypted = true;
      } catch { throw new Error('كلمة التشفير غير صحيحة أو النسخة تالفة.'); }
      finally { key.fill(0); }
    } else if (value.format === 'abdo-erp-backup' && value.version === 1) {
      bytes = decode(value.database);
      if (bytes.length !== value.size || hash(bytes) !== value.sha256) throw new Error('بصمة النسخة غير صحيحة.');
    } else throw new Error('اختر نسخة Abdo ERP أو ملف SQLite.');
  }
  if (bytes.length > 49 * 1024 * 1024 || bytes.subarray(0, 16).toString() !== 'SQLite format 3\0') throw new Error('محتوى قاعدة البيانات غير صالح أو أكبر من الحد المسموح.');
  return { bytes, metadata: { file: basename(path), encrypted, manifest } };
}

export async function startViewer(config) {
  const { bytes, metadata } = readBackup(config);
  const directory = mkdtempSync(join(tmpdir(), 'abdo-backup-viewer-'));
  let db;
  let server;
  let timer;
  function cleanup() {
    clearTimeout(timer);
    if (db) { db.close(); db = null; }
    rmSync(directory, { recursive: true, force: true });
  }
  try {
    // Protect the temporary plaintext before writing it; do not inherit broad ACLs.
    if (process.platform === 'win32') {
      const sid = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).match(/S-1-[\d-]+/)?.[0];
      if (!sid) throw new Error('تعذر تحديد صلاحيات مجلد المعاينة.');
      execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true, stdio: 'ignore' });
    }
    const temporary = join(directory, 'snapshot.sqlite');
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
    bytes.fill(0);
    db = new DatabaseSync(temporary, { readOnly: true, enableDoubleQuotedStringLiterals: false });
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
    const checked = db.prepare('PRAGMA quick_check').all();
    if (checked.length !== 1 || Object.values(checked[0])[0] !== 'ok') throw new Error('فشل فحص سلامة قاعدة النسخة.');
    metadata.integrity = 'ok';
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .filter(row => !hiddenTable.test(row.name))
      .filter(row => !db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(row.name)?.sql?.toUpperCase().includes('CREATE VIRTUAL TABLE'))
      .map(row => {
        const columns = db.prepare(`PRAGMA table_info(${quote(row.name)})`).all().map(col => col.name).filter(col => !hiddenColumn.test(col));
        const count = db.prepare(`SELECT count(*) AS n FROM ${quote(row.name)}`).get().n;
        return { name: row.name, columns, count };
      }).filter(table => table.columns.length);
    const token = randomBytes(24).toString('hex');
    const prefix = '/' + token;
    const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      const host = `127.0.0.1:${server.address().port}`;
      const url = new URL(request.url || '/', 'http://' + host);
      const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(json(value)); };
      if (request.headers.host !== host || !url.pathname.startsWith(prefix + '/')) return send(404, { error: 'غير متاح' });
      if (request.headers.origin && request.headers.origin !== 'http://' + host) return send(403, { error: 'غير مسموح' });
      const route = url.pathname.slice(prefix.length);
      if (route === '/api/close' && request.method === 'POST') { send(200, { closed: true }); void close(); return; }
      if (request.method !== 'GET') return send(405, { error: 'للقراءة فقط' });
      try {
        if (route === '/api/tables') return send(200, { metadata, tables });
        if (route === '/api/rows') {
          const table = tables.find(item => item.name === url.searchParams.get('table'));
          if (!table) return send(400, { error: 'جدول غير متاح' });
          const page = Math.max(1, Math.min(1000000, Number(url.searchParams.get('page')) || 1)) | 0;
          const search = (url.searchParams.get('search') || '').slice(0, 120);
          const where = search ? ' WHERE ' + table.columns.map(col => `instr(lower(CAST(${quote(col)} AS TEXT)),lower(?))>0`).join(' OR ') : '';
          const params = search ? table.columns.map(() => search) : [];
          const total = db.prepare(`SELECT count(*) AS n FROM ${quote(table.name)}${where}`).get(...params).n;
          const statement = db.prepare(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.name)}${where} ORDER BY ${table.columns.map(quote).join(',')} LIMIT 50 OFFSET ?`);
          statement.setReadBigInts(true);
          const rows = statement.all(...params, (page - 1) * 50).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? `[بيانات ثنائية: ${value.length} بايت]` : value])));
          return send(200, { columns: table.columns, rows, total, page, pageSize: 50 });
        }
        if (assets[route]) {
          const [file, type] = assets[route];
          response.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
          response.end(readFileSync(join(root, file))); return;
        }
        send(404, { error: 'غير متاح' });
      } catch { send(400, { error: 'تعذر قراءة هذا الجدول من النسخة.' }); }
    });
    await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
    async function close() {
      if (!db) return;
      server.closeAllConnections();
      await new Promise(done => server.close(done));
      cleanup();
    }
    timer = setTimeout(() => void close(), 2 * 60 * 60 * 1000);
    const url = `http://127.0.0.1:${server.address().port}${prefix}/`;
    return { url, close, directory };
  } catch (error) { bytes.fill(0); cleanup(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 20000) throw new Error('إعدادات التشغيل غير صالحة.'); }
    const config = JSON.parse(input.replace(/^\uFEFF/, ''));
    const viewer = await startViewer(config);
    console.log('معاينة محلية للقراءة فقط: ' + viewer.url);
    console.log('أغلق المعاينة من الزر داخل الصفحة. تنتهي تلقائيًا بعد ساعتين.');
    if (config.openBrowser !== false && process.platform === 'win32') {
      spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${viewer.url}'`], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    }
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void viewer.close());
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
