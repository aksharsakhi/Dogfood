import { VotingAccessMode } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class VoterDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsEmail()
  @MaxLength(320)
  email?: string;
}

export class CastVoteDto extends VoterDto {
  @IsUUID()
  projectId!: string;
}

export class PostCommentDto extends VoterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

export class VotingConfigDto {
  @IsOptional()
  @IsEnum(VotingAccessMode)
  accessMode?: VotingAccessMode;

  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  votingOpensAt?: string;

  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  votingClosesAt?: string;
}

export class VotingAuditQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class CommentPageQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
