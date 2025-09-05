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
  $s = trim($s);
  
  // Normalizar patrones comunes de variedades
  $s = preg_replace('/\b(\d+)\s*-\s*(\d+)\b/', '$1-$2', $s); // 60 - 4 -> 60-4
  $s = preg_replace('/\bx\s*(\d+)\b/i', 'x$1', $s); // x 500 -> x500
  
  return $s;
}

$ocrn = $ocrn ? $ocrn : normalizar($ocr_text);

// --- Cargar ofertas.json ---
$path1 = __DIR__ . '/../ofertas.json';
$path2 = __DIR__ . '/../../ofertas.json';
$path  = file_exists($path1) ? $path1 : (file_exists($path2) ? $path2 : null);
if (!$path) json_error('No se encontró ofertas.json');

$rawJson = file_get_contents($path);
if (!$rawJson) json_error('No se pudo leer ofertas.json');

$doc = json_decode($rawJson, true);
if (!$doc) json_error('ofertas.json inválido');

$datos = [];
// Estructura típica export phpMyAdmin: buscar objeto "table" con name=ofertas y su "data"
if (isset($doc[2]['type']) && $doc[2]['type'] === 'table') {
  // formato como el que pasaste en el ejemplo
  $datos = $doc[2]['data'] ?? [];
} else {
  // fallback: quizá el JSON sea directamente un array de filas
  $datos = $doc['data'] ?? $doc;
}

if (!is_array($datos) || !count($datos)) json_error('Sin datos en ofertas.json');

// --- Prepara índice por primer token y lista global ---
$ofertas = [];              // lista completa de ofertas
$variedades = [];           // lista plana de nombres de variedades
$porPrimerToken = [];       // token => [ofertas...]
foreach ($datos as $row) {
  $variedad = $row['variedad'] ?? null;
  $cultivo = $row['cultivo'] ?? null;
  $cliente = $row['cliente'] ?? null;
  
  if (!$variedad) continue;
  
  $oferta = [
    'variedad' => $variedad,
    'cultivo' => $cultivo,
    'cliente' => $cliente,
    'id' => $row['id'] ?? null
  ];
  
  $ofertas[] = $oferta;
  $variedades[] = $variedad;

  $norm = normalizar($variedad);
  $primer = preg_match('/^[A-ZÁÉÍÓÚÑ0-9]+/', $norm, $m) ? $m[0] : null;
  if ($primer) {
    $porPrimerToken[$primer][] = $oferta;
  }
}

// --- Extrae número de vuelo ---
$numeroVuelo = '';
if (preg_match('/:\d{3}-\d{4}\s+\d{4}/', $ocrn, $m)) {
  $numeroVuelo = $m[0];
  // Limpiar los dos puntos del inicio
  $numeroVuelo = ltrim($numeroVuelo, ':');
}

// --- Extrae cultivo ---
$cultivoDetectado = '';
// Obtener lista de cultivos únicos de la base de datos
$cultivosConocidos = array_unique(array_filter(array_map(function($oferta) {
  return $oferta['cultivo'] ?? null;
}, $ofertas)));

// Buscar cultivos conocidos en el texto OCR
foreach ($cultivosConocidos as $cultivo) {
  if ($cultivo && strpos($ocrn, $cultivo) !== false) {
    $cultivoDetectado = $cultivo;
    break;
  }
}

// --- Extrae patrones numéricos del OCR ---
$patrones = [];

// DD-DD, DDD-D, etc. (patrones de variedades como 60-4, 50-12)
if (preg_match_all('/\b\d{2,3}-\d{1,3}\b/', $ocrn, $m1)) {
  $patrones = array_merge($patrones, $m1[0]);
}
// xDDD, xDDDD (patrones como x500, x35)
if (preg_match_all('/x\d{2,4}\b/i', $ocrn, $m2)) {
  $patrones = array_merge($patrones, array_map('strtoupper', $m2[0]));
}
// Patrones de variedades específicos: NOMBRE DD-DD
if (preg_match_all('/\b([A-Z]{3,})\s+(\d{2,3}-\d{1,3})\b/', $ocrn, $m3)) {
  foreach ($m3[0] as $match) {
    $patrones[] = $match;
  }
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

// --- Construye SHORTLIST priorizando por vuelo + cultivo + variedad ---
$shortlist = [];

// 1. Si hay número de vuelo, buscar ofertas que coincidan exactamente
if ($numeroVuelo) {
  foreach ($ofertas as $oferta) {
    $vueloOferta = $oferta['vuelo'] ?? '';
    if ($vueloOferta && strpos($vueloOferta, $numeroVuelo) !== false) {
      $shortlist[] = $oferta;
    }
  }
}

// 2. Si hay cultivo detectado, filtrar por cultivo también
if ($cultivoDetectado && count($shortlist) > 0) {
  $shortlistFiltrado = [];
  foreach ($shortlist as $oferta) {
    $cultivoOferta = $oferta['cultivo'] ?? '';
    if ($cultivoOferta && strpos($cultivoOferta, $cultivoDetectado) !== false) {
      $shortlistFiltrado[] = $oferta;
    }
  }
  if (count($shortlistFiltrado) > 0) {
    $shortlist = $shortlistFiltrado;
  }
}

// 3. Si no hay coincidencias por vuelo o no hay vuelo, usar cultivo + tokens fuertes
if (count($shortlist) < 5) {
  $candidatos = $ofertas;
  
  // Filtrar por cultivo si está detectado
  if ($cultivoDetectado) {
    $candidatosFiltrados = [];
    foreach ($candidatos as $oferta) {
      $cultivoOferta = $oferta['cultivo'] ?? '';
      if ($cultivoOferta && strpos($cultivoOferta, $cultivoDetectado) !== false) {
        $candidatosFiltrados[] = $oferta;
      }
    }
    if (count($candidatosFiltrados) > 0) {
      $candidatos = $candidatosFiltrados;
    }
  }
  
  // Usar tokens fuertes en los candidatos filtrados
  $maxPorToken = 6;  // cap por familia
  foreach ($tokensFuerte as $tok) {
    if (!isset($porPrimerToken[$tok])) continue;
    $candidatosFamilia = array_filter($porPrimerToken[$tok], function($cand) use ($candidatos) {
      return in_array($cand, $candidatos, true);
    });

    // Si hay patrones numéricos, prioriza los que los contienen
    $preferidos = [];
    $otros = [];
    foreach ($candidatosFamilia as $cand) {
      $cNorm = normalizar($cand['variedad']);
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
}

// 4. Si no hay shortlist, mete algunos patrones genéricos
if (!count($shortlist)) {
  $shortlist = array_slice($ofertas, 0, 12);
}

// --- Prompt para Ollama (phi3) ---
$system = <<<SYS
Eres un analista experto en etiquetas de flores. Tu tarea es identificar la VARIEDAD exacta únicamente entre un LISTADO de candidatos (shortlist).
Prohibido inventar nombres fuera del shortlist.
Responde SIEMPRE en JSON válido y NADA MÁS.
SYS;

$shortlistStr = '';
foreach ($shortlist as $oferta) {
  $variedad = $oferta['variedad'];
  $cultivo = $oferta['cultivo'] ? " (Cultivo: {$oferta['cultivo']})" : "";
  $cliente = $oferta['cliente'] ? " (Cliente: {$oferta['cliente']})" : "";
  $shortlistStr .= '"' . addslashes($variedad . $cultivo . $cliente) . "\",\n";
}
$shortlistStr = rtrim($shortlistStr, ",\n");

$user = <<<USR
# CONTEXTO
1) OCR_TEXT: texto bruto con posible ruido.
2) OCR_TEXT_NORMALIZADO: mayúsculas, sin tildes, con separadores conservados (-, +, /, x).
3) SHORTLIST: solo puedes elegir una de esta lista.

# OBJETIVO
Selecciona la OFERTA más probable del SHORTLIST usando patrones como:
- NOMBRE-NÚMERO-NÚMERO (ej: MONDIAL 60-4, EXPLORER 50-12)
- NOMBRE xNÚMERO (ej: FANCY ROJOx500)
- Cercanía a tokens "VARIETY"/"VAR:".
Ignora números logísticos como AWB/HAWB/RUC.

# CONFIANZA
Devuelve "conf" 0..1 (≥0.80 muy seguro).

# SALIDA ESTRICTA (JSON)
{
  "variedad": "<nombre de variedad del SHORTLIST o \"\">",
  "cultivo": "<nombre del cultivo o \"\">",
  "cliente": "<nombre del cliente o \"\">",
  "conf": <0..1>,
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
$cultivo = '';
$cliente = '';
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
    $cultivo = isset($data['cultivo']) ? trim($data['cultivo']) : '';
    $cliente = isset($data['cliente']) ? trim($data['cliente']) : '';
    $conf = isset($data['conf']) ? floatval($data['conf']) : null;
    $evidencia = isset($data['evidencia']) ? trim($data['evidencia']) : '';
    $ollamaOk = true;
  }
}

// --- Fallback heurístico si la IA no produjo salida usable ---
if (!$ollamaOk || $variedad === '') {
  // Heurística mejorada: buscar coincidencias directas en la shortlist
  $mejorCoincidencia = null;
  $mejorScore = 0;
  
  foreach ($shortlist as $candidato) {
    $candidatoNorm = normalizar($candidato['variedad']);
    $score = 0;
    
    // Coincidencia exacta
    if (strpos($ocrn, $candidatoNorm) !== false) {
      $score = 1.0;
    } else {
      // Coincidencia por patrones numéricos específicos
      $patronesCandidato = [];
      if (preg_match_all('/\b\d{2,3}-\d{1,3}\b/', $candidatoNorm, $m)) {
        $patronesCandidato = array_merge($patronesCandidato, $m[0]);
      }
      if (preg_match_all('/x\d{2,4}\b/i', $candidatoNorm, $m)) {
        $patronesCandidato = array_merge($patronesCandidato, array_map('strtoupper', $m[0]));
      }
      
      $coincidenciasPatrones = 0;
      foreach ($patronesCandidato as $patron) {
        if (strpos($ocrn, $patron) !== false) {
          $coincidenciasPatrones++;
        }
      }
      
      if (count($patronesCandidato) > 0) {
        $score = $coincidenciasPatrones / count($patronesCandidato);
      }
      
      // Si no hay coincidencias de patrones, usar coincidencia parcial por palabras
      if ($score == 0) {
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
    }
    
    if ($score > $mejorScore) {
      $mejorScore = $score;
      $mejorCoincidencia = $candidato;
    }
  }
  
  if ($mejorScore > 0.3 && $mejorCoincidencia) { // Umbral mínimo de confianza
    $variedad = $mejorCoincidencia['variedad'];
    $cultivo = $mejorCoincidencia['cultivo'] ?? '';
    $cliente = $mejorCoincidencia['cliente'] ?? '';
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
  'cultivo' => $cultivo,
  'cliente' => $cliente,
  'vuelo' => $numeroVuelo,
  'cultivo_detectado' => $cultivoDetectado,
  'conf' => $conf,
  'evidencia' => $evidencia,
]);
