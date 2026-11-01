# Gestor de Wikis de Alumnos — PWA

Conversión a ** Progressive Web App** del gestor de wikis. Se puede instalar
en móvil/escritorio, funciona sin conexión (interfaz + datos de la última
sesión) y convive sin interferir con el portal **https://tecdea.github.io**.

## Contenido

```
app_wikis/
├── index.html                  # La aplicación original + capa PWA
├── manifest_wikis.webmanifest  # Manifiesto propio (nombre único a propósito)
├── sw_wikis.js                 # Service Worker propio (scope = esta carpeta)
├── icons/                      # Iconos PWA
│   ├── icon-72.png … icon-512.png        # propósito "any" (esquinas redondeadas)
│   ├── maskable-192.png / maskable-512.png  # propósito "maskable" (Android adaptativo)
│   ├── apple-touch-icon.png               # iOS (180×180, opaco)
│   ├── favicon.svg / favicon-32x32.png / favicon.ico
└── README.md
```

## Despliegue en el portal (tecdea.github.io)

1. Copia la carpeta `app_wikis/` **completa** a la raíz del repositorio del
   portal (`tecdea.github.io`), junto a `index.html`, `sw.js`, `manifest.webmanifest`
   e `img/` que ya existen.
2. Sube el cambio (commit + push). La app quedará pública en:
   **https://tecdea.github.io/app_wikis/**
3. (Opcional) Añade un acceso desde el portal apuntando a `/app_wikis/`.

> **El archivo principal debe conservar el nombre `index.html`.** GitHub
> Pages lo sirve automáticamente al visitar `https://tecdea.github.io/app_wikis/`
> (URL limpia, sin nombre de fichero) y el service worker lo trata como la
> entrada canónica del modo offline: es el único recurso imprescindible al
> instalar el SW. Ninguna referencia del código apunta al nombre original
> del fichero (`app_wikis (4).html`): manifest, SW, iconos y `start_url`
> usan rutas relativas a la carpeta.
>
> La carpeta puede llamarse distinto u olvidarse en otra subcarpeta:
> todos los paths del manifest, del SW y del HTML son **relativos** (`./`),
> por lo que la app funciona en cualquier subruta sin retoques.
> Lo único que NO debes hacer es desparramar estos archivos en la raíz del
> portal: perderían el aislamiento descrito abajo.

## Por qué no interfiere con el portal

El portal TecDeA ya es una PWA con su propio service worker de scope raíz
(`/`) y su manifiesto con `id: "/"`. Esta app se aísla así:

1. **Scope del SW limitado a la subcarpeta.** `sw_wikis.js` vive dentro de
   `/app_wikis/`, así que su scope máximo es `/app_wikis/`. Nunca intercepta
   las peticiones del portal ni de otras apps (el propio SW lo comprueba de
   forma defensiva petición a petición antes de actuar).
2. **Archivos con nombres propios** (`manifest_wikis.webmanifest`,
   `sw_wikis.js`): imposible sobrescribir el `sw.js` o el `manifest.webmanifest`
   del portal al desplegar en el mismo repositorio.
3. **Identidad de instalación distinta.** El manifiesto usa `scope: "./"`,
   `start_url: "./?source=pwa"` e `id: "./?source=pwa"`, que se resuelven a
   `/app_wikis/...`: se instala como una app **separada** del portal (icono,
   ventana y entradas propias) y no "secuestra" la instalación del portal ni
   al revés.
4. **Cachés con prefijo propio** (`wikis-alumnos-*`). El SW de esta app solo
   borra sus propias cachés, y el SW del portal (que solo borra `tecdea-portal-*`)
   tampoco borra las de esta app.
5. **Recursos compartidos por el origen**: los iconos viven en
   `app_wikis/icons/` y no en `/img/` del portal; el favicon y el
   `theme-color` declarados en este HTML solo afectan a esta página.
6. **Datos nunca cacheados por el SW**: las llamadas a Google Apps Script
   (`script.google.com`) y cualquier otro origen pasan siempre directas a la red.

Nota: al convivir dos SW en el mismo dominio, en las páginas de esta carpeta
manda el más específico (el de la app); el del portal sigue controlando el
resto del sitio. Es el mismo patrón que ya usa el portal con otras apps
(p. ej. `/tablerokanban/`).

## Funcionamiento offline

- **Interfaz**: el SW precachea el HTML, el manifiesto, los iconos y las dos
  librerías CDN que usa la app (Tailwind y html2pdf). Navegación con
  "red primero" para recibir siempre la versión publicada; sin red, sirve la
  copia cacheada.
- **Datos**: cada sincronización correcta guarda los datos en `localStorage`.
  Sin conexión, la app muestra esos datos, marca el estado "Sin conexión"
  (ámbar) y resincroniza sola al volver la red. Las operaciones de
  escritura (crear/editar/borrar) requieren conexión.

## Cómo actualizar la app en producción

Al publicar una nueva versión, sube el `CACHE_NAME` del service worker
(`sw_wikis.js`, constante `wikis-alumnos-v1` → `wikis-alumnos-v2`) para que
los clientes renueven la caché al visitarla.

## Probar en local

```bash
cd app_wikis
python3 -m http.server 8000
# abrir http://localhost:8000/
```

En Chrome: menú ⋮ → *Cast, save and share → Install page as app…*, o el botón
"Instalar app" de la cabecera. DevTools → Application → Manifest / Service
Workers / Cache Storage para inspeccionarlo todo.
