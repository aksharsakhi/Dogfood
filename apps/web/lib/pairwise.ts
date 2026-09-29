export type PairwiseRun = {
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
  createdAt: string;
};
export type PairwisePreview = {
  proposalHash: string;
  pairs: Array<{
    projectAId: string;
    projectBId: string;
    judgeProfileId: string;
  }>;
  diagnostics: {
    graphConnected: boolean;
    componentCount: number;
    projectCount: number;
    judgeCount: number;
    proposedComparisonCount: number;
    conflictsExcluded: number;
    perJudgeWorkload: Array<{
      judgeProfileId: string;
      existing: number;
      proposed: number;
    }>;
    unassignablePairs: Array<{ projectAId: string; projectBId: string }>;
  };
};
export type EvidenceGraph = {
  graphConnected: boolean;
  componentCount: number;
  components: string[][];
  comparisonCount: number;
  projectCount: number;
};
export type PairwiseProgress = {
  totalAssignments: number;
  submitted: number;
  pending: number;
  completionPercent: number;
  perJudge: Array<{ judgeProfileId: string; total: number; submitted: number }>;
  evidenceGraph: EvidenceGraph;
};
export type PairwiseRanking = {
  id: string;
  rankingRunId: string;
  createdAt: string;
  stale: boolean;
  algorithm: string;
  algorithmVersion: string;
  lambda: string;
  inputSetHash: string;
  comparisonCount: number;
  currentComparisonCount: number;
  projectCount: number;
  componentCount: number;
  converged: boolean;
  iterations: number;
  finalDelta: string;
  stronglyConnectedWinGraph: boolean;
  separationRisk: boolean;
  regularizationSensitive: boolean;
  results: Array<{
    projectId: string;
    projectName: string;
    submissionId: string;
    rank: number;
    strength: string;
    canonicalStrength: string;
    wins: number;
    losses: number;
  }>;
};
export type PairwiseMaterial = {
  projectId: string;
  submission: {
    id: string;
    title: string;
    description: string;
    projectName: string | null;
    projectTagline: string | null;
    repositoryUrl: string | null;
    demoUrl: string | null;
    version: number;
  };
};
export type PairwiseAssignment = {
  assignmentId: string;
  runId: string;
  runStatus: string;
  status: string;
  projectA: PairwiseMaterial;
  projectB: PairwiseMaterial;
  comparison: {
    id: string;
    winnerProjectId: string;
    submittedAt: string;
  } | null;
};
export type PairwiseWorkspace = { assignments: PairwiseAssignment[] };
