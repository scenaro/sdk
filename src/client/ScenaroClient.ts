import type {
  IdentityResponse,
  PublicSessionRequest,
  PublicSessionResponse,
  PublicTokenRequest,
  PublicTokenResponse,
  SessionOptions,
} from '../protocol';
import { isTokenExpired } from './auth/jwt';
import {
  buildStorageKeys,
  clearSession,
  createBrowserStorage,
  getAppSession,
  getUserToken,
  persistIdentity,
  resolveExternalId,
  type StorageAdapter,
} from './auth/session-store';

export interface ScenaroClientConfig {
  apiUrl: string;
  storagePrefix?: string;
  storage?: StorageAdapter | null;
  apiPathPrefix?: string;
}

export type ScenaroHttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ScenaroRequestOptions {
  method?: ScenaroHttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  requiresAuth?: boolean;
  refreshToken?: boolean;
  scenarioUUID?: string | null;
  applicationId?: number | null;
  headers?: Record<string, string>;
}

export class ScenaroApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ScenaroApiError';
    this.status = status;
    this.body = body;
  }
}

export class ScenaroClient {
  readonly apiUrl: string;
  readonly keys: ReturnType<typeof buildStorageKeys>;
  readonly storage: StorageAdapter | null;
  private readonly apiPathPrefix: string;

  constructor(config: ScenaroClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.keys = buildStorageKeys(config.storagePrefix ?? '');
    this.storage = config.storage ?? createBrowserStorage();
    this.apiPathPrefix = config.apiPathPrefix ?? '/v1';
  }

  async request<T>(endpoint: string, options: ScenaroRequestOptions = {}): Promise<T> {
    const {
      requiresAuth = true,
      refreshToken = requiresAuth,
      scenarioUUID = null,
      applicationId = null,
      query,
      headers: extraHeaders,
      method = 'GET',
      body,
    } = options;

    if (!endpoint.startsWith('/')) {
      throw new TypeError('ScenaroClient.request endpoint must start with "/"');
    }

    const token = requiresAuth && refreshToken
      ? await this.getValidUserToken()
      : getUserToken(this.storage, this.keys, scenarioUUID, applicationId);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    if (requiresAuth && !token) {
      throw new ScenaroApiError(401, 'Not authenticated');
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const url = new URL(`${this.apiUrl}${this.apiPathPrefix}${endpoint}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (response.status === 204) {
      return { success: true } as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const data: unknown = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      const message =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error: unknown }).error)
          : `Request failed with status ${response.status}`;
      throw new ScenaroApiError(response.status, message, data);
    }
    return data as T;
  }

  async identifyUser(
    scenarioUUID: string,
    externalId?: string | null,
  ): Promise<IdentityResponse> {
    if (scenarioUUID && this.storage) {
      this.storage.setItem(this.keys.scenarioUuid, scenarioUUID);
    }

    const cached = getAppSession(this.storage, this.keys, { scenarioUUID });

    if (
      cached?.user_token &&
      !isTokenExpired(cached.user_token) &&
      cached.user_id &&
      cached.application_id
    ) {
      return {
        user_token: cached.user_token,
        user_id: cached.user_id,
        application_id: cached.application_id,
      };
    }

    const external_id = resolveExternalId(
      this.storage,
      this.keys,
      scenarioUUID,
      externalId,
    );

    const body: PublicTokenRequest = {
      external_id,
      scenario_uuid: scenarioUUID,
    };

    const response = await this.request<PublicTokenResponse>('/public/token', {
      method: 'POST',
      body,
      requiresAuth: false,
    });

    persistIdentity(this.storage, this.keys, scenarioUUID, response, external_id);
    return response;
  }

  async startSession(
    scenarioUUID: string,
    options: {
      inputMode?: string;
      outputMode?: string;
      language?: string;
      sessionOptions?: SessionOptions;
    } = {},
  ): Promise<PublicSessionResponse> {
    const {
      inputMode = 'audio',
      outputMode = 'audio',
      language,
      sessionOptions = {},
    } = options;

    const appSession = getAppSession(this.storage, this.keys, { scenarioUUID });
    const applicationId = appSession?.application_id ?? null;

    const body: PublicSessionRequest = {
      scenario_uuid: scenarioUUID,
      input_mode: inputMode,
      output_mode: outputMode,
    };

    // No hardcoded fallback: omitting `language` lets the backend use the scenario's own
    // configured language instead of silently forcing French on every public SDK consumer.
    if (language) {
      body.language = language;
    }

    if (sessionOptions.resumeConversationId) {
      body.resume_conversation_id = sessionOptions.resumeConversationId;
    }
    if (typeof sessionOptions.experienceStateRecordingEnabled === 'boolean') {
      body.experience_state_recording_enabled =
        sessionOptions.experienceStateRecordingEnabled;
    }
    if (sessionOptions.metadata && Object.keys(sessionOptions.metadata).length > 0) {
      body.metadata = sessionOptions.metadata;
    }

    return this.request<PublicSessionResponse>('/public/session', {
      method: 'POST',
      body,
      requiresAuth: true,
      refreshToken: false,
      scenarioUUID,
      applicationId,
    });
  }

  async getValidUserToken(): Promise<string | null> {
    const token = getUserToken(this.storage, this.keys);
    if (token && !isTokenExpired(token)) return token;

    const scenarioUUID = this.storage?.getItem(this.keys.scenarioUuid) ?? null;
    const session = getAppSession(this.storage, this.keys, { scenarioUUID });
    const externalId = session?.external_id ?? null;
    if (!scenarioUUID || !externalId) return null;

    try {
      const identity = await this.identifyUser(scenarioUUID, externalId);
      return identity.user_token;
    } catch {
      return null;
    }
  }

  getStoredUserToken(scenarioUUID?: string | null, applicationId?: number | null): string | null {
    return getUserToken(this.storage, this.keys, scenarioUUID, applicationId);
  }

  clearStoredSession(scenarioUUID?: string | null): void {
    clearSession(this.storage, this.keys, scenarioUUID);
  }

  getSessionUserId(): number | null {
    const session = getAppSession(this.storage, this.keys);
    const id = session?.user_id;
    return typeof id === 'number' && id > 0 ? id : null;
  }

  getSessionApplicationId(): number | null {
    const session = getAppSession(this.storage, this.keys);
    const id = session?.application_id;
    return typeof id === 'number' && id > 0 ? id : null;
  }
}

export function createScenaroClient(config: ScenaroClientConfig): ScenaroClient {
  return new ScenaroClient(config);
}
