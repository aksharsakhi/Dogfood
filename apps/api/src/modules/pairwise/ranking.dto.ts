import { ApiProperty } from '@nestjs/swagger';

export class PairwiseProjectResultDto {
  @ApiProperty({ format: 'uuid' }) projectId!: string;
  @ApiProperty() projectName!: string;
  @ApiProperty({ format: 'uuid' }) submissionId!: string;
  @ApiProperty({
    minimum: 1,
    description:
      'Competition rank; canonical ties retain equal rank (1, 1, 3).',
  })
  rank!: number;
  @ApiProperty({ description: 'Decimal string, stored at 8 decimal places.' })
  strength!: string;
  @ApiProperty({
    example: '1.234567',
    description: 'Canonical strength formatted to exactly six decimal places.',
  })
  canonicalStrength!: string;
  @ApiProperty() wins!: number;
  @ApiProperty() losses!: number;
}
export class PairwiseRankingDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) rankingRunId!: string;
  @ApiProperty({ format: 'uuid' }) pairwiseRunId!: string;
  @ApiProperty({ enum: ['BRADLEY_TERRY_RIDGE'] }) algorithm!: string;
  @ApiProperty({ enum: ['V1'] }) algorithmVersion!: string;
  @ApiProperty({ enum: ['0.01'] }) lambda!: string;
  @ApiProperty() inputSetHash!: string;
  @ApiProperty() comparisonCount!: number;
  @ApiProperty() currentComparisonCount!: number;
  @ApiProperty() projectCount!: number;
  @ApiProperty() componentCount!: number;
  @ApiProperty() converged!: boolean;
  @ApiProperty() iterations!: number;
  @ApiProperty() finalDelta!: string;
  @ApiProperty() stronglyConnectedWinGraph!: boolean;
  @ApiProperty() separationRisk!: boolean;
  @ApiProperty() regularizationSensitive!: boolean;
  @ApiProperty() stale!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [PairwiseProjectResultDto] })
  results!: PairwiseProjectResultDto[];
}
