/** RPC method names and timeouts (agent ↔ frontend contract). */
export const RPC_METHODS = {
  UI_ACTIVITY_CHECK: 'scenaro__ui_activity_check',
  COMPOSER_START_DICTATION: 'composer_start_dictation',
  COMPOSER_END_DICTATION: 'composer_end_dictation',
  COMPOSER_CANCEL_DICTATION: 'composer_cancel_dictation',
} as const;

export const RPC_TIMEOUTS = {
  AGENT_DEFAULT_MS: 8000,
  FRONTEND_TOOL_MS: 10000,
  UI_ACTIVITY_MS: 3000,
  COMPOSER_START_MS: 10000,
  COMPOSER_END_MS: 15000,
  COMPOSER_CANCEL_MS: 8000,
} as const;

export interface RpcToolRequest {
  requestId: string;
  tool?: string;
  args?: Record<string, unknown>;
  sentAt?: number;
}

export interface RpcToolResponse {
  requestId?: string;
  code: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'CANCELLED' | string;
  data?: unknown;
}

export function resolveRpcMethodName(tool: {
  name: string;
  frontend_method?: string;
}): string {
  return tool.frontend_method ?? tool.name;
}
