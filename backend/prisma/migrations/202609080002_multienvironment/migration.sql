CREATE TABLE "Environment" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Environment_code_key" ON "Environment"("code");
CREATE UNIQUE INDEX "Environment_slug_key" ON "Environment"("slug");

CREATE TABLE "UserEnvironmentAccess" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "environmentId" UUID NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserEnvironmentAccess_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserEnvironmentAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserEnvironmentAccess_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserEnvironmentAccess_userId_environmentId_key" ON "UserEnvironmentAccess"("userId", "environmentId");
CREATE INDEX "UserEnvironmentAccess_environmentId_isActive_idx" ON "UserEnvironmentAccess"("environmentId", "isActive");

CREATE TABLE "UserEnvironmentRole" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "environmentId" UUID NOT NULL,
  "roleId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserEnvironmentRole_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserEnvironmentRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserEnvironmentRole_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserEnvironmentRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserEnvironmentRole_userId_environmentId_roleId_key" ON "UserEnvironmentRole"("userId", "environmentId", "roleId");
CREATE INDEX "UserEnvironmentRole_userId_environmentId_idx" ON "UserEnvironmentRole"("userId", "environmentId");

ALTER TABLE "Session" ADD COLUMN "environmentId" UUID;
ALTER TABLE "Session" ADD CONSTRAINT "Session_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Session_environmentId_idx" ON "Session"("environmentId");

ALTER TABLE "AuditLog" ADD COLUMN "environmentId" UUID;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "AuditLog_environmentId_createdAt_idx" ON "AuditLog"("environmentId", "createdAt");

INSERT INTO "Environment" ("id", "code", "slug", "name", "description", "icon", "sortOrder", "updatedAt") VALUES
  ('10000000-0000-4000-8000-000000000001', 'GOVERNANCE', 'governanca', 'Governança Geo', 'Governança, riscos, compliance e processos.', 'ShieldCheck', 1, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000002', 'HR', 'rh', 'Recursos Humanos Geo', 'Gestão de pessoas e Recursos Humanos.', 'Users', 2, CURRENT_TIMESTAMP),
  ('10000000-0000-4000-8000-000000000003', 'MAINTENANCE', 'manutencao', 'Manutenção Geo', 'Gestão de ativos, equipamentos e manutenção.', 'Wrench', 3, CURRENT_TIMESTAMP);

INSERT INTO "UserEnvironmentAccess" ("id", "userId", "environmentId", "updatedAt")
SELECT gen_random_uuid(), u."id", e."id", CURRENT_TIMESTAMP
FROM "User" u CROSS JOIN "Environment" e WHERE e."code" = 'HR';

INSERT INTO "UserEnvironmentRole" ("id", "userId", "environmentId", "roleId")
SELECT gen_random_uuid(), ur."userId", e."id", ur."roleId"
FROM "UserRole" ur CROSS JOIN "Environment" e WHERE e."code" = 'HR';
