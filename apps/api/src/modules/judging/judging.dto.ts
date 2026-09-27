import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class JudgeInviteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() invitedUserId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  expiresInHours?: number;
}
export class JudgeInviteTokenDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
}
export class JudgeProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) maxAssignments?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() available?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organization?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  trackIds?: string[];
}
export class ConflictDto {
  @ApiProperty() @IsUUID() judgeProfileId!: string;
  @ApiProperty() @IsIn(['TEAM', 'PROJECT']) type!: 'TEAM' | 'PROJECT';
  @ApiProperty() @IsUUID() targetId!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
export class CriterionDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
  @ApiProperty({ description: 'Exact decimal fraction, e.g. 0.4' })
  @IsString()
  @Matches(/^(?:0(?:\.\d{1,9})?|1(?:\.0{1,9})?)$/)
  weight!: string;
  @ApiProperty()
  @IsString()
  @Matches(/^-?\d{1,8}(?:\.\d{1,4})?$/)
  minScore!: string;
  @ApiProperty()
  @IsString()
  @Matches(/^-?\d{1,8}(?:\.\d{1,4})?$/)
  maxScore!: string;
}
export class RubricDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiProperty({ type: [CriterionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CriterionDto)
  criteria!: CriterionDto[];
}

export class ManualAssignmentDto {
  @ApiProperty() @IsUUID() judgeProfileId!: string;
  @ApiProperty() @IsUUID() submissionId!: string;
  @ApiProperty() @IsUUID() rubricId!: string;
}

export class BatchPreviewDto {
  @ApiProperty() @IsUUID() rubricId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(20) reviewsPerSubmission!: number;
}
export class PublishPreviewDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acknowledgeOpenSubmissions?: boolean;
}

export class EvaluationScoreDto {
  @ApiProperty() @IsUUID() criterionId!: string;
  @ApiProperty()
  @IsString()
  @Matches(/^-?\d{1,8}(?:\.\d{1,4})?$/)
  score!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class EvaluationDto {
  @ApiPropertyOptional({ type: [EvaluationScoreDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvaluationScoreDto)
  scores?: EvaluationScoreDto[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  comments?: string;
}

export class CreateScoreRunDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  rubricVersionId?: string;
}

export class CreateResultRunDto {
  @ApiProperty()
  @IsUUID()
  scoreRunId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  confirmIncomplete?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  overrideReason?: string;
}
