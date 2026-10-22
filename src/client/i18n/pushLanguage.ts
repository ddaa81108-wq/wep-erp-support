import { language } from './language.ts';

/** Only a language enum is sent; no credentials, balances or API responses. */
export function sendPushLanguage(registration: ServiceWorkerRegistration) {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  worker?.postMessage({ type: 'abdo:set-language', language });
}

export function syncPushLanguage() {
  if (!('serviceWorker' in navigator)) return;
  void navigator.serviceWorker
    .getRegistration('/')
    .then((registration) => {
      if (registration) sendPushLanguage(registration);
    })
    .catch(() => {
      /* Notification preferences must not prevent application startup. */
    });
}
