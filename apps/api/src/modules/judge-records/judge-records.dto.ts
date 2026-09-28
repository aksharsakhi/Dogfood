import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class IssueJudgeRecordDto {
  @ApiPropertyOptional({
    description: 'Issue a correction linked to this earlier record.',
  })
  @IsOptional()
  @IsUUID()
  supersedesRecordId?: string;
}
