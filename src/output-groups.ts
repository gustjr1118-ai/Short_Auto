import type { Output, Project } from './types';

export interface OutputGroup {
  id: string;
  title: string;
  versions: Output[];
}

export function groupOutputs(project: Pick<Project, 'outputs' | 'batch' | 'title'>): OutputGroup[] {
  const byId = new Map(project.outputs.map(output => [output.id, output]));
  const groups = new Map<string, OutputGroup>();
  for (const output of project.outputs) {
    let original = output;
    const seen = new Set([output.id]);
    while (original.captionRevisionOf && !seen.has(original.captionRevisionOf)) {
      const previous = byId.get(original.captionRevisionOf);
      if (!previous) break;
      seen.add(previous.id);
      original = previous;
    }
    const clipId = original.revision == null ? original.batchClipId : undefined;
    const id = clipId || 'single';
    const clip = clipId && project.batch?.clips.find(item => item.id === clipId);
    const title = clipId ? (clip && clip.title) || original.edit?.title?.text || project.title : project.title;
    const group = groups.get(id) || { id, title, versions: [] };
    group.versions.push(output);
    groups.set(id, group);
  }
  return [...groups.values()];
}

export function versionLabel(output: Output, index: number) {
  return `v${index + 1}${output.captionRevisionOf ? ' · 자막 수정' : ''}`;
}
