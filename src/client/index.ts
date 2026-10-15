export {
  ScenaroApiError,
  ScenaroClient,
  createScenaroClient,
  type ScenaroHttpMethod,
  type ScenaroRequestOptions,
  type ScenaroClientConfig,
} from './ScenaroClient';
export {
  deleteConversation,
  deleteMemory,
  deleteUserBucket,
  forkConversation,
  getCollectionItem,
  getConversation,
  getSearchThread,
  getUserBucket,
  listCollectionItems,
  listConversationMessages,
  listConversations,
  listMemories,
  listUserBuckets,
  patchUserBucket,
  triggerAdvancedSearch,
  upsertUserBucket,
  type AdvancedSearchRequest,
  type CollectionItemsOptions,
  type ConversationMessagesOptions,
  type JsonObject,
  type PaginationOptions,
  type PublicConversation,
  type PublicConversationMessage,
  type PublicUserBucket,
  type PublicUserMemory,
} from './public-resources';

// JWT + storage helpers consumed by experience adapters (e.g. urbansider utils/auth.js).
export { isTokenExpired, getJWTExpiry, getCompanyIdFromToken } from './auth/jwt';
export {
  buildStorageKeys,
  persistIdentity,
  type StorageAdapter,
  type SessionStoreKeys,
} from './auth/session-store';
