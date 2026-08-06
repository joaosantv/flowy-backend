# Flowy Backend

## Configuração

1. Copie `.env.example` para `.env` e preencha todas as variáveis.
2. Instale as dependências: `npm install`.
3. Aplique o schema: `npm run db:push`.
4. Se o banco já tiver usuários criados antes desta atualização, converta as senhas antigas uma única vez: `npm run migrate-passwords`.
5. Inicie a API: `npm start`.

O backend exige `JWT_SECRET` e envia os códigos de cadastro/recuperação por e-mail usando as variáveis `EMAIL_*`. Em produção, defina `FRONTEND_ORIGIN` com o domínio exato do frontend (ou domínios separados por vírgula).

Para desenvolvimento com Live Server, use `FRONTEND_ORIGIN="http://127.0.0.1:5500,http://localhost:5500"`.
