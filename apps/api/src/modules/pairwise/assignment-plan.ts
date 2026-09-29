import { createHash } from 'node:crypto';

export type PairwiseProjectInput = {
  projectId: string;
  submissionId: string;
  teamId: string;
};
export type PairwiseJudgeInput = {
  id: string;
  capacity: number | null;
  existingLoad: number;
};
export type PairwiseInput = {
  projects: PairwiseProjectInput[];
  judges: PairwiseJudgeInput[];
  conflicts: {
    judgeProfileId: string;
    projectId: string | null;
    teamId: string | null;
    type: string;
  }[];
};

export function hashPairwise(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function planPairwise(input: PairwiseInput) {
  const projects = [...input.projects].sort((a, b) =>
    a.projectId.localeCompare(b.projectId),
  );
  const judges = [...input.judges].sort((a, b) => a.id.localeCompare(b.id));
  const conflicts = [...input.conflicts].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
  const canonical = { projects, judges, conflicts };
  const inputHash = hashPairwise(canonical);
  const load = new Map(judges.map((judge) => [judge.id, judge.existingLoad]));
  const degree = new Map(projects.map((project) => [project.projectId, 0]));
  const pairs: {
    projectAId: string;
    projectBId: string;
    judgeProfileId: string;
  }[] = [];
  const unassignablePairs: { projectAId: string; projectBId: string }[] = [];
  const visited = new Set<string>();
  let conflictsExcluded = 0;

  const blocked = (judgeId: string, project: PairwiseProjectInput) =>
    conflicts.some(
      (conflict) =>
        conflict.judgeProfileId === judgeId &&
        (conflict.projectId === project.projectId ||
          conflict.teamId === project.teamId ||
          ['ORGANIZATION', 'OTHER'].includes(conflict.type)),
    );
  const tryPair = (left: PairwiseProjectInput, right: PairwiseProjectInput) => {
    if (left.projectId === right.projectId) return;
    const [a, b] =
      left.projectId < right.projectId ? [left, right] : [right, left];
    const key = `${a.projectId}:${b.projectId}`;
    if (visited.has(key)) return;
    visited.add(key);
    const eligible = judges.filter((judge) => {
      const conflict = blocked(judge.id, a) || blocked(judge.id, b);
      if (conflict) conflictsExcluded++;
      return (
        !conflict &&
        (judge.capacity === null || (load.get(judge.id) ?? 0) < judge.capacity)
      );
    });
    eligible.sort(
      (x, y) =>
        (load.get(x.id) ?? 0) - (load.get(y.id) ?? 0) ||
        x.id.localeCompare(y.id),
    );
    if (!eligible.length) {
      unassignablePairs.push({
        projectAId: a.projectId,
        projectBId: b.projectId,
      });
      return;
    }
    const judge = eligible[0]!;
    pairs.push({
      projectAId: a.projectId,
      projectBId: b.projectId,
      judgeProfileId: judge.id,
    });
    load.set(judge.id, (load.get(judge.id) ?? 0) + 1);
    degree.set(a.projectId, (degree.get(a.projectId) ?? 0) + 1);
    degree.set(b.projectId, (degree.get(b.projectId) ?? 0) + 1);
  };

  // One cycle is the backbone. For six or more projects, fixed half-turn
  // cross-links improve degree without assigning the complete graph.
  // Two projects receive one edge; three projects need the full triangle.
  for (let i = 0; i < projects.length - 1; i++)
    tryPair(projects[i]!, projects[i + 1]!);
  if (projects.length > 2)
    tryPair(projects[projects.length - 1]!, projects[0]!);
  if (projects.length >= 6) {
    const offset = Math.floor(projects.length / 2);
    for (let i = 0; i < projects.length; i++)
      tryPair(projects[i]!, projects[(i + offset) % projects.length]!);
  }

  const componentCount = () => {
    const parent = new Map(projects.map((p) => [p.projectId, p.projectId]));
    const root = (id: string): string => {
      let current = id;
      while (parent.get(current) !== current) current = parent.get(current)!;
      return current;
    };
    for (const pair of pairs)
      parent.set(root(pair.projectBId), root(pair.projectAId));
    return new Set(projects.map((p) => root(p.projectId))).size;
  };
  // If conflicts broke the fixed backbone, scan remaining candidates only
  // until a feasible connection is found. Never assign the full pair set.
  for (let i = 0; componentCount() > 1 && i < projects.length; i++) {
    for (let j = i + 1; componentCount() > 1 && j < projects.length; j++) {
      tryPair(projects[i]!, projects[j]!);
    }
  }
  const degrees = projects.map((project) => ({
    projectId: project.projectId,
    degree: degree.get(project.projectId) ?? 0,
  }));
  const components = componentCount();
  const diagnostics = {
    projectCount: projects.length,
    judgeCount: judges.length,
    proposedComparisonCount: pairs.length,
    perProjectDegree: degrees,
    minDegree: degrees.length ? Math.min(...degrees.map((d) => d.degree)) : 0,
    maxDegree: degrees.length ? Math.max(...degrees.map((d) => d.degree)) : 0,
    componentCount: components,
    graphConnected: projects.length >= 2 && components === 1,
    perJudgeWorkload: judges.map((judge) => ({
      judgeProfileId: judge.id,
      existing: judge.existingLoad,
      proposed: (load.get(judge.id) ?? 0) - judge.existingLoad,
    })),
    conflictsExcluded,
    unassignablePairs,
  };
  return {
    inputHash,
    proposalHash: hashPairwise({ inputHash, pairs, diagnostics }),
    snapshots: projects.map(({ projectId, submissionId }) => ({
      projectId,
      submissionId,
    })),
    pairs,
    diagnostics,
  };
}
