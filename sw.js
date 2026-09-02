// Service worker — נדרש כדי שהאפליקציה תהיה ברת-התקנה, ומשמש גם כרשת
// ביטחון לקליטה גרועה: מסך שנטען פעם אחת ייפתח גם כשאין אות.
//
// מדיניות:
//   ניווט  → רשת קודם, ומטמון רק כשאין רשת (כדי לא להגיש גרסה ישנה)
//   נכסים  → מטמון קודם עם רענון ברקע (מהיר, והם ממילא בעלי שם מגובב)
//   Supabase ופונטים → לא נוגעים בכלל. נתוני תקלות חייבים להיות טריים.

const CACHE = 'fixluz-shell-v4'
const SHELL = new URL('./', self.registration.scope).href
// הדמו מקונן מתחת לפרוד (/<site>/demo/) ויש לו SW משלו. ה-SW של פרוד לא
// נוגע בו — אחרת קישור עמוק לדמו היה מקבל את מעטפת פרוד מהמטמון.
const DEMO_PATH = new URL('demo/', SHELL).pathname
const isDemoUrl = (url) => new URL(url).pathname.startsWith(DEMO_PATH)

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  // כל מה שאינו מאותו מקור — Supabase, Google Fonts — עובר כרגיל
  if (new URL(request.url).origin !== self.location.origin) return
  if (isDemoUrl(request.url)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // cache: 'reload' עוקף את מטמון ה-HTTP — תמיד מקבלים index.html
          // טרי. בלי זה, HTML ישן מהמטמון מפנה לקובצי JS שכבר נמחקו
          // בפריסה, והתוצאה מסך לבן.
          const fresh = await fetch(request, { cache: 'reload' })

          // תשובה שאינה תקינה (404 של Pages בזמן פרסום, 5xx) לא נכנסת
          // למטמון — אחרת האפליקציה המותקנת הייתה זוכרת דף שגיאה. אם יש
          // כבר מעטפת שמורה, מגישים אותה במקום: הראוטר יודע לטפל בנתיב.
          if (!fresh.ok) {
            const cached = await caches.match(SHELL)
            return cached ?? fresh
          }

          const cache = await caches.open(CACHE)
          cache.put(SHELL, fresh.clone())
          return fresh
        } catch {
          const cached = await caches.match(SHELL)
          return cached ?? Response.error()
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request)

      const network = fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE)
            cache.put(request, response.clone())
          }
          return response
        })
        .catch(() => cached)

      return cached ?? network
    })(),
  )
})

// ---------------------------------------------------------------------
// התראות Push
// ---------------------------------------------------------------------
// המטען מגיע כ-JSON מה-Edge Function. אם משום מה הוא לא תקין, עדיין
// מציגים משהו: הדפדפן מציג התראה גנרית משלו אם לא הצגנו כלום, וזה
// נראה שבור.

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'Fixluz'
  const options = {
    body: payload.body || 'יש עדכון חדש',
    icon: new URL('icon-192.png', self.registration.scope).href,
    // התג חייב להיות מונוכרומטי ושקוף: אנדרואיד קורא ממנו רק את ערוץ
    // האלפא, ואייקון צבעוני מלא נראה שם כריבוע לבן.
    badge: new URL('badge-96.png', self.registration.scope).href,
    dir: 'rtl',
    lang: 'he',
    tag: payload.tag || undefined,        // התראה חדשה על אותה תקלה מחליפה את הקודמת
    renotify: Boolean(payload.tag),
    requireInteraction: payload.priority === 'urgent',
    data: { url: payload.url || './' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const target = new URL(event.notification.data?.url || './', self.registration.scope).href

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

      // אם האפליקציה כבר פתוחה — מביאים אותה לחזית במקום לפתוח חלון נוסף
      for (const client of clients) {
        if (client.url.startsWith(self.registration.scope) && !isDemoUrl(client.url)) {
          await client.focus()
          if ('navigate' in client) await client.navigate(target)
          return
        }
      }

      await self.clients.openWindow(target)
    })(),
  )
})
