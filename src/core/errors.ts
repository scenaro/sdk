export type ScenaroErrorCode =
  | 'IDENTIFY_FAILED'
  | 'SESSION_START_FAILED'
  | 'CONNECTION_LOST'
  | 'MIC_PERMISSION_DENIED'
  | 'TOOL_TIMEOUT'
  | 'AGENT_UNAVAILABLE';

export class ScenaroError extends Error {
  readonly code: ScenaroErrorCode;
  readonly cause?: unknown;

  constructor(code: ScenaroErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ScenaroError';
    this.code = code;
    this.cause = cause;
  }
}
