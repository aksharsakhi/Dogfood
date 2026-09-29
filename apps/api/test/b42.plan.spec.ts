import {
  planPairwise,
  type PairwiseInput,
} from '../src/modules/pairwise/assignment-plan';

const input = (count: number): PairwiseInput => ({
  projects: Array.from({ length: count }, (_, i) => ({
    projectId: `project-${i}`,
    submissionId: `submission-${i}`,
    teamId: `team-${i}`,
  })),
  judges: [
    { id: 'judge-a', capacity: null, existingLoad: 0 },
    { id: 'judge-b', capacity: null, existingLoad: 0 },
  ],
  conflicts: [],
});

describe('B4.2 deterministic pairwise planner', () => {
  it('connects six projects without assigning every possible pair', () => {
    const plan = planPairwise(input(6));
    expect(plan.diagnostics.graphConnected).toBe(true);
    expect(plan.diagnostics.componentCount).toBe(1);
    expect(plan.diagnostics.minDegree).toBeGreaterThanOrEqual(2);
    expect(plan.pairs.length).toBeLessThan(15);
    const loads = plan.diagnostics.perJudgeWorkload.map(
      (judge) => judge.proposed,
    );
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
    expect(planPairwise(input(6))).toEqual(plan);
  });

  it('reports infeasible connectivity when conflicts exclude one project from every judge', () => {
    const fixture = input(4);
    fixture.conflicts = fixture.judges.map((judge) => ({
      judgeProfileId: judge.id,
      projectId: 'project-0',
      teamId: null,
      type: 'PROJECT',
    }));
    const plan = planPairwise(fixture);
    expect(plan.diagnostics.graphConnected).toBe(false);
    expect(plan.diagnostics.componentCount).toBe(2);
    expect(plan.diagnostics.perProjectDegree).toContainEqual({
      projectId: 'project-0',
      degree: 0,
    });
    expect(plan.diagnostics.unassignablePairs.length).toBeGreaterThan(0);
  });

  it('changes the fingerprint when only the selected submission version changes', () => {
    const fixture = input(4);
    const first = planPairwise(fixture);
    fixture.projects[0]!.submissionId = 'new-submission';
    const second = planPairwise(fixture);
    expect(second.snapshots[0]!.submissionId).toBe('new-submission');
    expect(second.inputHash).not.toBe(first.inputHash);
    expect(second.proposalHash).not.toBe(first.proposalHash);
  });
});
