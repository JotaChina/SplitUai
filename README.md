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

Após entrar, grupos, participantes, convites, despesas, saldos e sugestões de acerto usam o Supabase. O saldo é pago menos a parte atribuída, calculado em centavos; as sugestões não registram nem confirmam transferências. Qualquer membro pode criar despesas; apenas admins podem editar ou excluir. **Atenção:** o `.env.local` aponta para o projeto remoto `yzxeyqutmvjmrglmpcbb`; qualquer execução local do app com esse arquivo pode gravar nele. Para desenvolvimento sem tocar no remoto, inicie o Supabase local e use URL/chave locais; não use `.env.local` para testes.

## Publicação

O workflow em `.github/workflows/deploy.yml` usa Node 22, instala as dependências do `package-lock.json`, compila o site e publica `dist` no GitHub Pages quando há push para `main` ou execução manual. O Vite usa `/SplitUai/` como caminho base. O job `build` usa o ambiente GitHub **SplitUai**; mantenha nesse ambiente, em **Settings → Environments → SplitUai → Environment variables**, `VITE_SUPABASE_URL` (`https://yzxeyqutmvjmrglmpcbb.supabase.co`) e `VITE_SUPABASE_PUBLISHABLE_KEY` (a chave **Publishable** do projeto SplitUai). São valores públicos de cliente; nunca use `service_role`/`secret`. O workflow exige as duas variáveis antes de compilar, para não publicar uma tela de login desabilitada. Depois de cadastrá-las, execute **Actions → Deploy to GitHub Pages → Run workflow**.

O deploy de `c22d736` foi concluído, mas inicialmente não recebeu as variáveis de ambiente e deixou o login desabilitado. Elas estavam no ambiente `SplitUai`; o job `build` foi vinculado a esse ambiente no commit `df438d4`. A execução `37721340491` concluiu e o usuário confirmou que conseguiu entrar. A correção posterior do carregamento do grupo foi publicada pelo workflow `37722182113` do commit `5122a6d` (sucesso); o Pages serve o bundle corrigido. O INSERT da tentativa anterior foi confirmado pelo app; confira **Meus grupos** antes de criar outro registro semelhante.

## Supabase

A CLI e as migrações estão em `supabase/`. O projeto alvo é `yzxeyqutmvjmrglmpcbb` (**SplitUai**, organização **Free**, São Paulo, `sa-east-1`, `t3.nano`); o vínculo local da CLI aponta para esse ref. A integração GitHub `JotaChina/SplitUai` está configurada para aplicar novas migrations quando há push para produção em `main`. O workflow Pages também publica no push para `main`; esses processos não garantem ordem entre banco e frontend. A documentação do [deploy Supabase via GitHub](https://supabase.com/docs/guides/deployment/branching/github-integration) confirma o comportamento da integração. Em 2026-10-08, o commit somente com migrations `8594f99` foi enviado; as migrations 004/005 foram aplicadas automaticamente no projeto São Paulo e a consulta de histórico confirmou 001/002/004/005 local/remoto. Depois, o commit frontend `b447871` publicou a Etapa 4/5 pelo Pages, workflow `37874511350` (sucesso). O HTML público respondeu HTTP 200 e o bundle servido contém os textos de saldos e sugestões de acerto. O workflow `37874029710` publicou apenas o frontend anterior na fase de banco. O workflow `37722182113` do commit `5122a6d` publicou a correção anterior de busca de grupo.

A migration `20261007000100_etapa_2_schema_e_rls.sql` e `20261007000200_fix_invited_auth_user_trigger.sql` já constavam no histórico remoto. As migrations `20261008000100_etapa_4_expense_crud.sql` e `20261008000200_etapa_5_saldos_e_autorizacao.sql` foram aplicadas localmente e depois pelo deploy automático do GitHub no projeto São Paulo a partir do commit `8594f99`; o histórico local/remoto agora contém as quatro versões. Leitura de catálogo confirmou RPCs de edição/exclusão disponíveis para `authenticated`, helper auxiliar público sem EXECUTE e INSERT direto em `expenses` negado. O painel Data API mostrou apenas `graphql_public` e `public` expostos; `private` não está exposto. Não houve `db push`.

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

O `.env.example` contém a URL pública do projeto e deixa a chave publicável vazia. A build Vite e 37 verificações em `scripts/test-local-rls.mjs` passaram no Supabase local com sessões distintas. A chave privilegiada local foi usada somente para provisionar/remover contas sintéticas; as asserções usaram sessões individuais pela chave pública. `.env.local` não foi usado para testes. No remoto, apenas histórico de migrations, painel de schemas expostos e catálogo de privilégios foram consultados; nenhuma despesa ou dado de usuário foi lido. As RPCs públicas auxiliares têm execução revogada e o schema `private` não está exposto. O cadastro público permanece desabilitado no Auth local.

### Etapa 3 — grupos e participantes

O plano e a revisão do SQL estão registrados em `PLANO_DO_PROJETO.md`. A implementação local já lista/cria grupos, mostra participantes/papéis, permite editar nome/descrição a admins e cria registros de convite pendente. O cliente usa somente a sessão autenticada e a chave publicável. A revisão do schema confirma:

- Grupos: membros podem ler; criação autenticada exige `created_by = auth.uid()` e o trigger `groups_add_creator_as_admin` adiciona o criador como admin. Somente admins atualizam nome/descrição. Exclusão é negada.
- Membros: leitura limitada a membros do grupo; escritas diretas de membro, papel ou associação são negadas. Novas associações vêm dos triggers de criação do grupo e de convite Auth válido.
- Convites: admins podem ler e inserir convite pendente; alteração/exclusão é negada. Inserir a linha não envia e-mail. O envio continua manual pelo painel Auth, sem chave privilegiada no navegador. O trigger `handle_invited_auth_user` associa o usuário de e-mail correspondente ao criar a conta Auth.
- Perfis: cada usuário e seus colegas de grupo podem ler o perfil; cada usuário só pode alterar seu próprio `display_name`.
- Despesas/parcelas: membros podem ler e criar por RPC; escrita direta segue negada por RLS/grants. Apenas admins podem editar ou excluir, por RPC com checagem no banco; a interface oculta essas ações a membros. Criação/edição validam pagador, participantes, campos, valores e soma das parcelas.
- Saldos: o cliente soma o que cada pessoa pagou e subtrai suas parcelas, tudo em centavos. Verifica soma zero e gera sugestões determinísticas de devedores para credores. Sugestão não representa pagamento liquidado.

As policies e funções originais estão em `supabase/migrations/20261007000100_etapa_2_schema_e_rls.sql`; a migration `20261008000200_etapa_5_saldos_e_autorizacao.sql` revoga os RPCs públicos auxiliares, recria helpers no schema interno e atualiza policies e RPCs. O schema `private` deve continuar fora da lista de schemas expostos pela API REST.

Os cenários locais positivos e negativos passaram: 37 verificações cobrem grupos/convites, CRUD de despesas, três participantes, dois pagadores, divisão de centavos com resto, atualização dos saldos após edição, saldo zero após exclusões, bloqueio de edição/exclusão por membro, autorização de admin, isolamento entre grupos e sondagem bloqueada das funções auxiliares. O ciclo de convite ainda exige validação manual pelo painel; contas Auth preexistentes e convites expirados/revogados não são cobertos por esta etapa.

**Limite local/remoto:** não iniciar o app contra o `.env.local` atual para testes, pois aponta ao remoto. Neste trabalho, as fixtures foram criadas/removidas apenas localmente e a única consulta ao banco remoto foi a leitura do histórico de migrations. A sincronização anterior do histórico 002 ocorreu após confirmar que o SQL já estava aplicado. Nenhum dado ou schema remoto foi alterado agora, nenhum convite foi enviado e nenhum teste de autorização foi feito no remoto. O projeto Virginia `ipbnqofmggytdkgmadtc` permanece intocado. Chaves `secret`/`service_role` nunca devem ir ao frontend ou Git.

## Estado

- Etapas 0 e 1 concluídas; protótipo publicado em <https://jotachina.github.io/SplitUai/>.
- Etapa 2 aplicada e validada inicialmente: schema/RLS, Auth por convite e login/sessão implementados localmente. `.env.local` aponta para o projeto correto e contém uma chave publicável; a tela de login local abriu. A correção do trigger foi aplicada, o fluxo de convite foi concluído e o titular confirmou que o login funcionou no GitHub Pages. O Site URL de GitHub Pages foi restaurado.
- Etapas 4 e 5 foram publicadas. Migrations 004/005 foram aplicadas primeiro no Supabase São Paulo pela integração GitHub; depois, `b447871` publicou o frontend via Pages. Build Vite e 37 verificações de autorização, despesas, saldos e sugestões passaram localmente. A página publicada respondeu HTTP 200 e seu bundle contém a interface de saldos e sugestões.
- O workflow `37722182113` do commit `5122a6d` concluiu com sucesso e o Pages está servindo a correção da busca pós-criação de grupo. A validação de convite criado por admin via painel continua pendente, assim como cenários de convite expirado/revogado/preexistente.
