import { AgentTask, UserStory } from '../plan.schema';

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function dedupKey(task: AgentTask): string {
  const hints = [...(task.fileHints ?? [])].sort();
  return `${normalize(task.description ?? '')}::${hints.join('|')}`;
}

export function pickPrimaryStory(task: AgentTask, stories: UserStory[]): string {
  const sorted = [...stories].sort((a, b) => a.priority.localeCompare(b.priority));
  const hinted = sorted.find((s) => task.userStoryIds.includes(s.id));
  return hinted?.id ?? sorted[0]?.id ?? 'US000';
}

export function crossReferenceLine(
  task: AgentTask,
  primaryId: string,
  storyId: string,
): string {
  const snippet = (task.description ?? '').slice(0, 60).trim();
  const ellipsis = (task.description ?? '').length > 60 ? '…' : '';
  const idLabel = task.id ?? '???';
  if (storyId === primaryId) {
    return `- [ ] ${idLabel} (ref ${primaryId}) [${storyId}] — implementation lives in ${primaryId} (${snippet}${ellipsis})`;
  }
  return `- [ ] ${idLabel} (ref ${primaryId}) [${storyId}] — implementation lives in ${primaryId} (${snippet}${ellipsis})`;
}
