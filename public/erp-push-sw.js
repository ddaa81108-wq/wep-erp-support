/* No fetch handler or API caching: financial requests always reach the server. */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    const received = event.data ? event.data.json() : {};
    payload = received && typeof received === 'object' ? received : {};
  } catch {
    /* Generic notification remains visible. */
  }
  event.waitUntil(
    self.registration.showNotification('VIB Abdo Company', {
      body:
        typeof payload.body === 'string' && payload.body.trim()
          ? payload.body.slice(0, 240)
          : 'لديك إشعار جديد في المنظومة. افتحها للمراجعة.',
      icon: '/push-icon.svg',
      badge: '/push-icon.svg',
      tag: typeof payload.tag === 'string' ? payload.tag.slice(0, 100) : 'abdo-erp',
      data: { url: '/erp' },
      dir: 'rtl',
      lang: 'ar',
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const page = pages.find(
        (client) =>
          new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/erp',
      );
      if (page) return page.focus();
      return self.clients.openWindow('/erp');
    })(),
  );
});
