const NON_SLUG_RUN = /[^a-z0-9]+/g;
const LEADING_OR_TRAILING_DASH = /^-+|-+$/g;
const RESERVED_FEATURE_SLUGS = new Set(['con', 'prn', 'aux', 'nul', 'com1', 'lpt1']);

export const FEATURE_FOLDER_PATTERN = /^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(text: string): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  const collapsed = lower.replace(NON_SLUG_RUN, '-');
  const trimmed = collapsed.replace(LEADING_OR_TRAILING_DASH, '');
  if (!trimmed) return '';
  if (RESERVED_FEATURE_SLUGS.has(trimmed)) return '';
  return trimmed;
}

export function defaultSlugFromTitle(title: string): string {
  return slugify(title);
}

export function branchName(plan: {
  meta: { featureNumber: number; featureSlug: string };
}): string {
  return `${String(plan.meta.featureNumber).padStart(3, '0')}-${plan.meta.featureSlug}`;
}

export function featureFolder(plan: {
  meta: { featureNumber: number; featureSlug: string };
}): string {
  return `specs/${branchName(plan)}`;
}

export function exportBaseName(plan: {
  meta: { featureNumber: number; featureSlug: string };
}): string {
  return branchName(plan);
}
