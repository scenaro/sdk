export {
  ScenaroClient,
  createScenaroClient,
  type ScenaroClientConfig,
} from './ScenaroClient';

// JWT + storage helpers consumed by experience adapters (e.g. urbansider utils/auth.js).
export { isTokenExpired, getJWTExpiry, getCompanyIdFromToken } from './auth/jwt';
export {
  buildStorageKeys,
  persistIdentity,
  type StorageAdapter,
  type SessionStoreKeys,
} from './auth/session-store';
