import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches, MinLength, MaxLength } from 'class-validator';
import { WorkspacesService } from './workspaces.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../common/decorators/current-user.decorator';

export class CreateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug must be lowercase alphanumeric with hyphens only.',
  })
  @MaxLength(30)
  slug: string;
}

@ApiTags('workspaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new workspace' })
  async create(
    @Body() dto: CreateWorkspaceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspacesService.create({
      name: dto.name,
      slug: dto.slug,
      ownerId: user.sub,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get workspace by ID' })
  @ApiResponse({ status: 403, description: 'Access denied — tenant isolation.' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspacesService.findById(id, user.sub);
  }

  @Get(':id/usage')
  @ApiOperation({ summary: 'Get current report usage vs plan limit' })
  async getUsage(@Param('id') id: string) {
    return this.workspacesService.checkReportLimit(id);
  }
}
