<?php

/**
 * Conserje front controller.
 *
 * Two routes: POST /chat for a conversation turn, GET /health for uptime
 * checks. Everything below public/ is the only thing the web server should
 * expose -- state, configuration and the .env file all live above it.
 */

declare(strict_types=1);

use Conserje\App;
use Conserje\Chat\ChatException;
use Conserje\Config\ConfigException;
use Conserje\Http\ClientIp;
use Conserje\Http\Cors;
use Conserje\Http\JsonResponse;

$baseDir = dirname(__DIR__);

require $baseDir . '/vendor/autoload.php';

try {
    $app = App::boot($baseDir);
} catch (Throwable $e) {
    // A boot failure means misconfiguration. Log the detail, tell the caller
    // nothing: the message could name an env var or a filesystem path.
    error_log('[conserje] boot failed: ' . $e->getMessage());
    JsonResponse::error('unavailable', 'Service unavailable.', 503);

    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$route = '/' . trim(str_replace('/index.php', '', $path), '/');

if ($route === '/health') {
    JsonResponse::send(['status' => 'ok', 'sites' => count($app->sites->ids())]);

    exit;
}

if ($route !== '/chat') {
    JsonResponse::error('not_found', 'No such endpoint.', 404);

    exit;
}

$origin = isset($_SERVER['HTTP_ORIGIN']) && is_string($_SERVER['HTTP_ORIGIN'])
    ? $_SERVER['HTTP_ORIGIN']
    : null;

// The site id arrives as a query parameter so that it is available on the
// preflight request, which carries no body.
$siteId = isset($_GET['site']) && is_string($_GET['site']) ? $_GET['site'] : '';

try {
    $site = $app->sites->get($siteId);
} catch (ConfigException) {
    // Same response for an unknown site and a disallowed origin, so the
    // endpoint cannot be used to enumerate which tenants exist.
    JsonResponse::error('forbidden', 'Not allowed from this origin.', 403);

    exit;
}

if (!Cors::apply($site, $origin)) {
    JsonResponse::error('forbidden', 'Not allowed from this origin.', 403);

    exit;
}

if ($method === 'OPTIONS') {
    Cors::preflight();

    exit;
}

if ($method !== 'POST') {
    JsonResponse::error('method_not_allowed', 'Use POST.', 405);

    exit;
}

$ip = ClientIp::resolve($_SERVER, $app->trustProxy);

if (!$app->rateLimiter->allow("{$site->id}:{$ip}", $site->requestsPerHour, 3600)) {
    JsonResponse::error(ChatException::RATE_LIMITED, 'Too many messages. Try again shortly.', 429, true);

    exit;
}

$raw = file_get_contents('php://input');

try {
    /** @var array<string,mixed> $body */
    $body = json_decode($raw === false ? '' : $raw, true, 8, JSON_THROW_ON_ERROR);
} catch (JsonException) {
    JsonResponse::error('bad_request', 'Body must be JSON.', 400);

    exit;
}

$message = isset($body['message']) && is_string($body['message']) ? $body['message'] : '';
$session = isset($body['session']) && is_string($body['session']) ? $body['session'] : null;

try {
    $result = $app->chat->handle($site, $session, $message);
} catch (ChatException $e) {
    JsonResponse::error($e->errorCode, $e->getMessage(), $e->status, $e->retryable);

    exit;
} catch (Throwable $e) {
    error_log('[conserje] unhandled: ' . $e->getMessage());
    JsonResponse::error('internal_error', 'Something went wrong.', 500, true);

    exit;
}

JsonResponse::send($result->toResponseArray());
