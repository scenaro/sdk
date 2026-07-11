const EXPIRY_BUFFER_SECONDS = 90;

export function getJWTExpiry(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  const exp = getJWTExpiry(token);
  if (exp === null) return false;
  return Math.floor(Date.now() / 1000) >= exp - EXPIRY_BUFFER_SECONDS;
}

export function getCompanyIdFromToken(token: string | null): number | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded)) as { company_id?: number };
    return typeof payload.company_id === 'number' ? payload.company_id : null;
  } catch {
    return null;
  }
}
