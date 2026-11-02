// ════════════════════════════════════════════════════════
//  SERVICE WORKER - Gestor de Wikis de Alumnos (PWA)
// ════════════════════════════════════════════════════════
//  Este archivo vive DENTRO de la carpeta de la app
//  (https://tecdea.github.io/wikisalumnado/), por lo que su
//  scope se limita a esa carpeta y no intercepta NUNCA las
//  peticiones del portal (https://tecdea.github.io/) ni de
//  otras apps del dominio. Además, el manejador `fetch`
//  comprueba de forma defensiva que cada petición caiga
//  dentro del scope antes de intervenir.
//
//  Estrategias:
//   · Navegación (index.html): red primero; caché solo si no
//     hay red (la app siempre recibe la versión publicada).
//   · Recursos estáticos propios (solo la lista blanca del
//     shell) y de los 2 CDN que usa la app (Tailwind y
//     html2pdf): caché primero + refresco en segundo plano
//     (stale-while-revalidate) → soporte offline.
//   · Datos del backend y cualquier otra petición (también las
//     URL con query, p. ej. "?action=read"): se dejan pasar
//     sin tocar (nunca se cachean), aunque compartan origen.
// ════════════════════════════════════════════════════════

const CACHE_NAME = 'wikis-alumnos-v1.10';

// Archivo principal de la app: index.html es la entrada canónica de
// la PWA (el manifest arranca en "./?source=pwa" y el servidor lo
// resuelve con este fichero). Sin él no hay arranque offline.
const SHELL_REQUIRED = ['./index.html'];

// Resto del shell (ruta de carpeta, manifiesto, iconos): se cachean a
// mejor esfuerzo; si alguno falla, la instalación no se bloquea.
const SHELL_OPTIONAL = [
  './',
  './manifest.webmanifest',
  './icons/favicon-32x32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png'
];

// Librerías externas que necesita la interfaz para funcionar offline.
// Se cachean en modo "best effort": si un CDN falla, la app se
// instala igualmente y se reintenta en la siguiente visita.
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
];

// ── Instalación: precachear el shell ──────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // index.html es imprescindible: si no se puede cachear, el SW no
    // se instala y lo reintenta en la siguiente visita
    try {
      await Promise.all(SHELL_REQUIRED.map((url) => cache.add(url)));
    } catch (err) {
      console.error('[SW Wikis] No se pudo cachear el archivo principal (index.html):', err);
      throw err;
    }
    // Resto del shell local: mejor esfuerzo, sin bloquear la instalación
    await Promise.allSettled(
      SHELL_OPTIONAL.map((url) =>
        cache.add(url).catch(() => console.warn('[SW Wikis] No cacheado (no crítico):', url))
      )
    );
    // CDNs: mejor esfuerzo, en modo no-cors (respuesta opaca pero servible)
    await Promise.allSettled(
      CDN_ASSETS.map(async (url) => {
        try {
          const resp = await fetch(url, { mode: 'no-cors', cache: 'reload' });
          if (resp && (resp.ok || resp.type === 'opaque')) {
            await cache.put(url, resp);
          }
        } catch (e) {
          console.warn('[SW Wikis] No se pudo precachear:', url);
        }
      })
    );
    await self.skipWaiting();
  })());
});

// ── Activación: borrar SOLO las cachés de esta app ─────────
// (prefijo propio, distinto del que usa el portal: nunca se
//  eliminan cachés ajenas como 'tecdea-portal-*')
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('wikis-alumnos-') && n !== CACHE_NAME)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// ── Interceptación de peticiones ───────────────────────────
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Solo GET (los POST al backend jamás se tocan)
  if (request.method !== 'GET') return;

  // Navegación (el HTML de la app): red primero, caché como respaldo
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Recursos estáticos conocidos (shell y CDNs): caché primero con
  // refresco en segundo plano. CUALQUIER otra petición —en particular
  // las que llevan query string, como los "read" del backend cuando
  // comparte origen con la app— pasa directa a la red, sin cachear.
  const url = new URL(request.url);
  if (url.search) return; // los estáticos nunca llevan query
  const esAssetConocido =
    SHELL_ASSETS.some((ruta) => url.href === new URL(ruta, self.registration.scope).href) ||
    CDN_ASSETS.includes(url.href);
  if (!esAssetConocido) return;

  event.respondWith(staleWhileRevalidate(request));
});

// Lista blanca de recursos propios cacheables (rutas relativas al scope)
const SHELL_ASSETS = [...new Set([...SHELL_REQUIRED, ...SHELL_OPTIONAL])];

// ── Estrategia: red primero (navegación) ──────────────────
async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // Copia fresca con clave canónica para poder abrir la app sin red
      cache.put('./index.html', response.clone());
    }
    return response;
  } catch (err) {
    const cached =
      (await cache.match(request)) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./'));
    if (cached) return cached;
    return new Response(
      '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
      '<body style="font-family:sans-serif;text-align:center;padding:3rem;color:#3730a3">' +
      '<h1>Gestor de Wikis</h1><p>No hay conexión y la app aún no está cacheada.</p>' +
      '<p>Conéctate una vez a internet y vuelve a intentarlo.</p></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

// ── Estrategia: stale-while-revalidate (estáticos) ─────────
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkUpdate = fetch(request)
    .then((response) => {
      // 'opaque' = respuesta de un CDN sin cabeceras CORS: también es
      // válida para servir <script> desde la caché
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached); // si la red falla y había caché, se reutiliza
  return cached || networkUpdate;
}

// ── Versión de la app ─────────────────────────────────────
// La interfaz la pide para pintar el chip de la cabecera:
// responde con el CACHE_NAME vigente ("wikis-alumnos-vX.Y").
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
