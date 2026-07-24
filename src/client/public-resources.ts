import type { ScenaroClient } from './ScenaroClient';

export type JsonObject = Record<string, unknown>;

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface CollectionItemsOptions extends PaginationOptions {
  query?: string;
  searchMode?: string;
  searchField?: string;
  filter?: string;
  matchField?: string;
  matchValue?: string;
}

export interface AdvancedSearchRequest extends JsonObject {
  brief: string;
  search_profile_id: number;
  presentation_scenario_publication_uuid?: string;
  bucket_id?: number;
}

export interface ConversationMessagesOptions {
  limit?: number;
  order?: 'asc' | 'desc';
}

export interface PublicConversation extends JsonObject {
  id: string;
  application_id?: number;
  created_at?: string;
  updated_at?: string;
}

export interface PublicConversationMessage extends JsonObject {
  id: string;
  conversation_id?: string;
  role?: string;
  content?: string;
  timestamp?: string;
}

export interface PublicUserBucket extends JsonObject {
  id?: string;
  bucket_id?: number;
  application_id?: number;
  data?: unknown;
}

export interface PublicUserMemory extends JsonObject {
  id?: string;
  application_id?: number;
  content?: string;
}

function unwrapArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (
    value &&
    typeof value === 'object' &&
    'data' in value &&
    Array.isArray((value as { data: unknown }).data)
  ) {
    return (value as { data: T[] }).data;
  }
  return [];
}

function unwrapObject<T>(value: unknown): T {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'data' in value &&
    (value as { data: unknown }).data &&
    typeof (value as { data: unknown }).data === 'object'
  ) {
    return (value as { data: T }).data;
  }
  return value as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export async function getCollectionItem<T = JsonObject>(
  client: ScenaroClient,
  companyId: number | string,
  collectionId: number | string,
  itemId: number | string,
): Promise<T> {
  return client.request<T>(
    `/public/companies/${companyId}/collections/${collectionId}/items/${encodeURIComponent(String(itemId))}`,
  );
}

export async function listCollectionItems<T = JsonObject>(
  client: ScenaroClient,
  companyId: number | string,
  collectionId: number | string,
  options: CollectionItemsOptions = {},
): Promise<{ data: T[]; [key: string]: unknown }> {
  const {
    offset = 0,
    limit = 10,
    query,
    searchMode = 'full_text',
    searchField = 'title',
    filter,
    matchField,
    matchValue,
  } = options;
  return client.request(`/public/companies/${companyId}/collections/${collectionId}/items`, {
    query: {
      offset,
      limit,
      q: query || undefined,
      mode: query ? searchMode : undefined,
      field: query && searchField ? searchField : undefined,
      filter: filter || undefined,
      match_field: matchField || undefined,
      match_value: matchValue || undefined,
    },
  });
}

export async function listUserBuckets<T extends PublicUserBucket = PublicUserBucket>(
  client: ScenaroClient,
  { limit = 20, offset = 0 }: PaginationOptions = {},
): Promise<T[]> {
  const response = await client.request<unknown>('/public/buckets', {
    query: { limit: clamp(limit, 1, 50), offset: offset > 0 ? offset : undefined },
  });
  return unwrapArray<T>(response);
}

export async function getUserBucket<T = JsonObject>(
  client: ScenaroClient,
  bucketId: number | string,
  applicationId: number | string,
): Promise<T> {
  const response = await client.request<unknown>(`/public/buckets/${bucketId}`, {
    query: { application_id: applicationId },
  });
  return unwrapObject<T>(response);
}

export function patchUserBucket<T = JsonObject>(
  client: ScenaroClient,
  bucketId: number | string,
  body: JsonObject,
): Promise<T> {
  return client.request<T>(`/public/buckets/${bucketId}`, { method: 'PATCH', body });
}

export function upsertUserBucket<T = JsonObject>(
  client: ScenaroClient,
  bucketId: number | string,
  body: JsonObject,
): Promise<T> {
  return client.request<T>(`/public/buckets/${bucketId}`, { method: 'PUT', body });
}

export async function deleteUserBucket(
  client: ScenaroClient,
  bucketId: number | string,
  applicationId: number | string,
): Promise<boolean> {
  await client.request(`/public/buckets/${bucketId}`, {
    method: 'DELETE',
    query: { application_id: applicationId },
  });
  return true;
}

export async function listMemories<T extends PublicUserMemory = PublicUserMemory>(
  client: ScenaroClient,
  { limit = 20, offset = 0 }: PaginationOptions = {},
): Promise<T[]> {
  const response = await client.request<unknown>('/public/memories', {
    query: { limit: clamp(limit, 1, 50), offset: offset > 0 ? offset : undefined },
  });
  return unwrapArray<T>(response);
}

export async function listConversations<T extends PublicConversation = PublicConversation>(
  client: ScenaroClient,
  { limit = 10, offset = 0 }: PaginationOptions = {},
): Promise<T[]> {
  const response = await client.request<unknown>('/public/conversations', {
    query: { limit: clamp(limit, 1, 50), offset: offset > 0 ? offset : undefined },
  });
  return unwrapArray<T>(response);
}

export async function getConversation<T extends PublicConversation = PublicConversation>(
  client: ScenaroClient,
  conversationId: string,
): Promise<T> {
  const response = await client.request<unknown>(
    `/public/conversations/${encodeURIComponent(conversationId)}`,
  );
  return unwrapObject<T>(response);
}

export async function listConversationMessages<
  T extends PublicConversationMessage = PublicConversationMessage,
>(
  client: ScenaroClient,
  conversationId: string,
  { limit = 50, order = 'asc' }: ConversationMessagesOptions = {},
): Promise<T[]> {
  const response = await client.request<unknown>(
    `/public/conversations/${encodeURIComponent(conversationId)}/messages`,
    { query: { order, limit: clamp(limit, 1, order === 'desc' ? 20 : 100) } },
  );
  const messages = unwrapArray<T>(response);
  return order === 'desc' ? messages.slice().reverse() : messages;
}

export async function deleteConversation(
  client: ScenaroClient,
  conversationId: string,
): Promise<boolean> {
  await client.request(`/public/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
  });
  return true;
}

export async function forkConversation<T extends PublicConversation = PublicConversation>(
  client: ScenaroClient,
  sourceConversationId: string,
  forkAtMessageId: string,
): Promise<T> {
  const response = await client.request<unknown>(
    `/public/conversations/${encodeURIComponent(sourceConversationId)}/fork`,
    { method: 'POST', body: { fork_at_message_id: forkAtMessageId } },
  );
  return unwrapObject<T>(response);
}

export async function triggerAdvancedSearch<T = JsonObject>(
  client: ScenaroClient,
  companyId: number | string,
  collectionId: number | string,
  body: AdvancedSearchRequest,
): Promise<T> {
  const response = await client.request<unknown>(
    `/public/companies/${companyId}/collections/${collectionId}/advanced-search`,
    { method: 'POST', body },
  );
  return unwrapObject<T>(response);
}

export async function getSearchThread<T = JsonObject>(
  client: ScenaroClient,
  searchThreadId: string,
): Promise<T> {
  const response = await client.request<unknown>(
    `/public/search-threads/${encodeURIComponent(searchThreadId)}`,
  );
  return unwrapObject<T>(response);
}
