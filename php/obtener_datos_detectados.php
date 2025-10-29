<?php
// php/obtener_datos_detectados.php
declare(strict_types=1);

// --- Cabeceras JSON (y no cache) ---
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// --- (Opcional CORS si lo llamas desde otro origen) ---
// header('Access-Control-Allow-Origin: https://ocr.veraleza.com');
// header('Vary: Origin');

// --- Conexión directa (sin config.php) ---
$host = '127.0.0.1';
$port = '3306';
$db   = 'ocr_db';
$user = 'admin_ocr';
$pass = 'tBbf5d7&9Z#Gapat';

try {
  $dsn = "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4";
  $pdo = new PDO($dsn, $user, $pass, [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
  ]);
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['error' => 'Error de conexión a la base de datos']);
  exit;
}

// --- Validación de parámetro ---
$id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
if ($id <= 0) {
  http_response_code(400);
  echo json_encode(['error' => 'Parámetro id inválido']);
  exit;
}

// --- Consulta ---
$sql = "
  SELECT
    longitud,
    paquetes,
    tallos_paquete,
    tallos_totales
  FROM ofertas
  WHERE id = ?
  LIMIT 1
";

try {
  $stmt = $pdo->prepare($sql);
  $stmt->execute([$id]);
  $row = $stmt->fetch();

  if (!$row) {
    http_response_code(404);
    echo json_encode(['error' => 'Oferta no encontrada']);
    exit;
  }

  // Normaliza tipos (int o null)
  $out = [
    'longitud'       => isset($row['longitud'])        ? (int)$row['longitud']        : null,
    'paquetes'       => isset($row['paquetes'])        ? (int)$row['paquetes']        : null,
    'tallos_paquete' => isset($row['tallos_paquete'])  ? (int)$row['tallos_paquete']  : null,
    'tallos_totales' => isset($row['tallos_totales'])  ? (int)$row['tallos_totales']  : null,
  ];

  // Si la columna generada llega NULL pero hay datos, calcula en servidor (por si acaso)
  if (($out['tallos_totales'] === null) && $out['paquetes'] !== null && $out['tallos_paquete'] !== null) {
    $out['tallos_totales'] = (int)($out['paquetes'] * $out['tallos_paquete']);
  }

  echo json_encode($out, JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['error' => 'Error en la consulta']);
  exit;
}
