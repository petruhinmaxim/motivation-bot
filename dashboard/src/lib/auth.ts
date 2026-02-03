const DASHBOARD_USER = 'toha';
const DASHBOARD_PASSWORD = 'krasava';

export function validateBasicAuth(authHeader: string | null): boolean {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }
  const base64 = authHeader.slice(6);
  const decoded = Buffer.from(base64, 'base64').toString('utf-8');
  const [username, password] = decoded.split(':');
  return username === DASHBOARD_USER && password === DASHBOARD_PASSWORD;
}

export function getAuthResponse() {
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Motivation Bot Dashboard"',
    },
  });
}
