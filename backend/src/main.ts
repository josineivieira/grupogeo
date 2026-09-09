import 'reflect-metadata';
import 'dotenv/config';
import { Module, Get, Controller } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Database, ApiErrors, ok } from './core';
import { AuthController, AuthGuard, Public, jwtSecret } from './auth';
import { CatalogController, CatalogService } from './catalog';
import { EmployeeController, EmployeeService } from './employees';
import { VacationController, VacationService } from './vacations';
import { WorkflowController, LeaveController } from './workflows';
import { AdminController } from './admin';
import { FileController } from './files';
import { ReportsController } from './reports';
import { ScheduledJobs } from './jobs';
import { ImportController } from './imports';
import { AddressController } from './addresses';
import { AssetController } from './assets';
@Controller('healthz')
class HealthController {
  constructor(private readonly db: Database) {}
  @Get() @Public() async get() {
    await this.db.$queryRaw`SELECT 1`;
    return ok({ status: 'ready' });
  }
}
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 180 }])],
  controllers: [
    HealthController,
    AuthController,
    CatalogController,
    EmployeeController,
    VacationController,
    WorkflowController,
    LeaveController,
    AdminController,
    FileController,
    ReportsController,
    ImportController,
    AddressController,
    AssetController,
  ],
  providers: [
    Database,
    CatalogService,
    EmployeeService,
    VacationService,
    ScheduledJobs,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
async function bootstrap() {
  jwtSecret();
  if (!process.env.CORS_ORIGIN) throw new Error('Configure CORS_ORIGIN.');
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiErrors());
  app.enableShutdownHooks();
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('GEO RH API')
      .setDescription(
        'API de gestão de pessoas. JWT, RBAC e escopo organizacional são verificados no servidor.',
      )
      .setVersion('1.0.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, doc);
  await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
}
if (require.main === module) void bootstrap();
