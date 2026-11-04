import { builtInTemplates } from '@/core/templates';
import type { RaceTemplate } from '@/core/types';

import { adminRpc } from './client';

export type GymFormat = { id: string; name: string; body: Pick<RaceTemplate, 'divisions' | 'segments' | 'targets'>; updatedAt: string };

/** A format the organiser can pick: built in ones first, then the gym's own. */
export type FormatChoice = { key: string; template: RaceTemplate; builtIn: boolean; gymId?: string };

export function gymToTemplate(f: GymFormat): RaceTemplate {
  return { id: f.id, name: f.name, divisions: f.body.divisions ?? [], segments: f.body.segments ?? [], targets: f.body.targets ?? [] };
}

export async function loadFormats(org: string): Promise<FormatChoice[]> {
  const gym = await adminRpc<GymFormat[]>('list_templates', { p_org: org });
  return [
    ...gym.map((f) => ({ key: f.id, template: gymToTemplate(f), builtIn: false, gymId: f.id })),
    ...builtInTemplates.map((t) => ({ key: t.id, template: t, builtIn: true })),
  ];
}

export async function saveFormat(org: string, t: RaceTemplate, id: string | null): Promise<string> {
  return adminRpc<string>('save_template', {
    p_org: org,
    p_id: id,
    p_name: t.name,
    p_body: { divisions: t.divisions, segments: t.segments, targets: t.targets },
  });
}

export async function deleteFormat(org: string, id: string): Promise<void> {
  await adminRpc('delete_template', { p_org: org, p_id: id });
}
