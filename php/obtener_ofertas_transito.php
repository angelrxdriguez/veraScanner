<?php
/**
 * GET /api/ofertas/transito.php
 * Devuelve ofertas de HOY con ubicación = 'Tránsito' y es_outlet = 0
 */

$host = '127.0.0.1';
$port = '3306';
$db   = 'ocr_db';
$user = 'admin_ocr';
$pass = 'tBbf5d7&9Z#Gapat';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$dsn = "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4";
$options = [
  PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
  PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
  $pdo = new PDO($dsn, $user, $pass, $options);

  // Fecha de "hoy" en Europe/Madrid para filtrar
  $tz   = new DateTimeZone('Europe/Madrid');
  $hoy  = (new DateTime('now', $tz))->format('Y-m-d');

  $sql = "
    SELECT
      id,
      articulo,
      variedad,
      cultivo,
      cliente,
      vuelo,
      fecha,
      ubicacion,
      disponible,
      reservado
    FROM ofertas
    WHERE ubicacion = 'Tránsito'
      AND es_outlet = 0
      AND fecha = :hoy
    ORDER BY fecha DESC, cultivo, variedad, cliente, id
  ";

  $stmt = $pdo->prepare($sql);
  $stmt->execute([':hoy' => $hoy]);
  $rows = $stmt->fetchAll();

  foreach ($rows as &$r) {
    $r['id']         = isset($r['id']) ? (int)$r['id'] : null;
    $r['articulo']   = (string)($r['articulo']   ?? '');
    $r['variedad']   = (string)($r['variedad']   ?? '');
    $r['cultivo']    = (string)($r['cultivo']    ?? '');
    $r['cliente']    = (string)($r['cliente']    ?? '');
    $r['vuelo']      = (string)($r['vuelo']      ?? '');
    $r['fecha']      = (string)($r['fecha']      ?? '');
    $r['ubicacion']  = (string)($r['ubicacion']  ?? '');
    $r['disponible'] = is_null($r['disponible']) ? null : (float)$r['disponible'];
    $r['reservado']  = is_null($r['reservado'])  ? null : (float)$r['reservado'];
  }
  unset($r);

  echo json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode([
    'error'   => true,
    'message' => 'DB error',
    'detail'  => $e->getMessage()
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
