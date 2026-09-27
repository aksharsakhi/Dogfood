import { CsvColumn } from './csv.util';

export interface JudgeExportRow {
  judgeProfileId: string;
  userId: string;
  name: string;
  email: string;
  status: string;
  available: boolean;
  maxAssignments: number | null;
  assignedCount: number;
  completedCount: number;
}

export const JUDGES_EXPORT_COLUMNS: CsvColumn<JudgeExportRow>[] = [
  { header: 'Judge Profile ID', accessor: (r) => r.judgeProfileId },
  { header: 'User ID', accessor: (r) => r.userId },
  { header: 'Name', accessor: (r) => r.name },
  { header: 'Email', accessor: (r) => r.email },
  { header: 'Status', accessor: (r) => r.status },
  { header: 'Available', accessor: (r) => r.available },
  {
    header: 'Max Assignments',
    accessor: (r) => r.maxAssignments,
    isNumeric: true,
  },
  {
    header: 'Assigned Count',
    accessor: (r) => r.assignedCount,
    isNumeric: true,
  },
  {
    header: 'Completed Count',
    accessor: (r) => r.completedCount,
    isNumeric: true,
  },
];

export interface AssignmentExportRow {
  assignmentId: string;
  runId: string;
  submissionId: string;
  projectId: string;
  projectTitle: string;
  judgeProfileId: string;
  judgeName: string;
  status: string;
  createdAt: string;
}

export const ASSIGNMENTS_EXPORT_COLUMNS: CsvColumn<AssignmentExportRow>[] = [
  { header: 'Assignment ID', accessor: (r) => r.assignmentId },
  { header: 'Run ID', accessor: (r) => r.runId },
  { header: 'Submission ID', accessor: (r) => r.submissionId },
  { header: 'Project ID', accessor: (r) => r.projectId },
  { header: 'Project Title', accessor: (r) => r.projectTitle },
  { header: 'Judge Profile ID', accessor: (r) => r.judgeProfileId },
  { header: 'Judge Name', accessor: (r) => r.judgeName },
  { header: 'Status', accessor: (r) => r.status },
  { header: 'Created At', accessor: (r) => r.createdAt },
];

export interface ProgressExportRow {
  submissionId: string;
  projectId: string;
  projectTitle: string;
  requiredEvaluations: number;
  assignedEvaluations: number;
  completedEvaluations: number;
  shortfall: number;
}

export const PROGRESS_EXPORT_COLUMNS: CsvColumn<ProgressExportRow>[] = [
  { header: 'Submission ID', accessor: (r) => r.submissionId },
  { header: 'Project ID', accessor: (r) => r.projectId },
  { header: 'Project Title', accessor: (r) => r.projectTitle },
  {
    header: 'Required Evaluations',
    accessor: (r) => r.requiredEvaluations,
    isNumeric: true,
  },
  {
    header: 'Assigned Evaluations',
    accessor: (r) => r.assignedEvaluations,
    isNumeric: true,
  },
  {
    header: 'Completed Evaluations',
    accessor: (r) => r.completedEvaluations,
    isNumeric: true,
  },
  { header: 'Shortfall', accessor: (r) => r.shortfall, isNumeric: true },
];

export interface RawEvaluationExportRow {
  evaluationId: string;
  submissionId: string;
  projectId: string;
  projectTitle: string;
  judgeProfileId: string;
  judgeName: string;
  status: string;
  rubricId: string;
  criterionId: string;
  criterionName: string;
  score: number | string;
  rawWeightedScore: number | string;
  submittedAt: string;
}

export const RAW_EVALUATIONS_EXPORT_COLUMNS: CsvColumn<RawEvaluationExportRow>[] =
  [
    { header: 'Evaluation ID', accessor: (r) => r.evaluationId },
    { header: 'Submission ID', accessor: (r) => r.submissionId },
    { header: 'Project ID', accessor: (r) => r.projectId },
    { header: 'Project Title', accessor: (r) => r.projectTitle },
    { header: 'Judge Profile ID', accessor: (r) => r.judgeProfileId },
    { header: 'Judge Name', accessor: (r) => r.judgeName },
    { header: 'Status', accessor: (r) => r.status },
    { header: 'Rubric ID', accessor: (r) => r.rubricId },
    { header: 'Criterion ID', accessor: (r) => r.criterionId },
    { header: 'Criterion Name', accessor: (r) => r.criterionName },
    { header: 'Score', accessor: (r) => r.score, isNumeric: true },
    {
      header: 'Raw Weighted Score',
      accessor: (r) => r.rawWeightedScore,
      isNumeric: true,
    },
    { header: 'Submitted At', accessor: (r) => r.submittedAt },
  ];

export interface NormalizedScoreExportRow {
  scoreRunId: string;
  method: string;
  methodVersion: string;
  rubricVersionId: string;
  evaluationId: string;
  submissionId: string;
  projectId: string;
  projectTitle: string;
  judgeProfileId: string;
  rawWeightedScore: number | string;
  normalizedScore: number | string;
  diagnostic: string | null;
}

export const NORMALIZED_SCORES_EXPORT_COLUMNS: CsvColumn<NormalizedScoreExportRow>[] =
  [
    { header: 'ScoreRun ID', accessor: (r) => r.scoreRunId },
    { header: 'Method', accessor: (r) => r.method },
    { header: 'Method Version', accessor: (r) => r.methodVersion },
    { header: 'Rubric Version ID', accessor: (r) => r.rubricVersionId },
    { header: 'Evaluation ID', accessor: (r) => r.evaluationId },
    { header: 'Submission ID', accessor: (r) => r.submissionId },
    { header: 'Project ID', accessor: (r) => r.projectId },
    { header: 'Project Title', accessor: (r) => r.projectTitle },
    { header: 'Judge Profile ID', accessor: (r) => r.judgeProfileId },
    {
      header: 'Raw Weighted Score',
      accessor: (r) => r.rawWeightedScore,
      isNumeric: true,
    },
    {
      header: 'Normalized Score',
      accessor: (r) => r.normalizedScore,
      isNumeric: true,
    },
    { header: 'Diagnostic', accessor: (r) => r.diagnostic },
  ];

export interface ProjectScoreExportRow {
  scoreRunId: string;
  method: string;
  methodVersion: string;
  rubricVersionId: string;
  projectId: string;
  projectTitle: string;
  rawAverage: number | string;
  normalizedAggregate: number | string;
  evaluationCount: number;
  requiredCount: number;
  coverageComplete: boolean;
}

export const PROJECT_SCORES_EXPORT_COLUMNS: CsvColumn<ProjectScoreExportRow>[] =
  [
    { header: 'ScoreRun ID', accessor: (r) => r.scoreRunId },
    { header: 'Method', accessor: (r) => r.method },
    { header: 'Method Version', accessor: (r) => r.methodVersion },
    { header: 'Rubric Version ID', accessor: (r) => r.rubricVersionId },
    { header: 'Project ID', accessor: (r) => r.projectId },
    { header: 'Project Title', accessor: (r) => r.projectTitle },
    { header: 'Raw Average', accessor: (r) => r.rawAverage, isNumeric: true },
    {
      header: 'Normalized Aggregate',
      accessor: (r) => r.normalizedAggregate,
      isNumeric: true,
    },
    {
      header: 'Evaluation Count',
      accessor: (r) => r.evaluationCount,
      isNumeric: true,
    },
    {
      header: 'Required Count',
      accessor: (r) => r.requiredCount,
      isNumeric: true,
    },
    { header: 'Coverage Complete', accessor: (r) => r.coverageComplete },
  ];

export interface ResultExportRow {
  resultRunId: string;
  scoreRunId: string;
  rankingPolicy: string;
  rankingVersion: string;
  coverageIncomplete: boolean;
  overrideReason: string | null;
  rank: number;
  projectId: string;
  projectTitle: string;
  score: number | string;
}

export const RESULTS_EXPORT_COLUMNS: CsvColumn<ResultExportRow>[] = [
  { header: 'ResultRun ID', accessor: (r) => r.resultRunId },
  { header: 'ScoreRun ID', accessor: (r) => r.scoreRunId },
  { header: 'Ranking Policy', accessor: (r) => r.rankingPolicy },
  { header: 'Ranking Version', accessor: (r) => r.rankingVersion },
  { header: 'Coverage Incomplete', accessor: (r) => r.coverageIncomplete },
  { header: 'Override Reason', accessor: (r) => r.overrideReason },
  { header: 'Rank', accessor: (r) => r.rank, isNumeric: true },
  { header: 'Project ID', accessor: (r) => r.projectId },
  { header: 'Project Title', accessor: (r) => r.projectTitle },
  { header: 'Score', accessor: (r) => r.score, isNumeric: true },
];
