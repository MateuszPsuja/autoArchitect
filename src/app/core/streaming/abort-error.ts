
export class PlannerAbortError extends Error {
  constructor(message = 'Planner run aborted by caller') {
    super(message);
    this.name = 'PlannerAbortError';
  }
}

export function isPlannerAbortError(value: unknown): value is PlannerAbortError {
  return (
    value instanceof PlannerAbortError ||
    (value instanceof Error && value.name === 'PlannerAbortError') ||
    (value instanceof Error && /abort/i.test(value.message))
  );
}
