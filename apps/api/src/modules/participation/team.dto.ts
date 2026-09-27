import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
export class CreateTeamDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiProperty()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(80)
  slug!: string;
}
export class UpdateTeamDto {
  @ApiPropertyOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}
export class InviteDto {
  @ApiProperty() @IsEmail() @MaxLength(320) email!: string;
}
export class InvitationTokenDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
}
