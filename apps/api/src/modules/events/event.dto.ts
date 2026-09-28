import { EventVisibility, GalleryVisibility } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
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
  ValidateIf,
} from 'class-validator';
export class EmbedOriginsDto {
  @ApiProperty({ type: [String], description: 'Exact HTTP(S) web origins' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  allowedOrigins!: string[];
}
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export class EventConfigurationDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(300)
  shortDescription?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(10000)
  description?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(10000)
  rules?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(10000)
  eligibility?: string;
  @ApiPropertyOptional({ example: 'UTC' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(80)
  timezone?: string;
  @ApiPropertyOptional({ enum: EventVisibility })
  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(EventVisibility)
  visibility?: EventVisibility;
  @ApiPropertyOptional({ enum: GalleryVisibility })
  @ValidateIf((_, v) => v !== undefined)
  @IsEnum(GalleryVisibility)
  galleryVisibility?: GalleryVisibility;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  minTeamSize?: number;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxTeamSize?: number;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  registrationOpensAt?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  registrationClosesAt?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  submissionOpensAt?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  submissionClosesAt?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  judgingOpensAt?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  judgingClosesAt?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  votingOpensAt?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  votingClosesAt?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  resultsPublishAt?: string | null;
}
export class CreateEventDto extends EventConfigurationDto {
  @ApiProperty()
  @IsString()
  @Matches(slugPattern)
  @MaxLength(80)
  slug!: string;
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  declare name: string;
}
export class UpdateEventDto extends EventConfigurationDto {}
export class TrackDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiProperty() @IsString() @Matches(slugPattern) @MaxLength(80) slug!: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000000)
  maxSubmissions?: number;
}
export class UpdateTrackDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  maxSubmissions?: number | null;
}
export class PrizeDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, v) => v !== undefined)
  @IsUUID()
  trackId?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(1000000)
  position?: number;
  @ApiPropertyOptional({ example: '1000.00' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/)
  amount?: string;
  @ApiPropertyOptional({ example: 'USD' })
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;
}
export class UpdatePrizeDto {
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
  @ApiPropertyOptional()
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  trackId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  position?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/)
  amount?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string | null;
}
