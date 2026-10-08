# SplitUai

Aplicação web para organizar despesas compartilhadas em grupos pequenos.

## Rodar localmente

Requer Node.js 22.12+ (ou 20.19+ para compatibilidade com o Vite atual).

```bash
npm ci
npm run dev
```

A autenticação por e-mail/senha está implementada e o acesso é somente por convite. Para testar o login localmente, configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` em um arquivo `.env.local` (não versionado). `.env.example` mostra os nomes das variáveis. A chave publicável/anon é feita para uso no cliente e depende das políticas RLS; nunca use chave `service_role`/secret no frontend.

### Configurar o ambiente local

1. No diretório do projeto, crie o arquivo local a partir do exemplo:

   ```powershell
   Copy-Item .env.example .env.local
   ```

2. No painel Supabase, confirme que está no projeto **SplitUai**, ref `yzxeyqutmvjmrglmpcbb`. Abra **Project Settings → API Keys** e copie a chave **Publishable**. A opção **Connect** também mostra URL e chave para o cliente.
3. Edite `.env.local` localmente e preencha `VITE_SUPABASE_PUBLISHABLE_KEY` com a chave. Mantenha `VITE_SUPABASE_URL` como `https://yzxeyqutmvjmrglmpcbb.supabase.co`.
4. Salve o arquivo e inicie ou reinicie `npm run dev`.

Exemplo de formato (a chave fica somente na sua máquina):

```dotenv
VITE_SUPABASE_URL=https://yzxeyqutmvjmrglmpcbb.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=cole_a_chave_publicavel_localmente
```

`.env.local` está coberto por `.gitignore`. Não cole a chave no chat, não a coloque em arquivo versionado e nunca use uma chave `sb_secret_...` ou `service_role`. A chave publicável pode aparecer no bundle do navegador por definição; a segurança dos dados depende das políticas RLS. Consulte [a documentação oficial de chaves da API Supabase](https://supabase.com/docs/guides/getting-started/api-keys) se os nomes do painel mudarem.

Após entrar, a listagem/criação de grupos, participantes, edição por admin e registros de convite usam o Supabase; despesas e saldos continuam demonstrativos. **Atenção:** o `.env.local` atual aponta para o projeto remoto `yzxeyqutmvjmrglmpcbb`; qualquer uso local dessas funções grava nele. Para validar sem tocar no remoto, use um Supabase local e configure a URL/chave locais antes de abrir o app.

## Publicação

O workflow em `.github/workflows/deploy.yml` usa Node 22, instala as dependências do `package-lock.json`, compila o site e publica `dist` no GitHub Pages quando há push para `main` ou execução manual. O Vite usa `/SplitUai/` como caminho base. No GitHub, configure em **Settings → Secrets and variables → Actions → Variables** as variáveis `VITE_SUPABASE_URL` (`https://yzxeyqutmvjmrglmpcbb.supabase.co`) e `VITE_SUPABASE_PUBLISHABLE_KEY` (a chave **Publishable** do projeto SplitUai). São valores públicos de cliente; nunca use `service_role`/`secret`. O workflow exige as duas variáveis antes de compilar, para não publicar uma tela de login desabilitada. Depois de cadastrá-las, execute **Actions → Deploy to GitHub Pages → Run workflow**.

O deploy de `c22d736` foi concluído pelo GitHub Actions, mas a captura da página mostrou que o build publicado não recebeu as variáveis: o app desabilita login quando a configuração Supabase está ausente. Até cadastrar as variáveis e publicar novamente, o login no Pages continuará indisponível. Para conferência local, use `.env.local` conforme a seção acima.

## Supabase

A CLI e as migrações estão em `supabase/`. O projeto alvo é `yzxeyqutmvjmrglmpcbb` (**SplitUai**, organização **Free**, saudável, São Paulo, `sa-east-1`, `t3.nano`), confirmado no painel e vinculado pela CLI. O painel também mostra a integração GitHub `JotaChina/SplitUai` com deploy automático para produção ligado na branch `main`; revise esse fluxo antes de futuros pushes que incluam migrações. O histórico local/remoto foi sincronizado para as migrations `20261007000100` e `20261007000200`; o commit `c22d736` foi enviado à `main` e o workflow GitHub Pages concluiu com sucesso. Nenhuma migration nova foi incluída nesse commit.

A migração `20261007000100_etapa_2_schema_e_rls.sql` já foi aplicada somente nesse projeto. Ela cria perfis, grupos, membros, convites, despesas e parcelas, com relações, restrições, índices, funções validadas e políticas explícitas. O lint do schema remoto não encontrou erros. RLS está habilitada nas sete tabelas públicas. Testes locais adicionais de criação/edição por papéis distintos e recusa de escrita direta em `group_members` passaram com Supabase local; nenhum dado remoto foi criado para esses testes. Escritas de despesas/parcelas seguem bloqueadas até existir fluxo validado para isso.

Auth remoto foi configurado sem cadastro público, com URL do GitHub Pages. O trigger de Auth só aceita usuários convidados registrados em `bootstrap_invites` ou `group_invitations`. Para convidar o titular inicial: inserir o e-mail normalizado em `public.bootstrap_invites` pelo SQL Editor e, em seguida, usar **Authentication → Users → Add user → Send invitation**. Para participantes posteriores, admin registra primeiro o convite para o e-mail exato em `public.group_invitations`; o envio do convite Auth é feito pelo painel. Não há envio de convites pelo frontend nesta etapa.

Para testes locais, `http://localhost:5173/**` está permitido em **Authentication → URL Configuration → Redirect URLs**. `.env.local` foi conferido localmente e a tela de login abriu em `http://127.0.0.1:5173/SplitUai/`. A migração `20261007000200_fix_invited_auth_user_trigger.sql` foi aplicada pelo SQL Editor no projeto alvo após o primeiro envio falhar por causa do trigger. O convite inicial foi concluído e o titular confirmou que o login funcionou no GitHub Pages. Para o reenvio, o **Site URL** foi trocado temporariamente para `http://localhost:5173/SplitUai/`; em seguida foi restaurado para `https://jotachina.github.io/SplitUai/` e conferido no painel.

### CLI e segurança

O projeto local já está vinculado apenas ao ref de São Paulo. Se precisar refazer a configuração em uma máquina nova, autentique a CLI sem compartilhar token e use:

```bash
npx supabase login
npx supabase link --project-ref yzxeyqutmvjmrglmpcbb
```

A migração de Etapa 2 já foi aplicada; não repita `db push` sem revisar o plano e o alvo antes. A senha do banco não foi solicitada nem armazenada. Nunca coloque token da CLI, senha do banco ou chaves `service_role`/secret no código, Git, frontend ou bundle. O projeto antigo `ipbnqofmggytdkgmadtc`, em Virginia (`us-east-1`), permanece intacto e não é usado pelo app.

No painel da organização `JotaChina's Org`, o projeto SplitUai é o único projeto da organização. Em **Project Settings → Usage**, com o filtro **All projects**, a organização não excedeu a cota Free no ciclo exibido (08/10/2026–08/11/2026). O banco estava em **0,027/0,5 GB (5%)**; egress, egress em cache, Storage, MAU, Realtime e Edge Functions apareciam em zero. A página **Subscription** confirma **Free Plan**, **spend cap habilitado** e nenhuma fatura listada. O painel informa que não haverá cobrança extra com esse controle ligado; ao exceder a cota incluída, projetos podem ficar indisponíveis ou somente leitura. Uso pode levar até uma hora para atualizar. Reconfira limites antes de expandir o uso.

O `.env.example` contém a URL pública do projeto e deixa a chave publicável vazia. O build da Etapa 3 passou com Node 24.19.0. Os testes em `scripts/test-local-rls.mjs` passaram em Supabase local com 17 verificações e sessões de usuários distintas. A chave privilegiada local foi usada apenas para provisionar/remover as contas de teste; as asserções de autorização usaram sessões autenticadas pela chave pública. Não usamos `.env.local` para gravar dados de teste nem consultamos/alteramos o banco remoto. A configuração local mantém `auth.enable_signup = false` globalmente e habilita o provedor de e-mail para que contas convidadas existentes possam entrar. As funções auxiliares de política `is_current_user_group_member`, `is_current_user_group_admin` e `can_current_user_view_profile` continuam executáveis por usuários autenticados e podem permitir sondagem de UUIDs conhecidos; avaliar esse risco antes de ampliar a exposição do app.

### Etapa 3 — grupos e participantes

O plano e a revisão do SQL estão registrados em `PLANO_DO_PROJETO.md`. A implementação local já lista/cria grupos, mostra participantes/papéis, permite editar nome/descrição a admins e cria registros de convite pendente. O cliente usa somente a sessão autenticada e a chave publicável. A revisão do schema confirma:

- Grupos: membros podem ler; criação autenticada exige `created_by = auth.uid()` e o trigger `groups_add_creator_as_admin` adiciona o criador como admin. Somente admins atualizam nome/descrição. Exclusão é negada.
- Membros: leitura limitada a membros do grupo; escritas diretas de membro, papel ou associação são negadas. Novas associações vêm dos triggers de criação do grupo e de convite Auth válido.
- Convites: admins podem ler e inserir convite pendente; alteração/exclusão é negada. Inserir a linha não envia e-mail. O envio continua manual pelo painel Auth, sem chave privilegiada no navegador. O trigger `handle_invited_auth_user` associa o usuário de e-mail correspondente ao criar a conta Auth.
- Perfis: cada usuário e seus colegas de grupo podem ler o perfil; cada usuário só pode alterar seu próprio `display_name`.
- Despesas/parcelas: membros podem ler; escritas diretas estão negadas. A RPC `create_expense_with_shares` valida associação, pagador, participantes, valores e soma, mas Etapa 3 não irá conectá-la.

As policies específicas estão em `supabase/migrations/20261007000100_etapa_2_schema_e_rls.sql`; a versão corrigida do trigger de convite está em `supabase/migrations/20261007000200_fix_invited_auth_user_trigger.sql`. Revisar também a possibilidade de sondagem por chamadas diretas às funções auxiliares `is_current_user_group_member`, `is_current_user_group_admin` e `can_current_user_view_profile`, hoje executáveis por usuários autenticados para servir às policies.

Os cenários locais positivos e negativos passaram: leitura por membros; isolamento de outro grupo e de usuário sem associação; criação de grupo/Admin inicial; rejeição de `created_by` forjado; edição por admin e recusa por membro; bloqueio de INSERT/UPDATE/DELETE diretos em `group_members`; autorização de convite somente para admin; e associação do e-mail convidado ao criar a conta Auth. O ciclo de entrega de e-mail ainda exige validação pelo painel Supabase: o app só grava o convite, e o admin precisa usar **Authentication → Users → Add user → Send invitation** no projeto São Paulo e no mesmo e-mail. O trigger associa a conta quando o registro Auth é criado; um usuário que já tinha conta antes do convite não é adicionado por este fluxo. Também não foram testados localmente convites expirados/revogados ou envio pelo painel. Despesas continuam demonstrativas e sem persistência.

**Limite local/remoto:** não iniciar o app contra o `.env.local` atual para testes, pois ele aponta ao remoto e operações de grupos/convites gravariam nele. Os testes locais passaram depois de iniciar Docker; contas e grupos sintéticos foram removidos ao final. O único ajuste remoto desta continuação foi sincronizar o histórico CLI da migration 002, cuja função já havia sido aplicada pelo SQL Editor e conferida antes; nenhum dado ou schema remoto foi alterado e nenhum teste remoto foi feito. O commit `c22d736` foi enviado para `main`; a publicação Pages terminou, mas a captura mostrou login desabilitado por ausência das variáveis de build. O workflow agora exige `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` nas variáveis de Actions. O projeto Virginia `ipbnqofmggytdkgmadtc` permanece intocado. Chaves `secret`/`service_role` nunca devem ir ao frontend ou Git.

## Estado

- Etapas 0 e 1 concluídas; protótipo publicado em <https://jotachina.github.io/SplitUai/>.
- Etapa 2 aplicada e validada inicialmente: schema/RLS, Auth por convite e login/sessão implementados localmente. `.env.local` aponta para o projeto correto e contém uma chave publicável; a tela de login local abriu. A correção do trigger foi aplicada, o fluxo de convite foi concluído e o titular confirmou que o login funcionou no GitHub Pages. O Site URL de GitHub Pages foi restaurado.
- Grupos e participantes já usam o Supabase; despesas e saldos continuam demonstrativos. Build Vite aprovado; 17 verificações de autorização e convite passaram no Supabase local.
- Os testes adicionais da Etapa 3 foram feitos somente no Supabase local. O commit `c22d736` foi enviado e o workflow Pages concluiu, mas falta configurar as variáveis públicas de Actions para habilitar o login publicado. A validação de envio de convite por admin pelo painel Supabase permanece pendente.
