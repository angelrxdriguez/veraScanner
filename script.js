// =========================
// OCR + IA (Gemini) – Client-only (Vercel friendly) usando OFERTAS
// Requiere: Bootstrap 5 (modal), RemixIcon opcional.
// Para usar Gemini: define window.GEMINI_API_KEY o <meta name="gemini-key" ...>
// =========================

// --- Comprobación rápida de Gemini ---
window.pingGemini = async function () {
  try {
    const out = await callGeminiJSON(
      'Eres un bot de prueba. Responde solo JSON.',
      'Devuelve exactamente {"pong":true} y nada más.'
    );
    console.log('Ping Gemini →', out);
    alert('Gemini OK: ' + JSON.stringify(out));
  } catch (e) {
    console.error('Ping Gemini fallo:', e);
    alert('Gemini ERROR: ' + (e?.message || e));
  }
};

// --------- Elementos del DOM ----------
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const btnStart = document.getElementById('btnStart');
const btnCapture = document.getElementById('btnCapture');
const btnStop = document.getElementById('btnStop');
const fileInput = document.getElementById('fileInput');
const ocrProgressWrap = document.getElementById('ocrProgressWrap');
const ocrProgressBar = document.getElementById('ocrProgressBar');
const textoDetectado = document.getElementById('textoDetectado');
const ocrLoading = document.getElementById('ocrLoading');
const flashOverlay = document.getElementById('flashOverlay');

let stream = null;

// --------- Estado IA/Ofertas ----------
const GEMINI_MODEL = window.GEMINI_MODEL || 'gemini-2.5-flash';
let GEMINI_API_KEY =
  (typeof window !== 'undefined' && window.GEMINI_API_KEY) ||
  (document.querySelector('meta[name="gemini-key"]')?.content) ||
  null;

// Datos cargados de ofertas.json
let OFFERS_LIST = []; // [{id, articulo, variedad, cultivo, cliente, vuelo, ...}, ...]
let OFFERS_READY = false;

// Índices para shortlist rápidos
const OFFERS_BY_VUELO = new Map();        // vueloNorm -> [offers...]
const OFFERS_BY_CULTIVO = new Map();      // cultivoNorm -> [offers...]
const OFFERS_BY_VAR_TOKEN = new Map();    // primerTokenVariedad -> [offers...]
let CULTIVOS_NORM_UNICOS = [];            // lista de cultivos únicos normalizados (para búsqueda en OCR)
const CULTIVO_ORIG_BY_NORM = new Map();   // cultivoNorm -> cultivo original (por si hay casing)

// =========================
// Helpers de UI
// =========================
ocrLoading.style.display = 'none';

function triggerFlash() {
  flashOverlay.classList.add('active');
  setTimeout(() => flashOverlay.classList.remove('active'), 300);
}

function playShutterSound() {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(400, audioContext.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch {}
}

const showProgress = () => {
  ocrProgressWrap.classList.remove('d-none');
  ocrProgressBar.style.width = '100%';
  ocrProgressBar.textContent = 'Procesando...';
  ocrProgressBar.classList.add('progress-bar-animated');
};

const hideProgress = () => {
  ocrProgressWrap.classList.add('d-none');
  ocrProgressBar.style.width = '0%';
  ocrProgressBar.textContent = '';
  ocrProgressBar.classList.remove('progress-bar-animated');
};

// =========================
// Cámara
// =========================
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Tu navegador no permite acceso a la cámara. Usa la opción "Subir foto".');
    return;
  }
  try {
    btnStart.textContent = 'Conectando...';
    btnStart.disabled = true;
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    btnCapture.disabled = false;
    btnCapture.classList.remove('processing');
    btnStop.disabled = false;
    btnStart.textContent = '✅ Cámara Activa';
    btnStart.disabled = true;
    console.log('Cámara iniciada correctamente');
  } catch (err) {
    console.error('Error:', err);
    btnStart.disabled = false;
    btnStart.textContent = 'Activar';
    alert('No se pudo acceder a la cámara. Verifica los permisos.');
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  video.srcObject = null;
  btnCapture.disabled = true;
  btnCapture.classList.remove('processing');
  btnStop.disabled = true;
  btnStart.disabled = false;
  btnStart.textContent = 'Activar';
}

function captureImage() {
  const videoWidth = video.videoWidth || 1280;
  const videoHeight = video.videoHeight || 720;
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// =========================
// Normalización + Heurísticas comunes
// =========================
function normalizarTexto(s) {
  if (!s) return '';
  const sinTildes = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // normaliza patrones espaciados: "60 - 4" -> "60-4", "x 500" -> "x500"
  let out = sinTildes
    .toUpperCase()
    .replace(/[•·•·•·]/g, ' ')
    .replace(/[^\w\s\-\+\/x:]/g, ' ') // conserva -, +, /, x y ':'
    .replace(/\b(\d+)\s*-\s*(\d+)\b/g, '$1-$2')
    .replace(/\bx\s*(\d+)\b/gi, 'x$1')
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

function normalizeVuelo(s) {
  if (!s) return '';
  return s.toUpperCase().replace(/:/g, '').replace(/\s+/g, ' ').trim();
}

function detectarVuelo(texto) {
  if (!texto) return '';
  const patronesVuelo = [
    /:\d{3}-\d{4}\s+\d{4}/,
    /:\d{3}-\d{4}\s\d{4}/,
    /\d{3}-\d{4}\s+\d{4}/,
    /\d{3}-\d{4}\s\d{4}/,
    /:\d{3}-\d{4}\d{4}/,
    /\d{3}-\d{4}\d{4}/,
    /:\d{3}-\d{4}/,
    /\d{3}-\d{4}/,
  ];
  for (const patron of patronesVuelo) {
    const match = texto.match(patron);
    if (match) return match[0].replace(/^:/, ''); // sin ':'
  }
  return '';
}

function extraerPatronesNumericos(ocrn) {
  const out = new Set();
  // DD-DD, DDD-D
  const a = ocrn.match(/\b\d{2,3}-\d{1,3}\b/g);
  if (a) a.forEach(x => out.add(x));
  // xDDD, xDDDD
  const b = ocrn.match(/x\d{2,4}\b/gi);
  if (b) b.map(x => x.toUpperCase()).forEach(x => out.add(x));
  return Array.from(out);
}

function tokensFuertes(ocrn) {
  const stop = new Set(['AWB','HAWB','RUC','PACKING','DATE','FORWARDER','ALLIANCE','GROUP','ECUADOR','LENGTH','BUNCH','STEM','PCS','CM','ROSES','ROSELY','FLOWERS','VERALEZA','SLU','LOGIZTIK','ALLIANCE','GROUP']);
  return Array.from(new Set(ocrn.split(/\s+/))).filter(t => t && t.length >= 3 && !/^\d+$/.test(t) && !stop.has(t));
}

// Heurística para extraer "variedad" textual del OCR (línea tras VARIETY o token+patrón)
function inferirVariedadTextoDesdeOCR(ocr_text) {
  const ocrn = normalizarTexto(ocr_text);
  const lineas = ocrn.split(/\r?\n/);

  // 1) línea cercana a VARIETY/VAR:
  let pos = -1;
  for (let i = 0; i < lineas.length; i++) {
    const ln = lineas[i];
    if (ln.includes('VARIETY') || ln.includes('VAR:') || ln.includes('VARIEDAD')) { pos = i; break; }
  }
  let candidata = '';
  if (pos >= 0) {
    for (let j = pos + 1; j < Math.min(pos + 5, lineas.length); j++) {
      const ln = lineas[j].trim();
      if (!ln) continue;
      if (/^[A-Z0-9][A-Z0-9\-\/ ]{2,}$/.test(ln)) { candidata = ln; break; }
    }
  }

  // 2) patrón numérico 50-4 o x500
  let numPat = '';
  const m1 = ocrn.match(/\b\d{2,3}-\d{1,3}\b/);
  if (m1) numPat = m1[0];
  if (!numPat) {
    const m2 = ocrn.match(/x\d{2,4}\b/i);
    if (m2) numPat = m2[0].toUpperCase();
  }

  if (candidata && numPat) {
    return `${candidata} ${numPat}`.replace(/\s+/g, ' ').trim();
  } else if (candidata) {
    return candidata;
  } else if (numPat) {
    const m3 = ocrn.match(new RegExp(`([A-Z]{3,})(?:\\s+[A-Z]{3,}){0,2}\\s+${numPat.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`));
    if (m3) return m3[0].trim();
    return numPat;
  }
  return '';
}

function primerTokenVariedad(s) {
  const norm = normalizarTexto(s);
  const m = norm.match(/^[A-Z0-9]+/);
  return m ? m[0] : '';
}

// =========================
// Carga de ofertas.json (cliente)
// =========================
async function loadOfertasOnce() {
  if (OFFERS_READY) return;

  const posiblesRutas = [
    '/ofertas.json',
    './ofertas.json',
    '../ofertas.json',
    '/data/ofertas.json'
  ];

  let json = null;
  for (const p of posiblesRutas) {
    try {
      const r = await fetch(p, { cache: 'no-store' });
      if (r.ok) {
        json = await r.json();
        break;
      }
    } catch {}
  }
  if (!json) {
    console.warn('No se pudo cargar ofertas.json. Solo funcionará la heurística básica sin correspondencia a cliente.');
    OFFERS_LIST = [];
    OFFERS_READY = true;
    return;
  }

  // Estructuras admitidas:
  // A) phpMyAdmin export: [ {type:"header"}, {type:"database"}, {type:"table", name:"ofertas", data:[...] } ]
  // B) { data: [...] }
  // C) [ {...}, {...} ]
  let rows = [];
  if (Array.isArray(json) && json[2]?.type === 'table') {
    rows = json[2].data || [];
  } else if (Array.isArray(json)) {
    rows = json;
  } else if (json?.data) {
    rows = json.data;
  }

  OFFERS_LIST = rows.map(r => ({
    id: r.id ?? r.ID ?? null,
    articulo: r.articulo ?? r.Articulo ?? '',
    variedad: r.variedad ?? r.Variedad ?? '',
    cultivo: r.cultivo ?? r.Cultivo ?? '',
    cliente: r.cliente ?? r.Cliente ?? '',
    vuelo: r.vuelo ?? r.Vuelo ?? '',
    fecha: r.fecha ?? r.Fecha ?? '',
    ubicacion: r.ubicacion ?? r.Ubicacion ?? '',
    disponible: r.disponible ?? r.Disponible ?? ''
  }));

  // Índices
  OFFERS_BY_VUELO.clear();
  OFFERS_BY_CULTIVO.clear();
  OFFERS_BY_VAR_TOKEN.clear();
  CULTIVOS_NORM_UNICOS = [];
  CULTIVO_ORIG_BY_NORM.clear();

  const cultivosSet = new Set();

  for (const ofr of OFFERS_LIST) {
    // Vuelo
    const vKey = normalizeVuelo(ofr.vuelo || '');
    if (vKey) {
      if (!OFFERS_BY_VUELO.has(vKey)) OFFERS_BY_VUELO.set(vKey, []);
      OFFERS_BY_VUELO.get(vKey).push(ofr);
    }
    // Cultivo
    const cKey = normalizarTexto(ofr.cultivo || '');
    if (cKey) {
      if (!OFFERS_BY_CULTIVO.has(cKey)) OFFERS_BY_CULTIVO.set(cKey, []);
      OFFERS_BY_CULTIVO.get(cKey).push(ofr);
      cultivosSet.add(cKey);
      if (!CULTIVO_ORIG_BY_NORM.has(cKey)) CULTIVO_ORIG_BY_NORM.set(cKey, ofr.cultivo);
    }
    // Primer token de variedad
    const t = primerTokenVariedad(ofr.variedad || '');
    if (t) {
      if (!OFFERS_BY_VAR_TOKEN.has(t)) OFFERS_BY_VAR_TOKEN.set(t, []);
      OFFERS_BY_VAR_TOKEN.get(t).push(ofr);
    }
  }
  CULTIVOS_NORM_UNICOS = Array.from(cultivosSet);

  OFFERS_READY = true;
  console.log(`Ofertas cargadas: ${OFFERS_LIST.length}`);
}

// Detecta cultivo en OCR comparando contra cultivos de ofertas
function detectarCultivo(ocrn) {
  if (!CULTIVOS_NORM_UNICOS.length) return '';
  let mejor = '';
  for (const c of CULTIVOS_NORM_UNICOS) {
    if (ocrn.includes(c) && c.length > mejor.length) {
      mejor = c;
    }
  }
  return mejor; // normalizado
}

// =========================
// Construcción de SHORTLIST de OFERTAS
// Lógica: vuelo → cultivo → similitud de variedad
// =========================
function construirShortlistOfertas(ocrText, ocrn, maxTotal = 20) {
  if (!OFFERS_READY || !OFFERS_LIST.length) return [];

  const vueloDet = detectarVuelo(ocrText);
  const vueloKey = normalizeVuelo(vueloDet);
  const cultivoDetNorm = detectarCultivo(ocrn);

  let candidatos = [];

  if (vueloKey && OFFERS_BY_VUELO.has(vueloKey)) {
    candidatos = OFFERS_BY_VUELO.get(vueloKey).slice();
  } else {
    candidatos = OFFERS_LIST.slice(); // sin vuelo, abrimos a todas
  }

  if (cultivoDetNorm && OFFERS_BY_CULTIVO.has(cultivoDetNorm)) {
    // Filtrar por cultivo si existe en el texto
    const setIds = new Set(OFFERS_BY_CULTIVO.get(cultivoDetNorm).map(o => o.id));
    candidatos = candidatos.filter(o => setIds.has(o.id));
  }

  // Scoring por similitud con la "variedad textual" + patrones numéricos
  const varText = inferirVariedadTextoDesdeOCR(ocrText);
  const varToken = primerTokenVariedad(varText);
  const pats = extraerPatronesNumericos(ocrn);

  function scoreOferta(ofr) {
    let score = 0;

    // Vuelo exacto = +0.5
    if (vueloKey && normalizeVuelo(ofr.vuelo) === vueloKey) score += 0.5;

    // Cultivo = +0.2
    if (cultivoDetNorm && normalizarTexto(ofr.cultivo) === cultivoDetNorm) score += 0.2;

    // Patrones numéricos en variedad = hasta +0.4
    const vnorm = normalizarTexto(ofr.variedad || '');
    let hits = 0;
    for (const p of pats) if (vnorm.includes(p)) hits++;
    if (pats.length) score += Math.min(0.4, (hits / pats.length) * 0.4);

    // Coincidencia primer token variedad = +0.2
    if (varToken && primerTokenVariedad(ofr.variedad || '') === varToken) score += 0.2;

    // Pequeña bonificación si el token fuerte aparece en el nombre de variedad
    const toks = tokensFuertes(ocrn);
    let tokMatch = 0;
    for (const t of toks) if (vnorm.includes(t)) { tokMatch = 1; break; }
    score += tokMatch * 0.1;

    return score;
  }

  const ordenadas = candidatos
    .map(o => ({ o, s: scoreOferta(o) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, maxTotal)
    .map(x => x.o);

  // Si nada quedó (casos extremos), devolvemos primeras n del total
  if (!ordenadas.length) return OFFERS_LIST.slice(0, Math.min(maxTotal, OFFERS_LIST.length));
  return ordenadas;
}

// =========================
// Gemini – plantilla prompt para OFERTAS
// =========================
function buildGeminiPrompt(systemText, userText) {
  return {
    systemInstruction: { role: 'system', parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: { response_mime_type: 'application/json' } // fuerza JSON-mode
  };
}

function systemTemplateOfertas() {
  return `Eres un analista experto en etiquetas de flores. Tu tarea es identificar la OFERTA exacta únicamente entre un LISTADO de candidatos (shortlist).
Debes elegir UNA oferta del shortlist (no inventes nada fuera).
Devuelve SIEMPRE JSON válido y nada más.`;
}

function userTemplateOfertas({ ocr_text, ocrn, shortlist }) {
  // El shortlist lo enviamos como objetos legibles con id y campos clave
  const sl = shortlist.map(s => ({
    id: String(s.id ?? ''),
    variedad: String(s.variedad ?? ''),
    cultivo: String(s.cultivo ?? ''),
    cliente: String(s.cliente ?? ''),
    vuelo: String(s.vuelo ?? '')
  }));
  return `# CONTEXTO
1) OCR_TEXT (ruidoso)
2) OCR_TEXT_NORMALIZADO (mayúsculas, sin tildes, separadores - + / x)
3) SHORTLIST de OFERTAS: solo puedes elegir UNA por id.

# OBJETIVO
- Si hay un vuelo que coincida con OCR, priorízalo.
- Si hay cultivo en OCR, úsalo para refinar.
- Después, elige la oferta cuya VARIEDAD encaje mejor (patrones 40-12, 50-4, x500; cercanía a "VARIETY"/"VAR:").
- Ignora números logísticos (AWB/HAWB/RUC).
- Si no estás razonablemente seguro, elige la mejor del shortlist e indica una "conf" baja.

# SALIDA JSON ESTRICTA
{
  "id": "<id de la oferta elegida o \\"\\" si ninguna>",
  "variedad": "<texto>",
  "cliente": "<texto>",
  "cultivo": "<texto>",
  "vuelo": "<texto>",
  "conf": <0..1>,
  "evidencia": "<<=140 chars con las palabras/números clave>"
}

OCR_TEXT = <<<OCR
${ocr_text}
OCR

OCR_TEXT_NORMALIZADO = <<<OCRN
${ocrn}
OCRN

SHORTLIST = ${JSON.stringify(sl, null, 2)}`;
}

// Llamada REST a Gemini v1beta
async function callGeminiJSON(systemText, userText) {
  if (!GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const body = buildGeminiPrompt(systemText, userText);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Gemini HTTP ${resp.status} ${txt}`);
  }
  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('Gemini sin texto de salida');

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
  }
  if (!parsed) throw new Error('Gemini no devolvió JSON válido');
  return parsed;
}

// =========================
// Fallback heurístico de selección de oferta (sin IA)
// =========================
function seleccionarOfertaHeuristica(ocrText, ocrn) {
  if (!OFFERS_LIST.length) {
    // No tenemos ofertas para mapear a cliente
    const varTxt = inferirVariedadTextoDesdeOCR(ocrText);
    return { id: '', variedad: varTxt || '', cliente: '', cultivo: '', vuelo: '', conf: 0, evidencia: 'Sin ofertas.json' };
  }

  const shortlist = construirShortlistOfertas(ocrText, ocrn, 30);
  // Reutilizamos el score de shortlist y elegimos la mejor
  const vueloKey = normalizeVuelo(detectarVuelo(ocrText));
  const cultivoDetNorm = detectarCultivo(ocrn);
  const varToken = primerTokenVariedad(inferirVariedadTextoDesdeOCR(ocrText));
  const pats = extraerPatronesNumericos(ocrn);

  function score(ofr) {
    let s = 0;
    if (vueloKey && normalizeVuelo(ofr.vuelo) === vueloKey) s += 0.5;
    if (cultivoDetNorm && normalizarTexto(ofr.cultivo) === cultivoDetNorm) s += 0.2;
    const vnorm = normalizarTexto(ofr.variedad);
    let hits = 0; for (const p of pats) if (vnorm.includes(p)) hits++;
    if (pats.length) s += Math.min(0.4, (hits / pats.length) * 0.4);
    if (varToken && primerTokenVariedad(ofr.variedad) === varToken) s += 0.2;
    return s;
  }

  const mejor = shortlist
    .map(o => ({ o, s: score(o) }))
    .sort((a, b) => b.s - a.s)[0];

  if (mejor && mejor.o) {
    return {
      id: String(mejor.o.id ?? ''),
      variedad: mejor.o.variedad || '',
      cliente: mejor.o.cliente || '',
      cultivo: mejor.o.cultivo || '',
      vuelo: mejor.o.vuelo || '',
      conf: Math.max(0.45, Math.min(0.9, mejor.s)), // escala orientativa
      evidencia: `Heurística: vuelo/cultivo/patrones (${mejor.s.toFixed(2)})`
    };
  }

  const varTxt = inferirVariedadTextoDesdeOCR(ocrText);
  return { id: '', variedad: varTxt || '', cliente: '', cultivo: '', vuelo: '', conf: 0.3, evidencia: 'Sin señales fuertes' };
}

// =========================
// Detección IA de OFERTA (cliente) – usa shortlist + Gemini
// Devuelve: { id, variedad, cliente, cultivo, vuelo, conf, evidencia }
// =========================
async function detectarOfertaIA(ocrText) {
  await loadOfertasOnce();
  const ocrn = normalizarTexto(ocrText);

  const shortlist = construirShortlistOfertas(ocrText, ocrn, 20);

  if (!GEMINI_API_KEY || !shortlist.length) {
    console.warn('IA: usando heurística (sin clave o sin shortlist).');
    return seleccionarOfertaHeuristica(ocrText, ocrn);
  }

  try {
    const sys = systemTemplateOfertas();
    const usr = userTemplateOfertas({ ocr_text: ocrText, ocrn, shortlist });
    const out = await callGeminiJSON(sys, usr);

    let { id = '', variedad = '', cliente = '', cultivo = '', vuelo = '', conf = null, evidencia = '' } = out || {};
    id = String(id || '').trim();

    // Si Gemini devolvió un id no presente, cae a heurística
    const ok = id && shortlist.some(x => String(x.id) === id);
    if (!ok) {
      console.warn('Gemini devolvió id fuera del shortlist → heurística');
      return seleccionarOfertaHeuristica(ocrText, ocrn);
    }

    // Completa campos si vienen vacíos
    const ref = shortlist.find(x => String(x.id) === id);
    if (ref) {
      if (!variedad) variedad = ref.variedad || '';
      if (!cliente) cliente = ref.cliente || '';
      if (!cultivo) cultivo = ref.cultivo || '';
      if (!vuelo) vuelo = ref.vuelo || '';
    }

    return { id, variedad, cliente, cultivo, vuelo, conf, evidencia };
  } catch (e) {
    console.warn('Gemini fallo → heurística. Motivo:', e.message || e);
    return seleccionarOfertaHeuristica(ocrText, ocrn);
  }
}

// =========================
// OCR con OCR.space
// =========================
async function processOCR(imageData) {
  try {
    showProgress();
    console.log('Iniciando OCR...');
    const response = await fetch(imageData);
    const blob = await response.blob();

    const formData = new FormData();
    formData.append('file', blob, 'image.jpg');
    formData.append('language', 'spa');
    formData.append('isOverlayRequired', 'false');
    formData.append('detectOrientation', 'false');
    formData.append('scale', 'true');
    formData.append('OCREngine', '2');

    const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { 'apikey': 'helloworld' }, // Demo key. Sustituye por tu key real para uso serio.
      body: formData
    });

    if (!ocrResponse.ok) throw new Error('Error en la API OCR');

    const result = await ocrResponse.json();
    console.log('Respuesta OCR:', result);
    hideProgress();

    let cleanText = '';
    if (result.ParsedResults && result.ParsedResults.length > 0) {
      cleanText = (result.ParsedResults[0].ParsedText || '').trim();
    }

    if (!cleanText) {
      textoDetectado.textContent = 'No se detectó texto en la imagen.';
    } else {
      console.log('Texto OCR detectado:', cleanText);
      console.log('Texto normalizado:', normalizarTexto(cleanText));

      // 🔮 IA: decidir OFERTA → mostrar CLIENTE + VARIEDAD
      textoDetectado.textContent = 'Asignando caja al cliente…';
      const oferta = await detectarOfertaIA(cleanText);

      if (oferta && (oferta.cliente || oferta.variedad)) {
        // Muestra información mínima útil para logística
        const linea = `CLIENTE: ${oferta.cliente || '—'}\nVARIEDAD: ${oferta.variedad || '—'}`;
        textoDetectado.textContent = linea;
        console.log('Oferta elegida:', oferta);
      } else {
        textoDetectado.textContent = 'No se pudo determinar cliente/variedad.';
        console.log('Sin oferta clara para el texto:', cleanText);
      }
    }

    const modal = new bootstrap.Modal(document.getElementById('resultadoModal'));
    modal.show();

  } catch (error) {
    hideProgress();
    console.error('Error OCR:', error);
    try {
      await processOCRLocal(imageData);
    } catch (fallbackError) {
      console.error('Fallback falló:', fallbackError);
      textoDetectado.textContent = 'Error procesando la imagen. Intenta con mejor iluminación.';
      const modal = new bootstrap.Modal(document.getElementById('resultadoModal'));
      modal.show();
    }
  }
}

// =========================
// OCR local (fallback visual)
// =========================
async function processOCRLocal(imageData) {
  const img = new Image();
  img.src = imageData;
  await new Promise(resolve => { img.onload = resolve; });

  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  tempCanvas.width = img.width;
  tempCanvas.height = img.height;
  tempCtx.filter = 'contrast(150%) brightness(110%)';
  tempCtx.drawImage(img, 0, 0);

  textoDetectado.textContent =
    'Imagen capturada correctamente. Para mejor reconocimiento:\n' +
    '• Buena iluminación\n• Enfoque claro\n• Texto grande\n• Sin reflejos\n\n' +
    'Cuando tengas conexión, usa el OCR online.';
  const modal = new bootstrap.Modal(document.getElementById('resultadoModal'));
  modal.show();
}

// =========================
// Eventos UI
// =========================
btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click', stopCamera);

btnCapture.addEventListener('click', async () => {
  try {
    triggerFlash();
    playShutterSound();

    btnCapture.classList.add('processing');
    btnCapture.setAttribute('aria-busy', 'true');
    btnCapture.disabled = true;
    btnCapture.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';

    const imageData = captureImage();
    console.log('Imagen capturada, procesando OCR...');
    await processOCR(imageData);

  } catch (error) {
    console.error('Error:', error);
    alert('Error al capturar la imagen');
  } finally {
    btnCapture.classList.remove('processing');
    btnCapture.removeAttribute('aria-busy');
    btnCapture.disabled = false;
    btnCapture.innerHTML = '<i class="ri-camera-line"></i>';
  }
});

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    console.log('Procesando archivo:', file.name);
    const imageData = await fileToBase64(file);
    await processOCR(imageData);
  } catch (error) {
    console.error('Error:', error);
    alert('Error procesando el archivo');
  } finally {
    fileInput.value = '';
  }
});

document.getElementById('btnCopiar').addEventListener('click', async () => {
  try {
    const text = textoDetectado.textContent || '';
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('btnCopiar');
    const originalText = btn.textContent;
    btn.textContent = '¡Copiado!';
    setTimeout(() => { btn.textContent = originalText; }, 1500);
  } catch (error) {
    console.error('Error copiando:', error);
    alert('No se pudo copiar al portapapeles');
  }
});

window.addEventListener('beforeunload', () => { stopCamera(); });

console.log('Script cargado correctamente - Listo para usar');
