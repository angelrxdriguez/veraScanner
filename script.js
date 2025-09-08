// =========================
// OCR + IA (Gemini) – Client-only (Vercel friendly)
// Requiere: Bootstrap 5 (modal), RemixIcon opcional.
// Para usar Gemini: define window.GEMINI_API_KEY o <meta name="gemini-key" ...>
// =========================

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

// --------- Estado IA/Variedades ----------
const GEMINI_MODEL = 'gemini-1.5-flash';
let GEMINI_API_KEY =
  (typeof window !== 'undefined' && window.GEMINI_API_KEY) ||
  (document.querySelector('meta[name="gemini-key"]')?.content) ||
  null;

let VARIEDADES_LIST = [];                // ["PHOENIX 60-4", "EXPLORER 40-12", ...]
let VARIEDADES_INDEX_PRIMER_TOKEN = {};  // { "PHOENIX": ["PHOENIX 60-4", ...], ... }
let VARIEDADES_READY = false;

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
// Normalización + Heurísticas
// =========================
function normalizarTexto(s) {
  if (!s) return '';
  const sinTildes = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // normaliza patrones espaciados: "60 - 4" -> "60-4", "x 500" -> "x500"
  let out = sinTildes
    .toUpperCase()
    .replace(/[•·•·•·]/g, ' ')
    .replace(/[^\w\s\-\+\/x]/g, ' ') // conserva -, +, / y 'x'
    .replace(/\b(\d+)\s*-\s*(\d+)\b/g, '$1-$2')
    .replace(/\bx\s*(\d+)\b/gi, 'x$1')
    .replace(/\s+/g, ' ')
    .trim();
  return out;
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
    if (match) return match[0].replace(/^:/, '');
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

// =========================
// Carga de variedades.json (cliente)
// Admite export de phpMyAdmin como el ejemplo del usuario.
// =========================
async function loadVariedadesOnce() {
  if (VARIEDADES_READY) return;
  const posiblesRutas = [
    '/variedades.json',
    './variedades.json',
    '../variedades.json',
    '/data/variedades.json'
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
    console.warn('No se pudo cargar variedades.json. La IA seguirá con heurísticas.');
    VARIEDADES_LIST = [];
    VARIEDADES_INDEX_PRIMER_TOKEN = {};
    VARIEDADES_READY = true;
    return;
  }

  // Detectar estructura:
  // Caso 1 (phpMyAdmin): [ {type:"header"}, {type:"database"}, {type:"table", name:"variedades", data:[...] } ]
  // Caso 2: { data: [...] } o directamente [ ... ]
  let rows = [];
  if (Array.isArray(json) && json[2]?.type === 'table') {
    rows = json[2].data || [];
  } else if (Array.isArray(json)) {
    rows = json;
  } else if (json?.data) {
    rows = json.data;
  }

  // Extraer "nombre"
  const nombres = [];
  rows.forEach(r => {
    const n = r.nombre || r.Nombre || r.variedad || r.Variedad;
    if (n && typeof n === 'string') nombres.push(n.trim());
  });

  VARIEDADES_LIST = Array.from(new Set(nombres));

  // Índice por primer token
  VARIEDADES_INDEX_PRIMER_TOKEN = {};
  for (const v of VARIEDADES_LIST) {
    const norm = normalizarTexto(v);
    const m = norm.match(/^[A-Z0-9]+/);
    const primer = m ? m[0] : null;
    if (!primer) continue;
    if (!VARIEDADES_INDEX_PRIMER_TOKEN[primer]) VARIEDADES_INDEX_PRIMER_TOKEN[primer] = [];
    VARIEDADES_INDEX_PRIMER_TOKEN[primer].push(v);
  }
  VARIEDADES_READY = true;
  console.log(`Variedades cargadas: ${VARIEDADES_LIST.length}`);
}

// =========================
/** Shortlist: usa tokens fuertes + patrones numéricos + primer token en catálogo */
function construirShortlist(ocrn, maxTotal = 20, maxPorFamilia = 6) {
  if (!VARIEDADES_READY) return [];
  const pats = extraerPatronesNumericos(ocrn);
  const tokens = tokensFuertes(ocrn);

  const shortlist = [];
  const ya = new Set();

  for (const tok of tokens) {
    const familia = VARIEDADES_INDEX_PRIMER_TOKEN[tok];
    if (!familia) continue;

    // priorizar los que contengan algún patrón numérico
    const preferidos = [];
    const otros = [];
    for (const cand of familia) {
      const norm = normalizarTexto(cand);
      let matchNum = false;
      for (const p of pats) {
        if (norm.includes(p)) { matchNum = true; break; }
      }
      if (matchNum) preferidos.push(cand); else otros.push(cand);
    }
    const orden = [...preferidos, ...otros];

    let cupo = maxPorFamilia;
    for (const c of orden) {
      if (shortlist.length >= maxTotal) break;
      if (!ya.has(c)) {
        shortlist.push(c);
        ya.add(c);
        cupo--;
        if (cupo <= 0) break;
      }
    }
    if (shortlist.length >= maxTotal) break;
  }

  if (!shortlist.length) {
    // relleno por si hay cero tokens en catálogo (texto muy ruidoso)
    return VARIEDADES_LIST.slice(0, Math.min(maxTotal, VARIEDADES_LIST.length));
  }
  return shortlist;
}

// =========================
// Gemini – plantilla prompt
// =========================
function buildGeminiPrompt(systemText, userText) {
  return {
    // systemInstruction disponible en v1beta
    systemInstruction: {
      role: 'system',
      parts: [{ text: systemText }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userText }]
      }
    ]
  };
}

function systemTemplate() {
  return `Eres un analista experto en etiquetas de flores. Tu tarea es identificar la VARIEDAD exacta únicamente entre un LISTADO de candidatos (shortlist).
Prohibido inventar nombres fuera del shortlist.
Responde SIEMPRE en JSON válido y NADA MÁS.`;
}

function userTemplate({ ocr_text, ocrn, shortlist }) {
  const sl = shortlist.map(s => `"${s.replace(/"/g, '\\"')}"`).join(',\n');
  return `# CONTEXTO
1) OCR_TEXT: texto bruto con posible ruido.
2) OCR_TEXT_NORMALIZADO: mayúsculas, sin tildes, con separadores (-, +, /, x).
3) SHORTLIST: solo puedes elegir UNA variedad de esta lista.

# OBJETIVO
Selecciona la variedad más probable del SHORTLIST usando patrones como 40-12, 50-4, x500 y cercanía a tokens "VARIETY"/"VAR:".
Ignora números logísticos como AWB/HAWB/RUC.
Si no hay coincidencia razonable, devuelve "variedad": "".

# CONFIANZA
Devuelve "conf" 0..1 (≥0.80 muy seguro).

# SALIDA ESTRICTA (JSON)
{
  "variedad": "<uno del SHORTLIST o \\"\\" >",
  "conf": <0..1>,
  "candidates": [
    {"nombre": "<shortlist>", "score": <0..1>}
  ],
  "evidencia": "<máx 140 chars>"
}

OCR_TEXT = <<<OCR
${ocr_text}
OCR

OCR_TEXT_NORMALIZADO = <<<OCRN
${ocrn}
OCRN

SHORTLIST = [
${sl}
]`;
}

// Llamada REST a Gemini v1beta
async function callGeminiJSON(systemText, userText) {
  if (!GEMINI_API_KEY) {
    throw new Error('Falta GEMINI_API_KEY');
  }
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
  // estructura: candidates[0].content.parts[].text
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('Gemini sin texto de salida');

  // intentar parsear JSON
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch {}
    }
  }
  if (!parsed) throw new Error('Gemini no devolvió JSON válido');
  return parsed;
}

// =========================
// Fallback heurístico si IA falla o no hay API key
// =========================
function inferirVariedadHeuristica(ocr_text) {
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
    return { variedad: `${candidata} ${numPat}`.replace(/\s+/g, ' ').trim(), conf: 0.62, evidencia: `Heurística VARIETY + ${numPat}` };
  } else if (candidata) {
    return { variedad: candidata, conf: 0.55, evidencia: 'Heurística VARIETY vecina' };
  } else if (numPat) {
    const m3 = ocrn.match(new RegExp(`([A-Z]{3,})(?:\\s+[A-Z]{3,}){0,2}\\s+${numPat.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`));
    if (m3) {
      return { variedad: m3[0].trim(), conf: 0.58, evidencia: `Heurística token fuerte + ${numPat}` };
    }
    return { variedad: numPat, conf: 0.45, evidencia: 'Solo patrón numérico' };
  }
  return { variedad: '', conf: 0, evidencia: 'Sin señales suficientes' };
}

// =========================
// Detección IA (cliente) – usa shortlist + Gemini (si hay API key)
// Devuelve: { variedad, conf, evidencia }
// =========================
async function detectarVariedadIA(ocrText) {
  await loadVariedadesOnce();
  const ocrn = normalizarTexto(ocrText);
  const shortlist = construirShortlist(ocrn);

  // Si no hay clave o shortlist vacío, usa heurística directamente
  if (!GEMINI_API_KEY || !shortlist.length) {
    console.warn('IA: usando heurística (sin clave o sin shortlist).');
    return inferirVariedadHeuristica(ocrText);
  }

  try {
    const sys = systemTemplate();
    const usr = userTemplate({ ocr_text: ocrText, ocrn, shortlist });
    const out = await callGeminiJSON(sys, usr);

    const variedad = (out?.variedad || '').toString().trim();
    const conf = typeof out?.conf === 'number' ? out.conf : null;
    const evidencia = (out?.evidencia || '').toString().trim();

    if (variedad) {
      return { variedad, conf, evidencia };
    } else {
      // Si Gemini dice vacío, intenta heurística
      return inferirVariedadHeuristica(ocrText);
    }
  } catch (e) {
    console.warn('Gemini fallo → heurística. Motivo:', e.message || e);
    return inferirVariedadHeuristica(ocrText);
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
      headers: { 'apikey': 'helloworld' } // Demo key. Sustituye por tu key real para uso serio.
      ,
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

      // (Opcional) detectar vuelo solo para logs
      const vueloDetectado = detectarVuelo(cleanText);
      if (vueloDetectado) console.log('Vuelo detectado (debug):', vueloDetectado);

      // 🔮 IA: SOLO la variedad en el modal
      textoDetectado.textContent = 'Detectando variedad…';
      const inferencia = await detectarVariedadIA(cleanText);

      if (inferencia && inferencia.variedad) {
        textoDetectado.textContent = inferencia.variedad; // <- SOLO la variedad
        console.log('Variedad IA:', inferencia.variedad, 'conf:', inferencia.conf, 'evidencia:', inferencia.evidencia);
      } else {
        textoDetectado.textContent = 'No se pudo inferir la variedad.';
        console.log('No se pudo inferir variedad para el texto:', cleanText);
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
