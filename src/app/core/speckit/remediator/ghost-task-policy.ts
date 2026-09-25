import { AgentTask, UserStory } from '../../plan.schema';

export interface GhostTaskDecision {
  taskId: string;
  disposition: 'covered' | 'rewritten' | 'synthesised' | 'deleted';
  replacementId?: string;
  ghost: boolean;
}

const REF_RE = /\(ref\s+US\d+\)/i;
const SYNTH_RE = /\(synth\)/i;

export function looksLikeGhostOrRef(task: AgentTask): boolean {
  return REF_RE.test(task.description) || SYNTH_RE.test(task.description);
}

export function decideGhost(
  task: AgentTask,
  story: UserStory | undefined,
): GhostTaskDecision {
  if (!looksLikeGhostOrRef(task)) {
    return { taskId: task.id, disposition: 'covered', ghost: false };
  }
  if (!story) {
    return { taskId: task.id, disposition: 'deleted', ghost: true };
  }
  const firstScenario = story.acceptanceScenarios?.[0];
  if (!firstScenario) {
    return { taskId: task.id, disposition: 'deleted', ghost: true };
  }
  const replacementId = `synth-${story.id.toLowerCase()}-${task.id.replace(/^T\d+-?/i, '').replace(/^synth-/, '')}`;
  const ac = firstScenario.then?.[0] ?? `Satisfies ${task.title}.`;
  return {
    taskId: task.id,
    disposition: 'synthesised',
    replacementId,
    ghost: true,
    acHint: ac,
  } as GhostTaskDecision & { acHint?: string };
}

export function synthesiseReplacementTask(
  decision: GhostTaskDecision & { acHint?: string },
  story: UserStory,
): AgentTask {
  return {
    id: decision.replacementId ?? `synth-${decision.taskId}`,
    title: `Implement ${story.title}`,
    description: story.description,
    acceptanceCriteria: [decision.acHint ?? story.independentTest],
    fileHints: [`src/app/features/${story.id.toLowerCase()}/`],
    userStoryIds: [story.id],
  };
}
