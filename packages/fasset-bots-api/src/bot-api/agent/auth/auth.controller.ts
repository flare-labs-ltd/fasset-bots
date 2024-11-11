import { Controller, Post, Body, UseInterceptors, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ErrorStatusInterceptor } from '../interceptors/error.status.interceptor';
import { ApiResponseWrapper, handleApiResponse } from '../../common/ApiResponse';
import { PasswordDTO } from '../../common/AgentSettingsDTO';
import { AuthService } from './auth.service';

@ApiTags("Auth")
@Controller('api/auth')
@UseInterceptors(ErrorStatusInterceptor)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  public async create(
    @Body() password: PasswordDTO
  ): Promise<ApiResponseWrapper<string>> {
    return handleApiResponse(this.authService.login(password.password));
  }
}
