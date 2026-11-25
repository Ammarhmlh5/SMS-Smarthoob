const LOCAL_WEB_PORTS = new Set(['8081', '8082', '8083', '19006']);

export function allowedOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(url.hostname) &&
      LOCAL_WEB_PORTS.has(url.port);
  } catch {
    return false;
  }
}
