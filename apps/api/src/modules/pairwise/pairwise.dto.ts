import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';

export class PairwisePublishDto {
  @ApiProperty({ description: 'SHA-256 proposal hash returned by preview' })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  proposalHash!: string;
}

export class PairwiseSubmitDto {
  @ApiProperty()
  @IsUUID()
  winnerProjectId!: string;
}
