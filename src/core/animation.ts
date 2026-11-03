/** Configuration travels with feature settings; these types do not own UI state. */
export interface AnimationConfig {
  schema_version: 1;
  key: string;
  interval_ms: number;
  questions: Record<string, { type: "noul"; instructions: string }>;
  ui: {
    activation_threshold: number;
    cumulative: boolean;
    items: Array<{ question_id: string; label: Record<string, string> }>;
  };
}
export interface AnimationResult {
  feature_key: string;
  activation_id: string;
  sequence: number;
  answers: Record<string, { type: "noul"; noul: number }>;
}
export interface AnimationError {
  feature_key: string;
  activation_id: string;
  sequence: number;
  code: string;
}
export function readAnimationConfig(
  settings: Record<string, unknown>,
): AnimationConfig | null {
  const c = settings.animation as AnimationConfig | undefined;
  if (
    !c ||
    c.schema_version !== 1 ||
    typeof c.key !== "string" ||
    !c.questions ||
    typeof c.questions !== "object" ||
    !c.ui ||
    !Array.isArray(c.ui.items)
  )
    return null;
  return c;
}
