export type AllocationJudge = {
  id: string;
  capacity: number;
  load: number;
  trackIds: string[];
};
export type AllocationSubmission = {
  id: string;
  projectId: string;
  trackId: string | null;
  covered: number;
  excludedJudgeIds: string[];
};
export type Pair = { submissionId: string; judgeProfileId: string };
export type AllocationInput = {
  judges: AllocationJudge[];
  submissions: AllocationSubmission[];
  reviewsPerSubmission: number;
};

type Edge = { to: number; reverse: number; capacity: number; original: number };
function add(graph: Edge[][], from: number, to: number, capacity: number) {
  const forward: Edge = {
    to,
    reverse: graph[to]!.length,
    capacity,
    original: capacity,
  };
  const reverse: Edge = {
    to: from,
    reverse: graph[from]!.length,
    capacity: 0,
    original: 0,
  };
  graph[from]!.push(forward);
  graph[to]!.push(reverse);
}

export function allocate(input: AllocationInput) {
  const judges = [...input.judges].sort((a, b) => a.id.localeCompare(b.id));
  const submissions = [...input.submissions].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const demand = (s: AllocationSubmission) =>
    Math.max(0, input.reviewsPerSubmission - s.covered);
  const eligible = (s: AllocationSubmission) =>
    judges.filter(
      (j) => j.capacity > j.load && !s.excludedJudgeIds.includes(j.id),
    );
  const required = submissions.reduce((sum, s) => sum + demand(s), 0);
  const source = 0;
  const firstSubmission = 1;
  const firstJudge = firstSubmission + submissions.length;
  const sink = firstJudge + judges.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  submissions.forEach((s, i) => {
    add(graph, source, firstSubmission + i, demand(s));
    judges.forEach((j, k) => {
      if (eligible(s).some((candidate) => candidate.id === j.id))
        add(graph, firstSubmission + i, firstJudge + k, 1);
    });
  });
  judges.forEach((j, k) =>
    add(graph, firstJudge + k, sink, Math.max(0, j.capacity - j.load)),
  );
  let achievable = 0;
  while (true) {
    const visited = new Set<number>();
    const walk = (node: number, flow: number): number => {
      if (node === sink) return flow;
      visited.add(node);
      for (const edge of graph[node]!) {
        if (edge.capacity <= 0 || visited.has(edge.to)) continue;
        const sent = walk(edge.to, Math.min(flow, edge.capacity));
        if (sent) {
          edge.capacity -= sent;
          graph[edge.to]![edge.reverse]!.capacity += sent;
          return sent;
        }
      }
      return 0;
    };
    const sent = walk(source, required - achievable);
    if (!sent) break;
    achievable += sent;
  }
  const flowPairs: Pair[] = [];
  submissions.forEach((s, i) => {
    for (const edge of graph[firstSubmission + i]!) {
      const k = edge.to - firstJudge;
      if (
        k >= 0 &&
        k < judges.length &&
        edge.original === 1 &&
        edge.capacity === 0
      )
        flowPairs.push({ submissionId: s.id, judgeProfileId: judges[k]!.id });
    }
  });
  const loads = new Map(judges.map((j) => [j.id, j.load]));
  const greedyPairs: Pair[] = [];
  const constrained = [...submissions].sort(
    (a, b) =>
      eligible(a).length - eligible(b).length || a.id.localeCompare(b.id),
  );
  for (const s of constrained) {
    const choices = eligible(s).sort(
      (a, b) =>
        loads.get(a.id)! - loads.get(b.id)! ||
        Number(b.trackIds.includes(s.trackId ?? '')) -
          Number(a.trackIds.includes(s.trackId ?? '')) ||
        a.id.localeCompare(b.id),
    );
    for (const j of choices) {
      if (
        greedyPairs.filter((p) => p.submissionId === s.id).length >= demand(s)
      )
        break;
      if (loads.get(j.id)! >= j.capacity) continue;
      greedyPairs.push({ submissionId: s.id, judgeProfileId: j.id });
      loads.set(j.id, loads.get(j.id)! + 1);
    }
  }
  const fallback = greedyPairs.length < required && achievable === required;
  const pairs = fallback ? flowPairs : greedyPairs;
  const covered = new Map<string, number>();
  for (const p of flowPairs)
    covered.set(p.submissionId, (covered.get(p.submissionId) ?? 0) + 1);
  const perSubmission = submissions.map((s) => {
    const possible = eligible(s).length;
    const achieved = covered.get(s.id) ?? 0;
    const reasons: string[] = [];
    if (possible < demand(s))
      reasons.push('insufficient eligible judges or conflicts');
    if (achieved < demand(s) && possible >= demand(s))
      reasons.push('shared judge capacity');
    return {
      submissionId: s.id,
      projectId: s.projectId,
      required: demand(s),
      achievable: achieved,
      shortfall: demand(s) - achieved,
      eligibleJudgeCount: possible,
      reasons,
    };
  });
  // Bipartite connectivity is diagnostic only; it never changes eligibility.
  const seen = new Set<string>();
  let components = 0;
  for (const s of submissions) {
    const key = `s:${s.id}`;
    if (seen.has(key)) continue;
    components++;
    const queue = [key];
    seen.add(key);
    while (queue.length) {
      const next = queue.shift()!;
      const neighbors = next.startsWith('s:')
        ? eligible(submissions.find((x) => `s:${x.id}` === next)!).map(
            (j) => `j:${j.id}`,
          )
        : submissions
            .filter((x) => eligible(x).some((j) => `j:${j.id}` === next))
            .map((x) => `s:${x.id}`);
      for (const neighbor of neighbors)
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
    }
  }
  return {
    required,
    achievable,
    shortfall: required - achievable,
    perSubmission,
    affectedSubmissions: perSubmission.filter((s) => s.shortfall > 0),
    connectivity: { components },
    greedyCount: greedyPairs.length,
    allocationSource: fallback ? 'flow-fallback' : 'greedy',
    pairs,
  };
}
