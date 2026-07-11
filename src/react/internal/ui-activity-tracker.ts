export const UI_ACTIVITY_RPC_METHOD = 'scenaro__ui_activity_check';

const VOICE_ACTIVE_STATES = new Set(['listening', 'speaking', 'thinking']);

const lastActivityBySource = {
  dom: 0,
  voice: 0,
  message: 0,
};

let domListenersAttached = false;
let domCleanup: (() => void) | null = null;

function toIso(ms: number): string | null {
  if (!ms) return null;
  return new Date(ms).toISOString();
}

export function recordUiActivity(source: 'dom' | 'voice' | 'message'): void {
  if (!(source in lastActivityBySource)) return;
  lastActivityBySource[source] = Date.now();
}

function attachDomListeners(): void {
  if (domListenersAttached || typeof window === 'undefined') return;

  const onDomActivity = () => recordUiActivity('dom');
  const events = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'];
  for (const name of events) {
    window.addEventListener(name, onDomActivity, { passive: true });
  }
  document.addEventListener('visibilitychange', onDomActivity);

  domCleanup = () => {
    for (const name of events) {
      window.removeEventListener(name, onDomActivity);
    }
    document.removeEventListener('visibilitychange', onDomActivity);
    domListenersAttached = false;
    domCleanup = null;
  };
  domListenersAttached = true;
}

export function startUiActivityTracking(): void {
  attachDomListeners();
  recordUiActivity('dom');
}

export function stopUiActivityTracking(): void {
  domCleanup?.();
  lastActivityBySource.dom = 0;
  lastActivityBySource.voice = 0;
  lastActivityBySource.message = 0;
}

export function getActivitySnapshot(idleThresholdMs = 120000) {
  const now = Date.now();
  const visible =
    typeof document !== 'undefined' && document.visibilityState === 'visible';
  const lastActivityMs = Math.max(
    lastActivityBySource.dom,
    lastActivityBySource.voice,
    lastActivityBySource.message,
  );
  const active =
    visible && lastActivityMs > 0 && now - lastActivityMs < idleThresholdMs;

  return {
    active,
    visible,
    last_activity_at: toIso(lastActivityMs),
    sources: {
      dom: toIso(lastActivityBySource.dom),
      voice: toIso(lastActivityBySource.voice),
      message: toIso(lastActivityBySource.message),
    },
  };
}

export function onVoiceAssistantStateChange(voiceState?: string): void {
  if (voiceState && VOICE_ACTIVE_STATES.has(voiceState)) {
    recordUiActivity('voice');
  }
}
