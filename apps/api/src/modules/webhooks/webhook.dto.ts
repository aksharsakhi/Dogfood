import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateWebhookDto {
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: true })
  url!: string;

  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(/^(\*|[a-z][a-z0-9.]{1,99})$/, { each: true })
  eventTypes!: string[];
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: true })
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @Matches(/^(\*|[a-z][a-z0-9.]{1,99})$/, { each: true })
  eventTypes?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class WebhookDeliveryQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(36)
  cursor?: string;
}
