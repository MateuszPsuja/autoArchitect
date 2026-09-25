import { SuccessCriterion } from '../../plan.schema';

export interface ScHarnessPlan {
  scId: string;
  buildTaskTitle: string;
  ciGateTitle: string;
}

const MEASURABLE_TOKEN_RE = /\b(p95|p99|latency|throughput|bytes|ms|seconds|%|percent|rps|qps)\b/i;

export function isMeasurable(sc: SuccessCriterion): boolean {
  if (sc.kind && sc.kind !== 'boolean') return true;
  if (typeof sc.latencyTargetMs === 'number' && sc.latencyTargetMs > 0) return true;
  return MEASURABLE_TOKEN_RE.test(sc.text);
}

export function planHarnessFor(sc: SuccessCriterion): ScHarnessPlan {
  return {
    scId: sc.id,
    buildTaskTitle: `Build ${sc.id} measurement harness`,
    ciGateTitle: `Wire ${sc.id} harness into CI`,
  };
}

export function phaseForCrossCutting(): 'phase-2' {
  return 'phase-2';
}
