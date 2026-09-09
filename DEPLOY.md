# Render + Supabase

O `render.yaml` cria dois Web Services Node: API NestJS e frontend Next.js.
Os dois usam computação paga; a API também usa um disco de 1 GB para anexos e fotos.
Revise o custo exibido pelo Render antes de confirmar a criação.
O PostgreSQL fica no Supabase. O projeto usa autenticação própria, sem Supabase Auth.

## 1. Banco

No projeto Supabase, abra **Connect** e copie as conexões dos poolers:

- `DATABASE_URL`: Transaction pooler, porta 6543. Acrescente `?pgbouncer=true&connection_limit=1&sslmode=require`.
- `DIRECT_URL`: Session pooler, porta 5432. Acrescente `?sslmode=require`.

Use o host e o usuário exatos fornecidos pelo painel. Substitua o marcador de senha
pela senha do banco, sem os colchetes. Caracteres especiais da senha precisam de
codificação URL. Se a URL já tiver parâmetros, acrescente os novos com `&`.
O Session pooler permite executar as migrations por IPv4.
Prefira um projeto vazio: as migrations criam as tabelas no schema public.
Se houver dados/tabelas preexistentes, revise a compatibilidade antes do deploy.
Como o acesso é feito exclusivamente pelo backend via Prisma, desative a Data API
nas configurações do Supabase se não a utiliza em outra integração.

## 2. Publicar o código

Envie este projeto para um repositório GitHub/GitLab/Bitbucket, incluindo
`render.yaml`, `package-lock.json` e `backend/prisma/migrations`.
Não envie `.env`, `node_modules`, `.local` ou uploads.
No Render, selecione **New > Blueprint**, conecte o repositório e revise os serviços.
Mantenha Root Directory vazio: os comandos usam os workspaces da raiz.

Preencha as variáveis solicitadas:

| Serviço | Variável | Valor |
| --- | --- | --- |
| API | DATABASE_URL | Transaction pooler do Supabase |
| API | DIRECT_URL | Session pooler do Supabase |
| API | DATA_ENCRYPTION_KEY | Chave aleatória de 64 caracteres hexadecimais |
| API | CORS_ORIGIN | URL HTTPS do frontend, sem barra final |
| API | WEB_URL | Mesma URL do frontend |
| Frontend | API_INTERNAL_URL | URL HTTPS da API, sem `/api` e sem barra final |

Para gerar DATA_ENCRYPTION_KEY no seu computador:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guarde essa chave: alterá-la impede a leitura dos dados já criptografados.
Se estiver migrando um banco existente, preserve sua DATA_ENCRYPTION_KEY atual.
JWT_SECRET é gerado pelo Render. PORT é fornecida automaticamente.
Não coloque credenciais do banco em variáveis NEXT_PUBLIC_*.

Os nomes dos serviços não garantem o endereço final. Se ainda não tiver as URLs,
preencha as previstas e, após criar os serviços, copie as URLs reais exibidas no
Render e corrija CORS_ORIGIN, WEB_URL e API_INTERNAL_URL. Faça novo deploy do frontend
após mudar API_INTERNAL_URL: o Next.js grava os rewrites durante o build.
NEXT_PUBLIC_API_URL deve permanecer `/api`, para os cookies funcionarem no domínio
do frontend. O Next.js encaminha essas requisições à API.

## 3. Primeiro acesso

As migrations são aplicadas automaticamente no pre-deploy da API. Não execute
`migrate reset` ou `db push` no banco de produção.

Depois do primeiro deploy, adicione temporariamente à API:

- `SEED_ADMIN_EMAIL`: seu e-mail de administrador.
- `SEED_ADMIN_PASSWORD`: senha inicial exclusiva com pelo menos 12 caracteres.

No **Shell** da API Render, a partir da raiz do projeto, execute uma vez:

```sh
npm run db:seed
```

Esse comando inicializa permissões, ambientes, configurações e o administrador.
Também ativa acesso ao ambiente RH para usuários existentes; use-o na inicialização
de um banco novo, não automaticamente a cada deploy. Não altera a senha de um
administrador que já existe. Remova as duas variáveis depois da inicialização.
Entre pelo frontend e troque a senha no primeiro acesso.

## 4. Conferência

1. Abra `https://URL-DA-API/api/healthz` e confirme status `ready`.
2. Abra `https://URL-DO-FRONTEND/api/healthz` para conferir o encaminhamento.
3. Entre no sistema, recarregue a página e confirme que continua autenticado.
4. Envie um anexo, reinicie a API e confirme que ainda consegue baixá-lo.

Recuperação de senha exige configurar na API SMTP_HOST, SMTP_PORT, SMTP_USER,
SMTP_PASSWORD e SMTP_FROM, além de WEB_URL.
O disco persiste arquivos apenas em `/var/data/uploads`; este projeto ainda não
usa Supabase Storage. Faça backup do banco e dos arquivos separadamente.

Referências: [Render Blueprint](https://render.com/docs/blueprint-spec),
[discos persistentes](https://render.com/docs/disks),
[conexões Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres),
[rewrites Next.js](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites).
