/** Data channel topics (agent ↔ frontend contract). */
export const DATA_TOPICS = {
  CONFIG: 'config',
  CONFIG_ACK: 'config_ack',
  CONFIG_REQUEST: 'config_request',
  MESSAGE_NEW: 'message:new',
  SESSION_END: 'session:end',
  DICTATION_TRANSCRIPT: 'dictation:transcript',
  EVENT_FIRE: 'event:fire',
  STATE_UPDATE: 'state:update',
  SESSION_CONTROL: 'session:control',
  ASSISTANT_INTERRUPT: 'assistant:interrupt',
  UI_ACTIVITY: 'ui:activity',
  CHAT: 'lk.chat',
} as const;

export type DataTopic = (typeof DATA_TOPICS)[keyof typeof DATA_TOPICS];

export function toolDataTopic(toolName: string): string {
  return `tool:${toolName}`;
}
