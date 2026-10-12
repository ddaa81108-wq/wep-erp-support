import webPush from 'web-push';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const target = resolve(process.argv[2] ?? 'var/.env.push');
const subject = process.argv[3] ? new URL(process.argv[3]).href : '';
if (!subject || !['https:', 'mailto:'].includes(new URL(subject).protocol))
  throw new Error('Pass a contact https URL or mailto address as the second argument.');
const keys = webPush.generateVAPIDKeys();
writeFileSync(
  target,
  [
    'ABDO_PUSH_SUBJECT=' + subject,
    'ABDO_PUSH_PUBLIC_KEY=' + keys.publicKey,
    'ABDO_PUSH_PRIVATE_KEY=' + keys.privateKey,
    '',
  ].join(String.fromCharCode(10)),
  { flag: 'wx', mode: 0o600 },
);
console.log(
  'Push configuration created at ' + target + '. Keep it private; do not regenerate existing keys.',
);
