import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
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
import { Type } from 'class-transformer';

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const url = /^https?:\/\/.+/i;

export class CreateProjectDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() teamId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiProperty() @IsString() @Matches(slug) @MaxLength(80) slug!: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  trackId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  tagline?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(url)
  @MaxLength(2048)
  repositoryUrl?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(url)
  @MaxLength(2048)
  demoUrl?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  trackId?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  tagline?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(url)
  @MaxLength(2048)
  repositoryUrl?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(url)
  @MaxLength(2048)
  demoUrl?: string | null;
}

export class DraftDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  description!: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(url)
  @MaxLength(2048)
  repositoryUrl?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(url)
  @MaxLength(2048)
  demoUrl?: string | null;
}

export class UpdateDraftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  description?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(url)
  @MaxLength(2048)
  repositoryUrl?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(url)
  @MaxLength(2048)
  demoUrl?: string | null;
}

export class GalleryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  trackId?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 12, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 12;
}
