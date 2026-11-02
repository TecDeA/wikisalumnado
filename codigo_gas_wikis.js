// ════════════════════════════════════════════════════════
//  GESTOR DE WIKIS DE ALUMNADO — GOOGLE APPS SCRIPT
// ════════════════════════════════════════════════════════
//  Backend de datos de la PWA (wikisalumnado). Sustituye con
//  este archivo TODO el código del editor de Apps Script del
//  proyecto vinculado a la hoja de cálculo y vuelve a
//  desplegar la aplicación web.
//
//  Despliegue (mantén la MISMA URL /exec que ya usa la app;
//  para ello edita la implementación existente en lugar de
//  crear una nueva):
//    Implementar → Administrar implementaciones → ✏️ (editar)
//    → Versión: "Nueva versión" → Implementar.
//    Ejecutar como: Yo (propietario).
//    Quién tiene acceso: cualquier persona.
//
//  ESTRUCTURA DE LA HOJA DE CÁLCULO
//   · Una pestaña por curso académico, con el mismo nombre
//     que el selector de la app: "2024-2025", "2025-2026"…
//     Se crea sola al guardar la primera wiki de ese curso.
//     El curso ya no es una columna: es el nombre de la
//     pestaña.
//   · Columnas de cada pestaña:
//       ID | Nombre | Grupo | URL | Notas | Fecha
//   · Encabezados auto-actualizables: en cada operación se
//     comprueba la fila 1 y se añaden al final las columnas
//     del script que falten. Así, las hojas creadas con
//     versiones anteriores del script se completan solas
//     (los encabezados añadidos en una segunda fase aparecen
//     en hojas ya existentes, sin perder ningún dato).
//   · Migración automática: si el script encuentra la hoja
//     única antigua (la que tenía la columna "Curso"),
//     reparte sus filas en las pestañas por curso y conserva
//     la original renombrada como "__backup__ <nombre>". No
//     se borra nada: comprueba que todo está bien y, si
//     quieres, borra esa copia a mano más adelante.
//
//  PERMISOS
//   · Crear wikis: libre (cualquier usuario puede dar de alta
//     la suya desde la app, sin contraseña).
//   · Editar, borrar y cambiar la contraseña: exigen enviar
//     la contraseña de administrador en el parámetro
//     "password" (la app la pide al entrar en "Modo Admin" y
//     la incluye automáticamente en esas operaciones).
// ════════════════════════════════════════════════════════

// Solo si el proyecto NO está vinculado a la hoja de cálculo:
// pega aquí su ID (la parte de la URL entre /d/ y /edit).
const ID_HOJA_DE_CALCULO = '';

// Columnas de cada pestaña de curso (el curso es la pestaña)
const COLUMNAS = ['ID', 'Nombre', 'Grupo', 'URL', 'Notas', 'Fecha'];

// Columnas de la hoja única antigua (incluye "Curso")
const COLUMNAS_LEGADO = ['ID', 'Curso', 'Nombre', 'Grupo', 'URL', 'Notas', 'Fecha'];

// Las hojas cuyo nombre empiece así se ignoran (copias de
// seguridad de migraciones anteriores)
const PREFIJO_BACKUP = '__backup__';

// Formato de fecha inequívoco, interpretable por la app
const FORMATO_FECHA = 'yyyy-MM-dd HH:mm';

// Contraseña de administrador (se guarda en Script Properties)
const CLAVE_PASSWORD = 'ADMIN_PASSWORD';
const PASSWORD_POR_DEFECTO = 'admin';

// ── GET: lectura de datos ────────────────────────────────
function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'read');
    if (action === 'read') {
      return json_({ success: true, data: leerTodo_() });
    }
    return json_({ success: false, error: 'Acción GET no válida: ' + action });
  } catch (err) {
    return json_({ success: false, error: mensajeDeError_(err) });
  }
}

// ── POST: escrituras y contraseña ────────────────────────
function doPost(e) {
  const p = (e && e.parameter) || {};
  try {
    switch (String(p.action || '')) {
      case 'create':          return json_(conBloqueo_(crearWiki_, p));
      case 'update':
        if (!esAdmin_(p)) return json_({ success: false, error: 'Contraseña de administrador incorrecta: solo el administrador puede editar wikis' });
        return json_(conBloqueo_(actualizarWiki_, p));
      case 'delete':
        if (!esAdmin_(p)) return json_({ success: false, error: 'Contraseña de administrador incorrecta: solo el administrador puede borrar wikis' });
        return json_(conBloqueo_(borrarWiki_, p));
      case 'verify_password': return json_(verificarPassword_(p));
      case 'change_password':
        if (!esAdmin_(p)) return json_({ success: false, error: 'Contraseña de administrador incorrecta: no se puede cambiar la contraseña' });
        return json_(conBloqueo_(cambiarPassword_, p));
      default:
        return json_({ success: false, error: 'Acción POST no válida: ' + p.action });
    }
  } catch (err) {
    return json_({ success: false, error: mensajeDeError_(err) });
  }
}

// ── Acción: crear wiki ───────────────────────────────────
function crearWiki_(p) {
  const libro = libro_();
  migrarLegado_(libro);

  const nombre = String(p.nombre || '').trim();
  const url = String(p.url || '').trim();
  if (!nombre) throw new Error('Falta el nombre del alumno');
  if (!url) throw new Error('Falta la URL de la wiki');

  const hoja = prepararPestanaCurso_(libro, p.curso);
  const id = Utilities.getUuid();
  anadirFilas_(hoja, [{
    id: id,
    nombre: nombre,
    grupo: String(p.grupo || '').trim(),
    url: url,
    notas: String(p.notas || '').trim(),
    fecha: Utilities.formatDate(new Date(), zona_(), FORMATO_FECHA)
  }]);
  return { success: true, id: id };
}

// ── Acción: actualizar wiki ──────────────────────────────
function actualizarWiki_(p) {
  const libro = libro_();
  migrarLegado_(libro);

  const id = String(p.id || '');
  const hallada = buscarWikiPorId_(libro, id);
  if (!hallada) throw new Error('No existe ninguna wiki con ID ' + id);

  const datos = {
    id: id,
    nombre: String(p.nombre || '').trim(),
    grupo: String(p.grupo || '').trim(),
    url: String(p.url || '').trim(),
    notas: String(p.notas || '').trim(),
    fecha: normalizarFecha_(hallada.datos.fecha) // se conserva la original
  };

  const cursoNuevo = String(p.curso || '').trim();
  const cursoActual = hallada.hoja.getName().trim();

  if (cursoNuevo !== cursoActual) {
    // Cambia de pestaña: se quita de su curso actual y se
    // añade a la pestaña del nuevo curso
    hallada.hoja.deleteRow(hallada.numeroFila);
    const destino = prepararPestanaCurso_(libro, cursoNuevo);
    anadirFilas_(destino, [datos]);
  } else {
    // Misma pestaña: se sobrescribe la fila (las columnas que
    // no gestiona la app se respetan)
    const cabeceras = leerCabeceras_(hallada.hoja);
    const filaActual = hallada.hoja.getRange(hallada.numeroFila, 1, 1, cabeceras.length).getValues()[0];
    const valores = [cabeceras.map(function (cab, i) {
      const v = datos[clave_(cab)];
      return v === undefined ? valorLegible_(filaActual[i]) : v;
    })];
    hallada.hoja.getRange(hallada.numeroFila, 1, 1, cabeceras.length).setValues(valores);
  }
  return { success: true };
}

// ── Acción: borrar wiki ──────────────────────────────────
function borrarWiki_(p) {
  const libro = libro_();
  migrarLegado_(libro);

  const id = String(p.id || '');
  const hallada = buscarWikiPorId_(libro, id);
  if (!hallada) throw new Error('No existe ninguna wiki con ID ' + id);
  hallada.hoja.deleteRow(hallada.numeroFila);
  return { success: true };
}

// ── Acciones: contraseña de administrador ────────────────
function verificarPassword_(p) {
  const guardada = PropertiesService.getScriptProperties().getProperty(CLAVE_PASSWORD) || PASSWORD_POR_DEFECTO;
  if (String(p.password || '') === guardada) return { success: true };
  return { success: false, error: 'Contraseña incorrecta' };
}

// Comprueba la contraseña de administrador enviada en la petición
// (parámetro "password"). Protege editar, borrar y cambiar la
// contraseña; crear wikis sigue permitido para cualquier usuario.
function esAdmin_(p) {
  const guardada = PropertiesService.getScriptProperties().getProperty(CLAVE_PASSWORD) || PASSWORD_POR_DEFECTO;
  return String(p.password || '') === guardada;
}

function cambiarPassword_(p) {
  const nueva = String(p.new_password || '');
  if (!nueva) return { success: false, error: 'La contraseña no puede estar vacía' };
  PropertiesService.getScriptProperties().setProperty(CLAVE_PASSWORD, nueva);
  return { success: true };
}

// ── Lectura: todas las wikis de todas las pestañas ───────
function leerTodo_() {
  const libro = libro_();
  migrarLegado_(libro);

  const filas = [];
  libro.getSheets().forEach(function (hoja) {
    if (!esPestanaDeCurso_(hoja.getName())) return;

    // Completa encabezados que falten (columnas añadidas en
    // versiones posteriores del script). Si no se pudiera
    // escribir, se sigue leyendo con lo que haya.
    try {
      completarEncabezados_(hoja, COLUMNAS);
    } catch (err) {
      console.error('[GAS Wikis] No se pudieron completar los encabezados de "' + hoja.getName() + '":', err);
    }

    const ultimaFila = hoja.getLastRow();
    const cabeceras = leerCabeceras_(hoja);
    if (ultimaFila < 2 || cabeceras.length === 0) return;

    const curso = hoja.getName().trim();
    hoja.getRange(2, 1, ultimaFila - 1, cabeceras.length).getValues().forEach(function (fila) {
      const d = filaADiccionario_(fila, cabeceras);
      if (!d.id) return; // filas vacías o de relleno
      filas.push({
        id: d.id,
        curso: curso,
        nombre: d.nombre || '',
        grupo: d.grupo || '',
        url: d.url || '',
        notas: d.notas || '',
        fecha: normalizarFecha_(d.fecha || '')
      });
    });
  });
  return filas;
}

// ── Migración de la hoja única antigua ───────────────────
function migrarLegado_(libro) {
  try {
    libro.getSheets().forEach(function (hoja) {
      if (esHojaLegado_(hoja)) migrarHojaLegado_(hoja, libro);
    });
  } catch (err) {
    console.error('[GAS Wikis] La migración de la hoja antigua no se pudo completar:', err);
  }
}

// Es "hoja antigua" si no es una pestaña de curso ni una
// copia de seguridad, y su primera fila tiene las columnas
// "Curso" y "Nombre" (la estructura de la versión anterior)
function esHojaLegado_(hoja) {
  const nombre = hoja.getName();
  if (esPestanaDeCurso_(nombre)) return false;
  if (nombre.indexOf(PREFIJO_BACKUP) === 0) return false;
  const claves = leerCabeceras_(hoja).map(clave_);
  return claves.indexOf('curso') !== -1 && claves.indexOf('nombre') !== -1;
}

function migrarHojaLegado_(hoja, libro) {
  // 1) Completar en la hoja antigua las columnas que falten
  //    (las añadidas en versiones posteriores del script)
  completarEncabezados_(hoja, COLUMNAS_LEGADO);
  const cabeceras = leerCabeceras_(hoja);

  // 2) Repartir sus filas en pestañas por curso, omitiendo
  //    las que ya se repartieran en un intento anterior: la
  //    migración se puede reintentar sin duplicar nada
  const ultimaFila = hoja.getLastRow();
  if (ultimaFila >= 2) {
    const idsYaMigrados = idsExistentesEnPestanasCurso_(libro);
    const porCurso = {};
    hoja.getRange(2, 1, ultimaFila - 1, hoja.getLastColumn()).getValues().forEach(function (fila) {
      const d = filaADiccionario_(fila, cabeceras);
      if (!d.nombre && !d.url) return;              // fila vacía
      if (!d.id) d.id = Utilities.getUuid();        // fila sin ID
      if (idsYaMigrados[d.id]) return;              // ya repartida antes
      d.fecha = normalizarFecha_(d.fecha);
      const curso = (d.curso || '').trim();
      if (!esPestanaDeCurso_(curso)) return;        // sin curso válido: se queda en la copia
      (porCurso[curso] = porCurso[curso] || []).push(d);
    });
    Object.keys(porCurso).forEach(function (curso) {
      anadirFilas_(prepararPestanaCurso_(libro, curso), porCurso[curso]);
    });
  }

  // 3) Conservar la hoja original como copia de seguridad
  renombrarComoBackup_(hoja, libro);
}

function renombrarComoBackup_(hoja, libro) {
  let nombre = PREFIJO_BACKUP + ' ' + hoja.getName();
  while (libro.getSheetByName(nombre)) nombre += '_';
  hoja.setName(nombre);
}

// ── Hojas y encabezados ──────────────────────────────────
function libro_() {
  if (ID_HOJA_DE_CALCULO) return SpreadsheetApp.openById(ID_HOJA_DE_CALCULO);
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  if (!libro) {
    throw new Error('No se detecta la hoja de cálculo: usa un proyecto vinculado a ella o pon su ID en ID_HOJA_DE_CALCULO');
  }
  return libro;
}

// Una pestaña de curso se llama igual que el curso: "AAAA-AAAA"
function esPestanaDeCurso_(nombre) {
  return /^\d{4}\s*-\s*\d{4}$/.test(String(nombre || '').trim());
}

// Devuelve la pestaña del curso, creándola si no existe, con
// sus encabezados completos y formateados
function prepararPestanaCurso_(libro, curso) {
  const nombre = String(curso || '').trim();
  if (!esPestanaDeCurso_(nombre)) {
    throw new Error('Curso no válido: "' + nombre + '" (se espera el formato AAAA-AAAA, p. ej. 2025-2026)');
  }
  let hoja = libro.getSheetByName(nombre);
  const nueva = !hoja;
  if (nueva) hoja = libro.insertSheet(nombre);
  completarEncabezados_(hoja, COLUMNAS);
  const encabezados = hoja.getRange(1, 1, 1, hoja.getLastColumn());
  encabezados.setFontWeight('bold');
  encabezados.setBackground('#e0e7ff');
  if (nueva) hoja.setFrozenRows(1);
  return hoja;
}

// Añade al final de la fila 1 las columnas que falten,
// contando como presentes las equivalentes (alias). Las
// celdas de encabezado vacías se rellenan en su sitio para no
// desalinear las columnas de datos. Devuelve true si la hoja
// se ha modificado.
function completarEncabezados_(hoja, columnas) {
  const existentes = leerCabeceras_(hoja);
  const clavesExistentes = existentes.map(clave_);
  const faltan = columnas.filter(function (c) { return clavesExistentes.indexOf(clave_(c)) === -1; });
  if (faltan.length === 0) return false;
  const fila1 = existentes.slice();
  let siguiente = 0;
  for (let i = 0; i < fila1.length && siguiente < faltan.length; i++) {
    if (!fila1[i]) fila1[i] = faltan[siguiente++];
  }
  while (siguiente < faltan.length) fila1.push(faltan[siguiente++]);
  hoja.getRange(1, 1, 1, fila1.length).setValues([fila1]);
  return true;
}

function leerCabeceras_(hoja) {
  const n = hoja.getLastColumn();
  if (n === 0) return [];
  return hoja.getRange(1, 1, 1, n).getValues()[0].map(function (v) {
    return String(v).trim();
  });
}

// ── Filas ────────────────────────────────────────────────
// Busca una wiki por ID en todas las pestañas de curso.
// Devuelve { hoja, numeroFila, datos } o null.
function buscarWikiPorId_(libro, id) {
  const objetivo = String(id || '');
  if (!objetivo) return null;

  const hojas = libro.getSheets();
  for (let h = 0; h < hojas.length; h++) {
    const hoja = hojas[h];
    if (!esPestanaDeCurso_(hoja.getName())) continue;

    const ultimaFila = hoja.getLastRow();
    const cabeceras = leerCabeceras_(hoja);
    const colId = cabeceras.findIndex(function (cab) { return clave_(cab) === 'id'; });
    if (ultimaFila < 2 || cabeceras.length === 0 || colId === -1) continue;

    const filas = hoja.getRange(2, 1, ultimaFila - 1, cabeceras.length).getValues();
    for (let i = 0; i < filas.length; i++) {
      if (String(filas[i][colId]) === objetivo) {
        return {
          hoja: hoja,
          numeroFila: 2 + i,
          datos: filaADiccionario_(filas[i], cabeceras)
        };
      }
    }
  }
  return null;
}

// IDs presentes en las pestañas de curso: sirve para que la
// migración de la hoja antigua no duplique filas al reintentarse
function idsExistentesEnPestanasCurso_(libro) {
  const ids = {};
  libro.getSheets().forEach(function (hoja) {
    if (!esPestanaDeCurso_(hoja.getName())) return;
    const cabeceras = leerCabeceras_(hoja);
    const colId = cabeceras.findIndex(function (cab) { return clave_(cab) === 'id'; });
    const ultimaFila = hoja.getLastRow();
    if (colId === -1 || ultimaFila < 2) return;
    hoja.getRange(2, colId + 1, ultimaFila - 1, 1).getValues().forEach(function (v) {
      const id = String(v[0] || '').trim();
      if (id) ids[id] = true;
    });
  });
  return ids;
}

// Añade filas al final de la hoja, colocando cada valor en
// la columna que indique su encabezado
function anadirFilas_(hoja, diccionarios) {
  if (!diccionarios.length) return;
  const cabeceras = leerCabeceras_(hoja);
  const valores = diccionarios.map(function (d) {
    return cabeceras.map(function (cab) {
      const v = d[clave_(cab)];
      return v === undefined || v === null ? '' : v;
    });
  });
  hoja.getRange(hoja.getLastRow() + 1, 1, valores.length, cabeceras.length).setValues(valores);
}

// Convierte una fila en { id, nombre, ... } usando los
// encabezados de la hoja como claves
function filaADiccionario_(fila, cabeceras) {
  const d = {};
  cabeceras.forEach(function (cab, i) {
    d[clave_(cab)] = valorLegible_(fila[i]);
  });
  return d;
}

// ── Utilidades ───────────────────────────────────────────
// Encabezados equivalentes: una pestaña creada con "Alumno"
// o "Enlace (URL)" funciona igual que con "Nombre" o "URL"
const ALIAS_COLUMNAS = {
  'curso academico': 'curso',
  'alumno': 'nombre',
  'nombre del alumno': 'nombre',
  'enlace': 'url',
  'enlace (url)': 'url',
  'url de la wiki': 'url',
  'notas / observaciones': 'notas',
  'notas y observaciones': 'notas',
  'observaciones': 'notas',
  'fecha de creacion': 'fecha'
};

// "Fecha de creación" → "fecha"; "Notas" → "notas"; "ID" → "id"
function clave_(cabecera) {
  const k = String(cabecera).toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim();
  return ALIAS_COLUMNAS[k] || k;
}

function valorLegible_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, zona_(), FORMATO_FECHA);
  return String(v);
}

function zona_() {
  try {
    return Session.getScriptTimeZone() || 'Europe/Madrid';
  } catch (e) {
    return 'Europe/Madrid';
  }
}

// Normaliza fechas al formato de la app. Acepta objetos Date
// y textos "dd/MM/yyyy[ HH:mm]" (el formato de las versiones
// anteriores); cualquier otra cosa se devuelve tal cual.
function normalizarFecha_(valor) {
  if (!valor) return '';
  if (valor instanceof Date) return Utilities.formatDate(valor, zona_(), FORMATO_FECHA);
  const t = String(valor).trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(t);
  if (m) {
    const yyyy = m[3];
    const MM = ('0' + m[2]).slice(-2);
    const dd = ('0' + m[1]).slice(-2);
    const HH = ('0' + (m[4] || '0')).slice(-2);
    const mm = m[5] || '00';
    return yyyy + '-' + MM + '-' + dd + ' ' + HH + ':' + mm;
  }
  return t;
}

// Serializa los accesos de escritura para evitar carreras
function conBloqueo_(funcion, parametros) {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(10000);
  try {
    return funcion(parametros);
  } finally {
    bloqueo.releaseLock();
  }
}

function json_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function mensajeDeError_(err) {
  return String((err && err.message) || err);
}
