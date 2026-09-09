# Deploy: Static Site + API no Render

O frontend agora gera arquivos estáticos em `frontend/out`. O backend permanece NestJS no Web Service e o banco permanece no Supabase.

## Migrar o frontend existente

1. No Render, crie **New > Static Site** usando o repositório `josineivieira/grupogeo`, branch `main`.
2. Nome sugerido: `geo-rh-site`. Deixe Root Directory vazio.
3. Build Command: `npm ci --include=dev && npm run build -w frontend`.
4. Publish Directory: `frontend/out`. Não existe Start Command no Static Site.
5. Variáveis: NODE_VERSION=24.19.0, NODE_ENV=production, NEXT_PUBLIC_API_URL=/api.
6. Cadastre em Redirects/Rewrites, nesta ordem:

| Source | Destination | Action |
| --- | --- | --- |
| /api/* | https://geo-rh-api.onrender.com/api/* | Rewrite |
| /* | /index.html | Rewrite |

Use Rewrite, não Redirect. A primeira regra encaminha a API mantendo cookies no domínio do site; a segunda permite abrir e atualizar rotas como `/employees/UUID`.
API_INTERNAL_URL não é mais utilizada. Se a URL real da API for diferente, ajuste a primeira regra.

## Backend

Mantenha o Web Service `geo-rh-api` e selecione Compute pago no painel para evitar suspensão por inatividade. Confira o custo antes de confirmar.

- Build: `npm ci --include=dev && npm run db:generate && npm run build -w backend`
- Pre-Deploy (serviço pago): `npm run db:migrate`
- Start: `npm run start -w backend`
- Health Check: `/api/healthz`

Mantenha DATABASE_URL, DIRECT_URL, JWT_SECRET e DATA_ENCRYPTION_KEY existentes. Não recrie o banco nem execute seed para esta migração.
Altere CORS_ORIGIN e WEB_URL para a URL HTTPS real do NOVO Static Site, sem barra final. Mantenha COOKIE_SECURE=true.
Essas duas variáveis precisam acompanhar a mudança de domínio para a renovação da sessão funcionar.
Para anexos, use disco persistente montado em /var/data/uploads e UPLOAD_DIR=/var/data/uploads. O banco não guarda os arquivos físicos.

## Validar antes de desativar o frontend antigo

1. Abra a URL do novo site seguida de `/api/healthz`: deve retornar JSON com status ready, não a página HTML.
2. Entre com seu usuário existente. Troque a senha se o sistema solicitar.
3. Abra funcionários e uma ficha, atualize a página e use voltar/avançar do navegador.
4. Atualize a página após entrar e confirme a recuperação da sessão.
5. Confira um upload e download.
6. Só após validar, suspenda/exclua o Web Service antigo `geo-rh-web` pelo painel, para deixar apenas a API como servidor pago. O agente não excluiu esse serviço.

O render.yaml descreve API paga e um novo Static Site chamado geo-rh-site. Não converte automaticamente o Web Service antigo. Se a API já for gerenciada por Blueprint, revise as alterações antes de sincronizar.
Esta mudança reduz servidores e evita remontar a aplicação a cada navegação; não garante resolver lentidão de consultas ao banco.

## Desenvolvimento

`npm run dev:web` inicia o Next para desenvolvimento na raiz `/`; navegação interna usa History API. Para validar acesso direto a rotas profundas, utilize o export com fallback SPA ou Docker.
O Docker do frontend serve os arquivos com Nginx e fallback para index.html.

Referências: https://render.com/docs/static-sites e https://render.com/docs/redirects-rewrites.
