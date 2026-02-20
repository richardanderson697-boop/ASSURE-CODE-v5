import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { AuthService } from './auth.service';
import { Public } from '../common/guards/jwt-auth.guard';

export class ExchangeTokenDto {
  @IsString()
  @IsNotEmpty()
  supabaseAccessToken: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange Supabase token for Assure Code JWT',
    description:
      'After signing in via Supabase Auth on the client, exchange the Supabase access token for an Assure Code JWT that includes workspaceId and plan tier.',
  })
  @ApiResponse({ status: 200, description: 'JWT issued successfully.' })
  @ApiResponse({ status: 401, description: 'Invalid Supabase token.' })
  async exchangeToken(@Body() dto: ExchangeTokenDto) {
    return this.authService.exchangeToken(dto.supabaseAccessToken);
  }
}
