<?php
// php/detectar_variedad.php
header('Content-Type: application/json; charset=utf-8');

function json_error($msg, $extra = []) {
  echo json_encode(array_merge(['success' => false, 'error' => $msg], $extra));
  exit;
}

$raw = file_get_contents('php://input');
if (!$raw) json_error('Sin cuerpo');

$in = json_decode($raw, true);
if (!$in) json_error('JSON inválido');

$ocr_text = $in['ocr_text'] ?? '';
$ocrn     = $in['ocr_text_normalizado'] ?? '';

if (!$ocr_text) json_error('Falta ocr_text');

function normalizar($s) {
  $s = iconv('UTF-8', 'ASCII//TRANSLIT', $s);
  $s = strtoupper($s);
  $s = preg_replace('/[^\w\s\-\+\/x]/u', ' ', $s); // conserva -, +, / y x
  $s = preg_replace('/\s+/', ' ', $s);
  return trim($s);
}

$ocrn = $ocrn ? $ocrn : normalizar($ocr_text);

// --- Cargar variedades.json ---
$path1 = __DIR__ . '/../variedades.json';
$path2 = __DIR__ . '/../../variedades.json';
$path  = file_exists($path1) ? $path1 : (file_exists($path2) ? $path2 : null);
if (!$path) json_error('No se encontró variedades.json');

$rawJson = file_get_contents($path);
if (!$rawJson) json_error('No se pudo leer variedades.json');

$doc = json_decode($rawJson, true);
if (!$doc) json_error('variedades.json inválido');

$datos = [];
// Estructura típica export phpMyAdmin: buscar objeto "table" con name=variedades y su "data"
if (isset($doc[2]['type']) && $doc[2]['type'] === 'table') {
  // formato como el que pasaste en el ejemplo
  $datos = $doc[2]['data'] ?? [];
} else {
  // fallback: quizá el JSON sea directamente un array de filas
  $datos = $doc['data'] ?? $doc;
}

if (!is_array($datos) || !count($datos)) json_error('Sin datos en variedades.json');

// --- Prepara índice por primer token y lista global ---
$variedades = [];           // lista plana de nombres
$porPrimerToken = [];       // token => [nombres...]
foreach ($datos as $row) {
  $nombre = $row['nombre'] ?? ($row['Nombre'] ?? null);
  if (!$nombre) continue;
  $variedades[] = $nombre;

  $norm = normalizar($nombre);
  $primer = preg_match('/^[A-ZÁÉÍÓÚÑ0-9]+/', $norm, $m) ? $m[0] : null;
  if ($primer) {
    $porPrimerToken[$primer][] = $nombre;
  }
}

// --- Extrae patrones numéricos del OCR ---
$patrones = [];

// DD-DD, DDD-D, etc.
if (preg_match_all('/\b\d{2,3}-\d{1,3}\b/', $ocrn, $m1)) {
  $patrones = array_merge($patrones, $m1[0]);
}
// xDDD, xDDDD
if (preg_match_all('/x\d{2,4}\b/i', $ocrn, $m2)) {
  $patrones = array_merge($patrones, array_map('strtoupper', $m2[0]));
}
$patrones = array_values(array_unique($patrones));

// --- Tokens fuertes del OCR (candidatos de palabra) ---
$tokensOCR = array_values(array_unique(preg_split('/\s+/', $ocrn)));
$tokensFuerte = array_filter($tokensOCR, function($t) {
  // evitar ruido logístico y números sueltos
  if (strlen($t) < 3) return false;
  if (preg_match('/^\d+$/', $t)) return false;
  $stop = ['AWB','HAWB','RUC','PACKING','DATE','FORWARDER','ALLIANCE','GROUP','ECUADOR','LENGTH','BUNCH','STEM','PCS','CM','ROSES','ROSELY','FLOWERS','VERALEZA','SLU','LOGIZTIK','ALLIANCE','GROUP'];
  return !in_array($t, $stop);
});

// --- Construye SHORTLIST por intersección de primer token ---
$shortlist = [];
$maxPorToken = 6;  // cap por familia
foreach ($tokensFuerte as $tok) {
  if (!isset($porPrimerToken[$tok])) continue;
  $candidatosFamilia = $porPrimerToken[$tok];

  // Si hay patrones numéricos, prioriza los que los contienen
  $preferidos = [];
  $otros = [];
  foreach ($candidatosFamilia as $cand) {
    $cNorm = normalizar($cand);
    $matchNum = false;
    foreach ($patrones as $p) {
      if (strpos($cNorm, $p) !== false) { $matchNum = true; break; }
    }
    if ($matchNum) $preferidos[] = $cand; else $otros[] = $cand;
  }

  $ordenados = array_merge($preferidos, $otros);
  foreach ($ordenados as $cand) {
    if (count($shortlist) >= 20) break 2;
    if (!in_array($cand, $shortlist, true)) $shortlist[] = $cand;
    if (--$maxPorToken <= 0) break;
  }
}

// Si no hay shortlist, mete algunos patrones genéricos (top por frecuencia no la tenemos, así que toma primeras)
if (!count($shortlist)) {
  $shortlist = array_slice($variedades, 0, 12);
}

// --- Prompt para Ollama (phi3) ---
$system = <<<SYS
Eres un analista experto en etiquetas de flores. Tu tarea es identificar la VARIEDAD exacta únicamente entre un LISTADO de candidatos (shortlist).
Prohibido inventar nombres fuera del shortlist.
Responde SIEMPRE en JSON válido y NADA MÁS.
SYS;

$shortlistStr = '';
foreach ($shortlist as $s) {
  $shortlistStr .= '"' . addslashes($s) . "\",\n";
}
$shortlistStr = rtrim($shortlistStr, ",\n");

$user = <<<USR
# CONTEXTO
1) OCR_TEXT: texto bruto con posible ruido.
2) OCR_TEXT_NORMALIZADO: mayúsculas, sin tildes, con separadores conservados (-, +, /, x).
3) SHORTLIST: solo puedes elegir una de esta lista.

# OBJETIVO
Selecciona la variedad más probable del SHORTLIST usando patrones como 40-12, 50-4, x500, y cercanía a tokens "VARIETY"/"VAR:".
Ignora números logísticos como AWB/HAWB/RUC.

# CONFIANZA
Devuelve "conf" 0..1 (≥0.80 muy seguro).

# SALIDA ESTRICTA (JSON)
{
  "variedad": "<uno de SHORTLIST o \"\">",
  "conf": <0..1>,
  "candidates": [
    {"nombre": "<shortlist>", "score": <0..1>}
  ],
  "evidencia": "<máx 140 chars>"
}

OCR_TEXT = <<<OCR
{$ocr_text}
OCR

OCR_TEXT_NORMALIZADO = <<<OCRN
{$ocrn}
OCRN

SHORTLIST = [
{$shortlistStr}
]
USR;

// --- Llamada a Ollama ---
function call_ollama_chat($model, $system, $user) {
  $payload = [
    'model' => $model,
    'messages' => [
      ['role' => 'system', 'content' => $system],
      ['role' => 'user',   'content' => $user],
    ],
    'stream' => false,
  ];
  $ch = curl_init('http://localhost:11434/api/chat');
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
    CURLOPT_TIMEOUT => 5, // Reducido para fallback más rápido
    CURLOPT_CONNECTTIMEOUT => 2
  ]);
  $out = curl_exec($ch);
  if ($out === false) {
    curl_close($ch);
    return null;
  }
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($code !== 200) return null;
  $json = json_decode($out, true);
  if (!$json || !isset($json['message']['content'])) return null;
  return $json['message']['content'];
}

$variedad = '';
$conf = null;
$evidencia = '';
$ollamaOk = false;

$resp = call_ollama_chat('phi3', $system, $user);
if ($resp) {
  // El modelo debe devolver JSON; extrae el bloque JSON
  $jsonStr = $resp;
  // Intenta decodificar directamente
  $data = json_decode($jsonStr, true);
  if (!$data) {
    // Busca primer bloque {...}
    if (preg_match('/\{.*\}/s', $resp, $mm)) {
      $data = json_decode($mm[0], true);
    }
  }
  if (isset($data['variedad'])) {
    $variedad = trim($data['variedad']);
    $conf = isset($data['conf']) ? floatval($data['conf']) : null;
    $evidencia = isset($data['evidencia']) ? trim($data['evidencia']) : '';
    $ollamaOk = true;
  }
}

// --- Fallback heurístico si la IA no produjo salida usable ---
if (!$ollamaOk || $variedad === '') {
  // Heurística mejorada: buscar coincidencias directas en la shortlist
  $mejorCoincidencia = '';
  $mejorScore = 0;
  
  foreach ($shortlist as $candidato) {
    $candidatoNorm = normalizar($candidato);
    $score = 0;
    
    // Coincidencia exacta
    if (strpos($ocrn, $candidatoNorm) !== false) {
      $score = 1.0;
    } else {
      // Coincidencia parcial por palabras
      $palabrasCandidato = preg_split('/\s+/', $candidatoNorm);
      $palabrasOCR = preg_split('/\s+/', $ocrn);
      $coincidencias = 0;
      
      foreach ($palabrasCandidato as $palabra) {
        if (strlen($palabra) >= 3) { // Solo palabras significativas
          foreach ($palabrasOCR as $palabraOCR) {
            if (strpos($palabraOCR, $palabra) !== false || strpos($palabra, $palabraOCR) !== false) {
              $coincidencias++;
              break;
            }
          }
        }
      }
      
      if (count($palabrasCandidato) > 0) {
        $score = $coincidencias / count($palabrasCandidato);
      }
    }
    
    if ($score > $mejorScore) {
      $mejorScore = $score;
      $mejorCoincidencia = $candidato;
    }
  }
  
  if ($mejorScore > 0.3) { // Umbral mínimo de confianza
    $variedad = $mejorCoincidencia;
    $conf = $mejorScore;
    $evidencia = 'Coincidencia heurística (' . round($mejorScore * 100) . '%)';
  } else {
    // Fallback original: buscar línea con 'VARIETY' y la palabra fuerte siguiente
    $lineas = preg_split('/\r?\n/', $ocrn);
    $posVariety = -1;
    foreach ($lineas as $i => $ln) {
      if (strpos($ln, 'VARIETY') !== false || strpos($ln, 'VAR:') !== false || strpos($ln, 'VARIEDAD') !== false) {
        $posVariety = $i; break;
      }
    }
    $candidata = '';
    if ($posVariety >= 0) {
      for ($j = $posVariety + 1; $j < min($posVariety + 5, count($lineas)); $j++) {
        $ln = trim($lineas[$j]);
        if (!$ln) continue;
        // primera palabra fuerte
        if (preg_match('/^[A-Z0-9][A-Z0-9\-\/ ]{2,}$/', $ln)) {
          $candidata = trim($ln);
          break;
        }
      }
    }
    // Números tipo 50-4
    $numPat = '';
    if (preg_match('/\b\d{2,3}-\d{1,3}\b/', $ocrn, $m)) $numPat = $m[0];
    // o x500
    if (!$numPat && preg_match('/x\d{2,4}\b/i', $ocrn, $m)) $numPat = strtoupper($m[0]);

    if ($candidata && $numPat) {
      $variedad = trim(preg_replace('/\s+/', ' ', $candidata . ' ' . $numPat));
      $conf = 0.62;
      $evidencia = 'Heurística VARIETY + patrón ' . $numPat;
    } elseif ($candidata) {
      $variedad = $candidata;
      $conf = 0.55;
      $evidencia = 'Heurística VARIETY vecina';
    } elseif ($numPat) {
      // Busca un token fuerte antes del patrón
      if (preg_match('/([A-Z]{3,})(?:\s+[A-Z]{3,}){0,2}\s+' . preg_quote($numPat, '/') . '/u', $ocrn, $m2)) {
        $variedad = trim($m2[0]);
        $conf = 0.58;
        $evidencia = 'Heurística token fuerte + ' . $numPat;
      } else {
        $variedad = $numPat;
        $conf = 0.45;
        $evidencia = 'Solo patrón numérico';
      }
    } else {
      $variedad = '';
    }
  }
}

echo json_encode([
  'success' => $variedad !== '',
  'variedad' => $variedad,
  'conf' => $conf,
  'evidencia' => $evidencia,
]);
