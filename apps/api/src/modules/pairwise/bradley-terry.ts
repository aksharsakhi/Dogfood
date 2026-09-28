import { createHash } from 'node:crypto';

export interface PairwiseComparisonInput {
  id?: string;
  winnerProjectId: string;
  loserProjectId: string;
}

export interface BradleyTerryFitInput {
  projectIds: string[];
  comparisons: PairwiseComparisonInput[];
  lambda?: number;
  tolerance?: number;
  maxIterations?: number;
}

export interface BradleyTerryProjectStrength {
  projectId: string;
  beta: number;
  canonicalStrength: number;
  canonicalStrengthStr: string;
  wins: number;
  losses: number;
}

export interface BradleyTerryProjectRank extends BradleyTerryProjectStrength {
  rank: number;
}

export interface BradleyTerryRidgeResult {
  algorithm: 'BRADLEY_TERRY_RIDGE';
  algorithmVersion: 'V1';
  lambda: number;
  connected: boolean;
  componentCount: number;
  components: string[][];
  stronglyConnectedWinGraph: boolean;
  regularizationSensitive: boolean;
  separationRisk: boolean;
  converged: boolean;
  iterations: number;
  finalDelta: number;
  finalObjective: number;
  projectCount: number;
  comparisonCount: number;
  strengths: BradleyTerryProjectStrength[];
  ranks: BradleyTerryProjectRank[];
}

export const FROZEN_PAIRWISE_CONFIG = {
  algorithm: 'BRADLEY_TERRY_RIDGE' as const,
  algorithmVersion: 'V1' as const,
  lambda: 0.01,
  tolerance: 1e-8,
  maxIterations: 200,
  canonicalScale: 6,
};

/**
 * Canonical 6-decimal rounding using ROUND_HALF_UP convention.
 */
export function canonicalRoundHalfUp(val: number, scale = 6): number {
  if (!Number.isFinite(val)) return val;
  const factor = Math.pow(10, scale);
  const sign = val < 0 ? -1 : 1;
  const absVal = Math.abs(val);
  // Add epsilon to combat floating-point imprecision on exact .5 boundaries
  const rounded = Math.floor(absVal * factor + 0.5) / factor;
  return sign * rounded;
}

export function formatCanonicalDecimalStr(val: number, scale = 6): string {
  const rounded = canonicalRoundHalfUp(val, scale);
  return rounded.toFixed(scale);
}

/**
 * Numerically stable log(sigmoid(x)) = log(1 / (1 + exp(-x)))
 */
function logSigmoid(x: number): number {
  if (x >= 0) {
    return -Math.log(1 + Math.exp(-x));
  }
  return x - Math.log(1 + Math.exp(x));
}

/**
 * Numerically stable sigmoid(x) = 1 / (1 + exp(-x))
 */
function sigmoid(x: number): number {
  if (x >= 0) {
    return 1 / (1 + Math.exp(-x));
  }
  const expX = Math.exp(x);
  return expX / (1 + expX);
}

/**
 * Solve linear system A * x = b using Gaussian elimination with partial pivoting.
 * A is symmetric positive definite (n x n), b is length n.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Deep clone to avoid mutating input matrices
  const M: number[][] = A.map((row) => [...row]);
  const x: number[] = [...b];

  for (let k = 0; k < n; k++) {
    // Find pivot
    let maxRow = k;
    let maxVal = Math.abs(M[k]![k]!);
    for (let r = k + 1; r < n; r++) {
      const val = Math.abs(M[r]![k]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = r;
      }
    }

    if (maxVal < 1e-14) {
      throw new Error(`Singular matrix encountered at index ${k}`);
    }

    // Swap rows
    if (maxRow !== k) {
      const tempRow = M[k]!;
      M[k] = M[maxRow]!;
      M[maxRow] = tempRow;
      const tempB = x[k]!;
      x[k] = x[maxRow]!;
      x[maxRow] = tempB;
    }

    // Eliminate below
    for (let i = k + 1; i < n; i++) {
      const rowI = M[i]!;
      const rowK = M[k]!;
      const factor = rowI[k]! / rowK[k]!;
      rowI[k] = 0;
      for (let j = k + 1; j < n; j++) {
        rowI[j] = (rowI[j] ?? 0) - factor * (rowK[j] ?? 0);
      }
      x[i] = (x[i] ?? 0) - factor * (x[k] ?? 0);
    }
  }

  // Back substitution
  const result = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= M[i]![j]! * result[j]!;
    }
    result[i] = sum / M[i]![i]!;
  }

  return result;
}

/**
 * Compute connected components of the undirected evidence graph.
 */
function computeUndirectedComponents(
  n: number,
  edges: Array<[number, number]>,
  projectIds: string[],
): string[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    adj[u]!.push(v);
    adj[v]!.push(u);
  }

  const visited = new Uint8Array(n);
  const components: string[][] = [];

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const comp: string[] = [];
    const queue: number[] = [i];
    visited[i] = 1;

    while (queue.length > 0) {
      const curr = queue.shift()!;
      comp.push(projectIds[curr]!);
      for (const neighbor of adj[curr]!) {
        if (!visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    components.push(comp.sort());
  }

  return components;
}

/**
 * Compute strongly connected components (SCC) of the directed win graph (winner -> loser)
 * using Tarjan's algorithm.
 */
function isWinGraphStronglyConnected(
  n: number,
  directedEdges: Array<[number, number]>,
): boolean {
  if (n <= 1) return true;

  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [w, l] of directedEdges) {
    adj[w]!.push(l);
  }

  let index = 0;
  const indices = new Int32Array(n).fill(-1);
  const lowlinks = new Int32Array(n).fill(-1);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  let sccCount = 0;

  function strongConnect(v: number) {
    indices[v] = index;
    lowlinks[v] = index;
    index++;
    stack.push(v);
    onStack[v] = 1;

    for (const w of adj[v]!) {
      if (indices[w] === -1) {
        strongConnect(w);
        lowlinks[v] = Math.min(lowlinks[v]!, lowlinks[w]!);
      } else if (onStack[w]) {
        lowlinks[v] = Math.min(lowlinks[v]!, indices[w]!);
      }
    }

    if (lowlinks[v] === indices[v]) {
      sccCount++;
      let w: number;
      do {
        w = stack.pop()!;
        onStack[w] = 0;
      } while (w !== v);
    }
  }

  for (let i = 0; i < n; i++) {
    if (indices[i] === -1) {
      strongConnect(i);
    }
  }

  // Exactly 1 SCC containing all n nodes means the graph is strongly connected
  return sccCount === 1;
}

/**
 * Compute objective:
 * L(beta) = sum_c log P(winner_c beats loser_c) - (lambda / 2) * sum_i beta_i^2
 */
function computeObjective(
  beta: number[],
  pairs: Array<{ winnerIdx: number; loserIdx: number }>,
  lambda: number,
): number {
  let logLikelihood = 0;
  for (const pair of pairs) {
    const x = beta[pair.winnerIdx]! - beta[pair.loserIdx]!;
    logLikelihood += logSigmoid(x);
  }

  let penalty = 0;
  for (let i = 0; i < beta.length; i++) {
    penalty += beta[i]! * beta[i]!;
  }

  return logLikelihood - (lambda / 2) * penalty;
}

/**
 * Competition ranking (1, 1, 3 for ties) based on canonical strength.
 */
export function assignCompetitionRanks(
  strengths: BradleyTerryProjectStrength[],
): BradleyTerryProjectRank[] {
  // Sort descending by canonicalStrength, breaking ties deterministically by projectId
  const sorted = [...strengths].sort((a, b) => {
    if (b.canonicalStrength !== a.canonicalStrength) {
      return b.canonicalStrength - a.canonicalStrength;
    }
    return a.projectId.localeCompare(b.projectId);
  });

  const ranked: BradleyTerryProjectRank[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i]!;
    let rank = i + 1;
    if (i > 0) {
      const prev = ranked[i - 1]!;
      if (curr.canonicalStrength === prev.canonicalStrength) {
        rank = prev.rank;
      }
    }
    ranked.push({ ...curr, rank });
  }

  return ranked;
}

/**
 * Deterministic Bradley–Terry estimator with L2 (ridge) regularization.
 *
 * Algorithm: BRADLEY_TERRY_RIDGE_V1
 * - Optimization: Damped Newton-Raphson with backtracking line search
 * - Identifiability gauge: sum(beta) = 0 (subtracted after each accepted iteration)
 * - Deterministic project ordering: ascending string sort before matrix construction
 * - Ridge penalty guarantees strictly positive definite Hessian even on separated sets
 */
export function fitBradleyTerryRidgeV1(
  input: BradleyTerryFitInput,
): BradleyTerryRidgeResult {
  const lambda = input.lambda ?? FROZEN_PAIRWISE_CONFIG.lambda;
  const tolerance = input.tolerance ?? FROZEN_PAIRWISE_CONFIG.tolerance;
  const maxIterations =
    input.maxIterations ?? FROZEN_PAIRWISE_CONFIG.maxIterations;

  // 1. Deterministic project ordering (ascending)
  const sortedProjectIds = Array.from(new Set(input.projectIds)).sort((a, b) =>
    a.localeCompare(b),
  );
  const n = sortedProjectIds.length;
  const projectIdxMap = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    projectIdxMap.set(sortedProjectIds[i]!, i);
  }

  // 2. Index comparisons
  const indexedPairs: Array<{ winnerIdx: number; loserIdx: number }> = [];
  const undirectedEdges: Array<[number, number]> = [];
  const directedEdges: Array<[number, number]> = [];
  const wins = new Int32Array(n);
  const losses = new Int32Array(n);

  for (const cmp of input.comparisons) {
    const w = projectIdxMap.get(cmp.winnerProjectId);
    const l = projectIdxMap.get(cmp.loserProjectId);
    if (w === undefined || l === undefined) {
      throw new Error(
        `Comparison project [${cmp.winnerProjectId} vs ${cmp.loserProjectId}] not found in projectIds`,
      );
    }
    if (w === l) {
      throw new Error(`Self-comparison not allowed: ${cmp.winnerProjectId}`);
    }
    indexedPairs.push({ winnerIdx: w, loserIdx: l });
    undirectedEdges.push([w, l]);
    directedEdges.push([w, l]);
    wins[w] = (wins[w] ?? 0) + 1;
    losses[l] = (losses[l] ?? 0) + 1;
  }

  // 3. Undirected graph connectivity
  const components = computeUndirectedComponents(
    n,
    undirectedEdges,
    sortedProjectIds,
  );
  const componentCount = components.length;
  const connected = n === 0 || componentCount === 1;

  // 4. Directed win-graph strong connectivity
  const stronglyConnectedWinGraph = isWinGraphStronglyConnected(
    n,
    directedEdges,
  );
  const separationRisk = !stronglyConnectedWinGraph;
  const regularizationSensitive = separationRisk;

  // If undirected graph is disconnected, global ranking is invalid
  if (!connected) {
    return {
      algorithm: FROZEN_PAIRWISE_CONFIG.algorithm,
      algorithmVersion: FROZEN_PAIRWISE_CONFIG.algorithmVersion,
      lambda,
      connected: false,
      componentCount,
      components,
      stronglyConnectedWinGraph,
      regularizationSensitive,
      separationRisk,
      converged: false,
      iterations: 0,
      finalDelta: 0,
      finalObjective: 0,
      projectCount: n,
      comparisonCount: input.comparisons.length,
      strengths: [],
      ranks: [],
    };
  }

  // Trivial cases
  if (n === 0) {
    return {
      algorithm: FROZEN_PAIRWISE_CONFIG.algorithm,
      algorithmVersion: FROZEN_PAIRWISE_CONFIG.algorithmVersion,
      lambda,
      connected: true,
      componentCount: 0,
      components: [],
      stronglyConnectedWinGraph: true,
      regularizationSensitive: false,
      separationRisk: false,
      converged: true,
      iterations: 0,
      finalDelta: 0,
      finalObjective: 0,
      projectCount: 0,
      comparisonCount: 0,
      strengths: [],
      ranks: [],
    };
  }

  if (n === 1) {
    const singleStrength: BradleyTerryProjectStrength = {
      projectId: sortedProjectIds[0]!,
      beta: 0,
      canonicalStrength: 0,
      canonicalStrengthStr: '0.000000',
      wins: wins[0]!,
      losses: losses[0]!,
    };
    return {
      algorithm: FROZEN_PAIRWISE_CONFIG.algorithm,
      algorithmVersion: FROZEN_PAIRWISE_CONFIG.algorithmVersion,
      lambda,
      connected: true,
      componentCount: 1,
      components,
      stronglyConnectedWinGraph: true,
      regularizationSensitive: false,
      separationRisk: false,
      converged: true,
      iterations: 0,
      finalDelta: 0,
      finalObjective: 0,
      projectCount: 1,
      comparisonCount: input.comparisons.length,
      strengths: [singleStrength],
      ranks: [{ ...singleStrength, rank: 1 }],
    };
  }

  // 5. Damped Newton-Raphson Optimization
  let beta = new Array<number>(n).fill(0);
  let converged = false;
  let iterations = 0;
  let finalDelta = 0;

  for (let iter = 1; iter <= maxIterations; iter++) {
    iterations = iter;

    // Compute gradient and negative Hessian (-H)
    // -H = W + lambda * I, which is strictly positive definite
    const g = new Array<number>(n).fill(0);
    const negH: number[][] = Array.from({ length: n }, () =>
      new Array<number>(n).fill(0),
    );

    // Ridge penalty contribution: -lambda * beta_i to g, +lambda to negH[i][i]
    for (let i = 0; i < n; i++) {
      g[i] = (g[i] ?? 0) - lambda * (beta[i] ?? 0);
      negH[i]![i] = (negH[i]![i] ?? 0) + lambda;
    }

    // Likelihood contributions
    for (const pair of indexedPairs) {
      const w = pair.winnerIdx;
      const l = pair.loserIdx;
      const diff = beta[w]! - beta[l]!;
      const p = sigmoid(diff);
      const wPrime = p * (1 - p); // derivative of sigmoid

      g[w] = (g[w] ?? 0) + (1 - p);
      g[l] = (g[l] ?? 0) - (1 - p);

      negH[w]![w] = (negH[w]![w] ?? 0) + wPrime;
      negH[l]![l] = (negH[l]![l] ?? 0) + wPrime;
      negH[w]![l] = (negH[w]![l] ?? 0) - wPrime;
      negH[l]![w] = (negH[l]![w] ?? 0) - wPrime;
    }

    // Solve (-H) * deltaBeta = g
    const deltaBeta = solveLinearSystem(negH, g);

    // Backtracking line search (Armijo rule)
    const currentObjective = computeObjective(beta, indexedPairs, lambda);
    let stepSize = 1.0;
    let directionalDeriv = 0;
    for (let i = 0; i < n; i++) {
      directionalDeriv += g[i]! * deltaBeta[i]!;
    }

    let acceptedBeta: number[] | null = null;
    const c1 = 1e-4;

    while (stepSize >= 1e-6) {
      const candidateBeta = beta.map((b, i) => b + stepSize * deltaBeta[i]!);
      const candidateObjective = computeObjective(
        candidateBeta,
        indexedPairs,
        lambda,
      );

      if (
        candidateObjective >=
        currentObjective + c1 * stepSize * directionalDeriv
      ) {
        acceptedBeta = candidateBeta;
        break;
      }
      stepSize *= 0.5;
    }

    if (!acceptedBeta) {
      // Step could not improve further: terminate
      finalDelta = 0;
      for (let i = 0; i < n; i++) {
        finalDelta = Math.max(finalDelta, Math.abs(deltaBeta[i]!));
      }
      converged = finalDelta < tolerance;
      break;
    }

    // Apply identifiability normalization: sum(beta) = 0
    let sumBeta = 0;
    for (let i = 0; i < n; i++) {
      sumBeta += acceptedBeta[i]!;
    }
    const meanBeta = sumBeta / n;
    for (let i = 0; i < n; i++) {
      acceptedBeta[i] = (acceptedBeta[i] ?? 0) - meanBeta;
    }

    // Parameter delta
    let maxParamDelta = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(acceptedBeta[i]! - beta[i]!);
      if (d > maxParamDelta) {
        maxParamDelta = d;
      }
    }

    beta = acceptedBeta;
    finalDelta = maxParamDelta;

    if (maxParamDelta < tolerance) {
      converged = true;
      break;
    }
  }

  const finalObjective = computeObjective(beta, indexedPairs, lambda);

  // 6. Build project strengths
  const strengths: BradleyTerryProjectStrength[] = [];
  for (let i = 0; i < n; i++) {
    const rawBeta = beta[i]!;
    const canonicalStrength = canonicalRoundHalfUp(
      rawBeta,
      FROZEN_PAIRWISE_CONFIG.canonicalScale,
    );
    strengths.push({
      projectId: sortedProjectIds[i]!,
      beta: rawBeta,
      canonicalStrength,
      canonicalStrengthStr: formatCanonicalDecimalStr(
        rawBeta,
        FROZEN_PAIRWISE_CONFIG.canonicalScale,
      ),
      wins: wins[i]!,
      losses: losses[i]!,
    });
  }

  // 7. Assign competition ranks
  const ranks = assignCompetitionRanks(strengths);

  return {
    algorithm: FROZEN_PAIRWISE_CONFIG.algorithm,
    algorithmVersion: FROZEN_PAIRWISE_CONFIG.algorithmVersion,
    lambda,
    connected: true,
    componentCount: 1,
    components,
    stronglyConnectedWinGraph,
    regularizationSensitive,
    separationRisk,
    converged,
    iterations,
    finalDelta,
    finalObjective,
    projectCount: n,
    comparisonCount: input.comparisons.length,
    strengths,
    ranks,
  };
}

/**
 * Deterministic input set hash for pairwise evidence.
 */
export function computePairwiseInputSetHash(params: {
  pairwiseRunId: string;
  algorithm?: string;
  algorithmVersion?: string;
  lambda?: number | string;
  comparisons: Array<{
    id: string;
    winnerProjectId: string;
    loserProjectId: string;
  }>;
}): string {
  const sortedComparisons = [...params.comparisons].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const lambdaVal =
    params.lambda !== undefined
      ? Number(params.lambda).toFixed(6)
      : FROZEN_PAIRWISE_CONFIG.lambda.toFixed(6);

  const payload = {
    pairwiseRunId: params.pairwiseRunId,
    algorithm: params.algorithm ?? FROZEN_PAIRWISE_CONFIG.algorithm,
    algorithmVersion:
      params.algorithmVersion ?? FROZEN_PAIRWISE_CONFIG.algorithmVersion,
    lambda: lambdaVal,
    comparisons: sortedComparisons.map((c) => ({
      id: c.id,
      winner: c.winnerProjectId,
      loser: c.loserProjectId,
    })),
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
