import {
  fitBradleyTerryRidgeV1,
  computePairwiseInputSetHash,
  canonicalRoundHalfUp,
  formatCanonicalDecimalStr,
  assignCompetitionRanks,
  PairwiseComparisonInput,
} from '../src/modules/pairwise/bradley-terry';

describe('Phase B4.1 — Bradley-Terry Ridge V1 Mathematical Proofs', () => {
  describe('1. CLEAR ORDER', () => {
    it('ranks A > B > C with exact ordering and deterministic outputs', () => {
      // A beats B 4 times
      // A beats C 3 times
      // B beats C 3 times
      const comparisons: PairwiseComparisonInput[] = [
        ...Array(4).fill({
          winnerProjectId: 'project-A',
          loserProjectId: 'project-B',
        }),
        ...Array(3).fill({
          winnerProjectId: 'project-A',
          loserProjectId: 'project-C',
        }),
        ...Array(3).fill({
          winnerProjectId: 'project-B',
          loserProjectId: 'project-C',
        }),
      ];

      const result = fitBradleyTerryRidgeV1({
        projectIds: ['project-A', 'project-B', 'project-C'],
        comparisons,
      });

      expect(result.connected).toBe(true);
      expect(result.componentCount).toBe(1);
      expect(result.converged).toBe(true);
      expect(result.ranks).toHaveLength(3);

      expect(result.ranks[0]!.projectId).toBe('project-A');
      expect(result.ranks[0]!.rank).toBe(1);

      expect(result.ranks[1]!.projectId).toBe('project-B');
      expect(result.ranks[1]!.rank).toBe(2);

      expect(result.ranks[2]!.projectId).toBe('project-C');
      expect(result.ranks[2]!.rank).toBe(3);

      // Verify strengths are strictly decreasing
      expect(result.ranks[0]!.canonicalStrength).toBeGreaterThan(
        result.ranks[1]!.canonicalStrength,
      );
      expect(result.ranks[1]!.canonicalStrength).toBeGreaterThan(
        result.ranks[2]!.canonicalStrength,
      );

      // Check sum to zero gauge
      const sumBeta = result.strengths.reduce((s, p) => s + p.beta, 0);
      expect(Math.abs(sumBeta)).toBeLessThan(1e-7);

      // Verify finite and numbers
      for (const p of result.ranks) {
        expect(Number.isFinite(p.beta)).toBe(true);
        expect(Number.isFinite(p.canonicalStrength)).toBe(true);
      }
    });
  });

  describe('2. SEPARATED CHAIN', () => {
    it('recovers finite strengths for A > B > C > D without strong connectivity', () => {
      // A > B, B > C, C > D (pure chain, completely separated, unregularized BT diverges)
      const comparisons: PairwiseComparisonInput[] = [
        { winnerProjectId: 'project-A', loserProjectId: 'project-B' },
        { winnerProjectId: 'project-B', loserProjectId: 'project-C' },
        { winnerProjectId: 'project-C', loserProjectId: 'project-D' },
      ];

      const result = fitBradleyTerryRidgeV1({
        projectIds: ['project-A', 'project-B', 'project-C', 'project-D'],
        comparisons,
      });

      expect(result.connected).toBe(true);
      expect(result.componentCount).toBe(1);
      expect(result.converged).toBe(true);

      // Diagnostic asserts: directed win graph is NOT strongly connected, so separationRisk is true
      expect(result.stronglyConnectedWinGraph).toBe(false);
      expect(result.separationRisk).toBe(true);
      expect(result.regularizationSensitive).toBe(true);

      // Order must be strictly A > B > C > D
      expect(result.ranks.map((r) => r.projectId)).toEqual([
        'project-A',
        'project-B',
        'project-C',
        'project-D',
      ]);
      expect(result.ranks.map((r) => r.rank)).toEqual([1, 2, 3, 4]);

      // All values must be finite and strictly decreasing
      for (let i = 0; i < result.ranks.length; i++) {
        const item = result.ranks[i]!;
        expect(Number.isFinite(item.beta)).toBe(true);
        expect(Number.isNaN(item.beta)).toBe(false);
        if (i > 0) {
          expect(item.canonicalStrength).toBeLessThan(
            result.ranks[i - 1]!.canonicalStrength,
          );
        }
      }
    });
  });

  describe('3. CYCLE', () => {
    it('converges with symmetric canonical strengths and 1,1,1 tie ranking', () => {
      // A > B, B > C, C > A (perfectly symmetric 3-cycle)
      const comparisons: PairwiseComparisonInput[] = [
        { winnerProjectId: 'project-A', loserProjectId: 'project-B' },
        { winnerProjectId: 'project-B', loserProjectId: 'project-C' },
        { winnerProjectId: 'project-C', loserProjectId: 'project-A' },
      ];

      const result = fitBradleyTerryRidgeV1({
        projectIds: ['project-A', 'project-B', 'project-C'],
        comparisons,
      });

      expect(result.connected).toBe(true);
      expect(result.componentCount).toBe(1);
      expect(result.converged).toBe(true);
      expect(result.stronglyConnectedWinGraph).toBe(true);
      expect(result.separationRisk).toBe(false);

      // By symmetry, all strengths are 0.000000
      for (const p of result.ranks) {
        expect(p.canonicalStrength).toBe(0);
        expect(p.canonicalStrengthStr).toBe('0.000000');
        expect(p.rank).toBe(1);
      }
    });
  });

  describe('4. LABEL / DISPLAY ORDER INVARIANCE', () => {
    it('produces identical strengths regardless of comparison list ordering', () => {
      const comparisonsForward: PairwiseComparisonInput[] = [
        { winnerProjectId: 'project-A', loserProjectId: 'project-B' },
        { winnerProjectId: 'project-A', loserProjectId: 'project-C' },
        { winnerProjectId: 'project-B', loserProjectId: 'project-C' },
      ];

      const comparisonsShuffled: PairwiseComparisonInput[] = [
        { winnerProjectId: 'project-B', loserProjectId: 'project-C' },
        { winnerProjectId: 'project-A', loserProjectId: 'project-C' },
        { winnerProjectId: 'project-A', loserProjectId: 'project-B' },
      ];

      const projectIdsForward = ['project-A', 'project-B', 'project-C'];
      const projectIdsReversed = ['project-C', 'project-B', 'project-A'];

      const res1 = fitBradleyTerryRidgeV1({
        projectIds: projectIdsForward,
        comparisons: comparisonsForward,
      });

      const res2 = fitBradleyTerryRidgeV1({
        projectIds: projectIdsReversed,
        comparisons: comparisonsShuffled,
      });

      expect(res1.converged).toBe(true);
      expect(res2.converged).toBe(true);

      for (let i = 0; i < 3; i++) {
        expect(res1.ranks[i]!.projectId).toBe(res2.ranks[i]!.projectId);
        expect(res1.ranks[i]!.canonicalStrengthStr).toBe(
          res2.ranks[i]!.canonicalStrengthStr,
        );
        expect(res1.ranks[i]!.rank).toBe(res2.ranks[i]!.rank);
      }
    });
  });

  describe('5. DETERMINISM', () => {
    it('produces bit-for-bit identical outputs across multiple invocations', () => {
      const comparisons: PairwiseComparisonInput[] = [
        { winnerProjectId: 'P1', loserProjectId: 'P2' },
        { winnerProjectId: 'P1', loserProjectId: 'P3' },
        { winnerProjectId: 'P2', loserProjectId: 'P4' },
        { winnerProjectId: 'P3', loserProjectId: 'P4' },
      ];

      const run1 = fitBradleyTerryRidgeV1({
        projectIds: ['P1', 'P2', 'P3', 'P4'],
        comparisons,
      });

      const run2 = fitBradleyTerryRidgeV1({
        projectIds: ['P1', 'P2', 'P3', 'P4'],
        comparisons,
      });

      expect(run1.finalObjective).toBe(run2.finalObjective);
      expect(run1.finalDelta).toBe(run2.finalDelta);
      expect(run1.iterations).toBe(run2.iterations);

      for (let i = 0; i < 4; i++) {
        expect(run1.ranks[i]!.projectId).toBe(run2.ranks[i]!.projectId);
        expect(run1.ranks[i]!.beta).toBe(run2.ranks[i]!.beta);
        expect(run1.ranks[i]!.canonicalStrength).toBe(
          run2.ranks[i]!.canonicalStrength,
        );
        expect(run1.ranks[i]!.rank).toBe(run2.ranks[i]!.rank);
      }
    });
  });

  describe('6. DISCONNECTED GRAPH', () => {
    it('detects multiple connected components and refuses global ranking', () => {
      // Subgraph 1: A > B
      // Subgraph 2: C > D
      const comparisons: PairwiseComparisonInput[] = [
        { winnerProjectId: 'project-A', loserProjectId: 'project-B' },
        { winnerProjectId: 'project-C', loserProjectId: 'project-D' },
      ];

      const result = fitBradleyTerryRidgeV1({
        projectIds: ['project-A', 'project-B', 'project-C', 'project-D'],
        comparisons,
      });

      expect(result.connected).toBe(false);
      expect(result.componentCount).toBe(2);
      expect(result.components).toEqual([
        ['project-A', 'project-B'],
        ['project-C', 'project-D'],
      ]);
      expect(result.converged).toBe(false);
      expect(result.ranks).toHaveLength(0);
      expect(result.strengths).toHaveLength(0);
    });
  });

  describe('7. RIDGE FINITENESS', () => {
    it('handles extreme repeated one-sided dominance without overflow or NaN', () => {
      // A beats B 100 times with zero reverse wins
      const comparisons: PairwiseComparisonInput[] = Array(100).fill({
        winnerProjectId: 'project-A',
        loserProjectId: 'project-B',
      });

      const result = fitBradleyTerryRidgeV1({
        projectIds: ['project-A', 'project-B'],
        comparisons,
      });

      expect(result.connected).toBe(true);
      expect(result.componentCount).toBe(1);
      expect(result.converged).toBe(true);

      for (const p of result.ranks) {
        expect(Number.isFinite(p.beta)).toBe(true);
        expect(Number.isNaN(p.beta)).toBe(false);
        expect(Math.abs(p.beta)).toBeLessThan(100); // Ridge bounds the parameters
      }

      expect(result.ranks[0]!.projectId).toBe('project-A');
      expect(result.ranks[0]!.rank).toBe(1);
      expect(result.ranks[1]!.projectId).toBe('project-B');
      expect(result.ranks[1]!.rank).toBe(2);
    });
  });

  describe('8. CANONICAL TIE RANKING', () => {
    it('applies 1, 1, 3 competition ranking for tied canonical strengths', () => {
      const strengths = [
        {
          projectId: 'P1',
          beta: 1.2500001,
          canonicalStrength: 1.25,
          canonicalStrengthStr: '1.250000',
          wins: 3,
          losses: 1,
        },
        {
          projectId: 'P2',
          beta: 1.2500004,
          canonicalStrength: 1.25,
          canonicalStrengthStr: '1.250000',
          wins: 3,
          losses: 1,
        },
        {
          projectId: 'P3',
          beta: -0.5,
          canonicalStrength: -0.5,
          canonicalStrengthStr: '-0.500000',
          wins: 1,
          losses: 3,
        },
      ];

      const ranked = assignCompetitionRanks(strengths);
      expect(ranked).toHaveLength(3);
      expect(ranked[0]!.rank).toBe(1);
      expect(ranked[1]!.rank).toBe(1);
      expect(ranked[2]!.rank).toBe(3); // 1, 1, 3 competition ranking

      // Direct rounding assertions
      expect(canonicalRoundHalfUp(1.2345674)).toBe(1.234567);
      expect(canonicalRoundHalfUp(1.2345675)).toBe(1.234568);
      expect(formatCanonicalDecimalStr(1.2345675)).toBe('1.234568');
    });
  });

  describe('9. INPUT SET HASH', () => {
    it('is deterministic and sensitive to any evidence mutation', () => {
      const comparisons = [
        { id: 'cmp-1', winnerProjectId: 'pA', loserProjectId: 'pB' },
        { id: 'cmp-2', winnerProjectId: 'pB', loserProjectId: 'pC' },
      ];

      const hash1 = computePairwiseInputSetHash({
        pairwiseRunId: 'run-123',
        comparisons,
      });

      // Same evidence in different comparison array order
      const hash2 = computePairwiseInputSetHash({
        pairwiseRunId: 'run-123',
        comparisons: [comparisons[1]!, comparisons[0]!],
      });
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);

      // Mutated winner/loser
      const hashFlipped = computePairwiseInputSetHash({
        pairwiseRunId: 'run-123',
        comparisons: [
          { id: 'cmp-1', winnerProjectId: 'pB', loserProjectId: 'pA' },
          comparisons[1]!,
        ],
      });
      expect(hashFlipped).not.toBe(hash1);

      // Different runId
      const hashDiffRun = computePairwiseInputSetHash({
        pairwiseRunId: 'run-999',
        comparisons,
      });
      expect(hashDiffRun).not.toBe(hash1);

      // Added comparison
      const hashAdded = computePairwiseInputSetHash({
        pairwiseRunId: 'run-123',
        comparisons: [
          ...comparisons,
          { id: 'cmp-3', winnerProjectId: 'pA', loserProjectId: 'pC' },
        ],
      });
      expect(hashAdded).not.toBe(hash1);
    });
  });

  describe('10. INDEPENDENT FIRST-ORDER STATIONARITY & MONOTONIC ASCENT', () => {
    it('numerically satisfies analytical first-order condition on 2-project fixture to tight tolerance', () => {
      // Analytical benchmark:
      // A beats B once, lambda = 0.01, sum(beta)=0 -> beta_A = -beta_B
      // dL/d(beta_A) = 2 * (1 - sigmoid(2 * beta_A)) - 2 * lambda * beta_A = 0
      // <=> 1 - sigmoid(2 * beta_A) = 0.01 * beta_A
      const result = fitBradleyTerryRidgeV1({
        projectIds: ['project-A', 'project-B'],
        comparisons: [
          { winnerProjectId: 'project-A', loserProjectId: 'project-B' },
        ],
        lambda: 0.01,
      });

      expect(result.converged).toBe(true);
      const betaA = result.ranks.find((r) => r.projectId === 'project-A')!.beta;
      const betaB = result.ranks.find((r) => r.projectId === 'project-B')!.beta;

      // sum(beta) = 0
      expect(Math.abs(betaA + betaB)).toBeLessThan(1e-10);

      // Verify analytical root: 1 - sigmoid(2*betaA) = 0.01 * betaA
      const diff = betaA - betaB; // 2 * betaA
      const sigmoidDiff = 1 / (1 + Math.exp(-diff));
      const residual = 1 - sigmoidDiff - 0.01 * betaA;

      expect(Math.abs(residual)).toBeLessThan(1e-7);

      // Verify gradient norm ||g|| < 1e-7
      const gA = 1 - sigmoidDiff - 0.01 * betaA;
      const gB = -(1 - sigmoidDiff) - 0.01 * betaB;
      const gradNorm = Math.sqrt(gA * gA + gB * gB);
      expect(gradNorm).toBeLessThan(1e-7);
    });

    it('gradient norm is near zero (< 1e-7) on converged multi-project fixtures', () => {
      const comparisons: PairwiseComparisonInput[] = [
        { winnerProjectId: 'P1', loserProjectId: 'P2' },
        { winnerProjectId: 'P2', loserProjectId: 'P3' },
        { winnerProjectId: 'P1', loserProjectId: 'P3' },
        { winnerProjectId: 'P3', loserProjectId: 'P4' },
      ];

      const result = fitBradleyTerryRidgeV1({
        projectIds: ['P1', 'P2', 'P3', 'P4'],
        comparisons,
        lambda: 0.01,
      });

      expect(result.converged).toBe(true);

      const betaMap = new Map(
        result.strengths.map((s) => [s.projectId, s.beta]),
      );
      const g = new Map<string, number>([
        ['P1', -0.01 * betaMap.get('P1')!],
        ['P2', -0.01 * betaMap.get('P2')!],
        ['P3', -0.01 * betaMap.get('P3')!],
        ['P4', -0.01 * betaMap.get('P4')!],
      ]);

      for (const cmp of comparisons) {
        const diff =
          betaMap.get(cmp.winnerProjectId)! - betaMap.get(cmp.loserProjectId)!;
        const p = 1 / (1 + Math.exp(-diff));
        g.set(cmp.winnerProjectId, g.get(cmp.winnerProjectId)! + (1 - p));
        g.set(cmp.loserProjectId, g.get(cmp.loserProjectId)! - (1 - p));
      }

      let sumSqGrad = 0;
      for (const val of g.values()) {
        sumSqGrad += val * val;
      }
      const gradNorm = Math.sqrt(sumSqGrad);
      expect(gradNorm).toBeLessThan(1e-7);
    });

    it('proves zero-mean gauge centering strictly maximizes or preserves the penalized objective', () => {
      // Mathematical property:
      // Likelihood sum_c ln sigma(beta_w - beta_l) is invariant under any constant shift beta + c.
      // Ridge penalty - (lambda/2) * sum_i beta_i^2 is strictly maximized when sum_i beta_i = 0,
      // because sum (beta_i - m)^2 = sum beta_i^2 - n*m^2 <= sum beta_i^2.
      // Therefore, centering by subtracting the mean can never decrease the penalized objective.
      const uncenteredBeta = [2.5, 1.2, -0.8, -0.5]; // sum != 0
      const n = uncenteredBeta.length;
      const lambda = 0.01;
      const mean = uncenteredBeta.reduce((a, b) => a + b, 0) / n;
      const centeredBeta = uncenteredBeta.map((b) => b - mean);

      const comparisons: PairwiseComparisonInput[] = [
        { winnerProjectId: '0', loserProjectId: '1' },
        { winnerProjectId: '1', loserProjectId: '2' },
        { winnerProjectId: '2', loserProjectId: '3' },
      ];

      function obj(b: number[]): number {
        let ll = 0;
        for (const c of comparisons) {
          const w = parseInt(c.winnerProjectId, 10);
          const l = parseInt(c.loserProjectId, 10);
          const diff = b[w]! - b[l]!;
          ll += -Math.log(1 + Math.exp(-diff));
        }
        let pen = 0;
        for (const val of b) pen += val * val;
        return ll - (lambda / 2) * pen;
      }

      const objUncentered = obj(uncenteredBeta);
      const objCentered = obj(centeredBeta);

      // Centered objective must be strictly greater than uncentered objective
      expect(objCentered).toBeGreaterThan(objUncentered);
      // The exact difference is (lambda / 2) * n * mean^2
      const expectedGain = (lambda / 2) * n * mean * mean;
      expect(Math.abs(objCentered - objUncentered - expectedGain)).toBeLessThan(
        1e-12,
      );
    });
  });
});
