import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { GalleryController, ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [IdentityModule],
  controllers: [ProjectsController, GalleryController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
