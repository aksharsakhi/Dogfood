import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionPrincipal } from '@dogfood/shared';
import { CurrentPrincipal } from '../../common/auth/current-principal';
import { SessionAuthGuard } from '../../common/auth/session-auth.guard';
import { AuthService, SESSION_COOKIE, SESSION_SECONDS } from './auth.service';
import { LoginDto, RegisterDto } from './auth.dto';
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Post('register') register(@Body() body: RegisterDto) {
    return this.auth.register(body);
  }
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.login(body, request.headers['user-agent']);
    reply.setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_SECONDS,
    });
    return result.user;
  }
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.auth.logout(request);
    reply.clearCookie(SESSION_COOKIE, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
  @Get('me')
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  me(@CurrentPrincipal() principal: SessionPrincipal) {
    return this.auth.me(principal.userId);
  }
}
