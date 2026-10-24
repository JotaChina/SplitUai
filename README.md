# SplitUai

Aplicação web para organizar despesas compartilhadas em grupos pequenos.

### Release de 2026-10-24 · publicado

O release acrescenta Internet em **Contas da Casa**, as categorias Viagens, Streaming, Fitness, Fatura de cartão e Acerto de outros grupos, e as subcategorias de Transporte. Os filtros e relatórios agrupam Contas da Casa e Transporte sem reclassificar despesas antigas. A lista mostra o saldo individual da pessoa autenticada por despesa e mantém o valor total como contexto. Os painéis do grupo e os meses da lista podem ser recolhidos por teclado ou mouse.

Despesas recorrentes mensais sem término guardam um modelo separado e materializam registros somente até a competência atual. Uma chave única por série e mês evita duplicatas; ocorrências materializadas continuam sendo despesas normais. Ao abrir uma ocorrência recorrente para edição, a tela informa que somente aquela ocorrência será alterada. O botão de exclusão de uma ocorrência cria uma exceção para impedir que ela seja recriada.

Admins podem exportar despesas e acertos do grupo aberto em CSV, usando o período selecionado nos relatórios. Acertos podem ser registrados como pendentes ou pagos; apenas pagamentos confirmados alteram os saldos. O pagador ou um admin pode confirmar um acerto pendente.

As migrations 010 (`categorias_e_despesas_recorrentes`) e 011 (`acertos_pendentes`) foram validadas em um Supabase descartável com dados sintéticos. O workflow `40095943551`, commit `6880da0`, concluiu build e deploy no GitHub Pages. A URL respondeu HTTP 200; o bundle publicado contém exportação CSV, recorrência mensal e acompanhamento de acertos pendentes/pagos. Na preparação deste release, a leitura remota encontrou 001–010 aplicadas; a origem e a data de aplicação da 010 não foram determinadas. Antes da publicação do frontend, foi feito backup lógico do schema/dados e a 011 foi aplicada; a conferência posterior confirmou 001–011 no Supabase. `.env.local` não foi lido.

O acabamento mobile, acessibilidade básica e estados da interface, a exportação CSV e o acompanhamento de acertos compõem a Etapa 11. Consulte o [plano do projeto](PLANO_DO_PROJETO.md#etapa-11--estabilização-e-melhorias-de-uso-real) para detalhes da validação e do rollback deste release.

#### Backup e rollback do release

Antes de aplicar a migration 011, foram exportados o schema e os dados dos schemas do app. Os arquivos estão em `.production-backups/2026-10-24/`, ignorados pelo Git e protegidos pelo DPAPI do Windows para a conta atual. SHA-256: `schema.sql.dpapi` `A2D10082CEA5389454B089314BE62C54AF1EF3F91769C6307B54B8D22BD67D53`; `data.sql.dpapi` `0F7CB5FA0CA00DE736E91F1746DC61B0FFF51DFEB9384306DB2AC5A4366C2FFA`. Preserve essa pasta e esta conta Windows para recuperar os dumps.

Para reverter a aplicação, primeiro execute `supabase/rollbacks/20261024001100_acertos_pendentes.sql` no Supabase vinculado; a transação aborta se houver acertos pendentes, para evitar apagar compromissos não pagos. Depois reverta o commit de release em `main`; o workflow Pages publica o frontend anterior. A migration 010 permanece instalada, pois já constava no histórico remoto antes deste release. Em incidente grave de dados/schema, os dumps pré-release são o ponto de recuperação; a restauração é manual e deve ser feita em janela de manutenção, preservando Auth e validando o banco antes de reabrir o app.

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

### Abrir uma instância de teste local no Windows

Com Docker Desktop aberto e as dependências instaladas (`npm ci`), execute `iniciar-teste-local.bat` na pasta do projeto. O atalho inicia o Supabase local, abre o Vite em `http://127.0.0.1:5173/SplitUai/` e força o app a usar `http://127.0.0.1:54321` com a chave publicável local, mesmo que exista um `.env.local` configurado para outro ambiente. O terminal do Vite fica em uma segunda janela; use `Ctrl+C` nela para parar o servidor. Fechar o app não aplica migrations.

O atalho não aplica migrations nem importa dados. Na revisão de 2026-10-23, o banco Supabase local estava na migration 004, com 005–009 pendentes; portanto, funcionalidades que dependem dessas mudanças de schema podem não funcionar até que a cadeia seja revisada e aplicada com segurança em uma instância local adequada. A validação de 010/011 foi executada em uma instância descartável separada. O script não executa `db reset`, `db push` nem qualquer comando contra o projeto remoto.

Após entrar, grupos, participantes, convites, despesas, saldos e sugestões de acerto usam o Supabase. Qualquer membro pode criar despesas; apenas admins podem editar ou excluir despesas. Saldos são calculados em centavos; sugestões são indicativas e não registram transferências. Acertos pagos registrados reduzem o saldo, enquanto os pendentes aparecem no histórico sem alterá-lo. **Atenção:** o `.env.local` aponta para o projeto remoto `yzxeyqutmvjmrglmpcbb`; qualquer execução local do app com esse arquivo pode gravar nele. Para desenvolvimento sem tocar no remoto, inicie o Supabase local e use URL/chave locais; não use `.env.local` para testes.

### Etapa publicada (2026-10-23)

Esta versão foi publicada no GitHub Pages em 2026-10-23 pelo commit `6e72f3a`; o workflow `40022604851` concluiu com sucesso. O histórico remoto do Supabase confirma as migrations `20261023000100` a `20261023000800`, incluindo o acerto manual com forma de pagamento. As alterações incluem:

- Fotos de perfil e capa dos grupos, gráficos de despesas por categoria com filtros de período e despesas agrupadas por mês.
- Categoria Corrida, importação do histórico CSV do Splitwise e registro de acerto parcial com participante, valor, forma e data.
- As funcionalidades aprovadas anteriormente para arquivamento de grupos, perfis, rateios e parcelas:

- Qualquer participante pode arquivar ou restaurar um grupo. Admin do grupo ou criador pode excluí-lo definitivamente somente quando não houver despesas; grupos com histórico devem ser arquivados. A regra é aplicada por RPC autorizada no banco.
- Cada perfil pode escolher um identificador de 3–24 letras ASCII, números ou `_`, normalizado para minúsculas, único sem diferenciar caixa e bloqueado para nomes reservados. A interface usa `@usuario` em participantes, saldos e acertos; o e-mail aparece na autenticação, na página da conta e nos convites.
- A divisão igual usa a mesma cota arredondada para baixo para todos; qualquer resto fica com quem pagou e aparece como ajuste. Assim, R$ 22,34 / 3 mostra R$ 7,44 por pessoa e R$ 0,02 de ajuste com o pagador. Percentuais somam 100% e centavos residuais vão para os maiores restos fracionários, com desempate pelo ID do usuário. Valores personalizados precisam fechar exatamente em centavos.
- Despesas podem ter 1–60 parcelas. O valor total é gravado uma vez, o cronograma fecha com ele e cada parcela afeta os saldos no mês do vencimento. O app mostra vencimentos e se a data passou; não registra pagamento de parcela.
- A tela mostra saldos do mês atual e do período completo ao mesmo tempo, valor devedor líquido a acertar e totais mensais e acumulados por categoria, com filtro de categoria na lista.

As migrations `20261023000100` a `20261023000800` constam no histórico remoto do projeto `yzxeyqutmvjmrglmpcbb` (SplitUai, São Paulo). O release foi publicado após essa conferência; nenhuma migration nova foi necessária.

## Publicação

O workflow em `.github/workflows/deploy.yml` usa Node 22, instala as dependências do `package-lock.json`, compila o site e publica `dist` no GitHub Pages quando há push para `main` ou execução manual. O Vite usa `/SplitUai/` como caminho base. O job `build` usa o ambiente GitHub **SplitUai**; mantenha nesse ambiente, em **Settings → Environments → SplitUai → Environment variables**, `VITE_SUPABASE_URL` (`https://yzxeyqutmvjmrglmpcbb.supabase.co`) e `VITE_SUPABASE_PUBLISHABLE_KEY` (a chave **Publishable** do projeto SplitUai). São valores públicos de cliente; nunca use `service_role`/`secret`. O workflow exige as duas variáveis antes de compilar, para não publicar uma tela de login desabilitada. Depois de cadastrá-las, execute **Actions → Deploy to GitHub Pages → Run workflow**.

O deploy de `c22d736` foi concluído, mas inicialmente não recebeu as variáveis de ambiente e deixou o login desabilitado. Elas estavam no ambiente `SplitUai`; o job `build` foi vinculado a esse ambiente no commit `df438d4`. A execução `37721340491` concluiu e o usuário confirmou que conseguiu entrar. A correção posterior do carregamento do grupo foi publicada pelo workflow `37722182113` do commit `5122a6d` (sucesso); o Pages serve o bundle corrigido. O INSERT da tentativa anterior foi confirmado pelo app; confira **Meus grupos** antes de criar outro registro semelhante.

## Supabase

### Gestão de participantes e convites (Etapa 8)

- Admins criam, enviam, reenviam e cancelam convites pelo app. A criação verifica e-mail, associação existente e convites ativos de forma transacional; tentativas concorrentes de envio são serializadas por uma concessão curta no banco. O prazo de 14 dias só é renovado depois que o Supabase Auth confirma que aceitou a solicitação de envio.
- Contas novas recebem convite Auth; contas já existentes recebem link OTP de entrada com criação de conta desativada. O usuário consulta convites destinados ao e-mail confirmado da sessão e só entra no grupo após aceitar autenticado. Criar uma conta Auth não aceita nem ativa o convite.
- `supabase/functions/send-group-invitation` valida JWT e identidade de sessão, e uma RPC confirma no banco que a pessoa é admin ativo do grupo antes de usar a chave privilegiada server-side. O frontend usa apenas chave publicável e sessão autenticada. O segredo não é fornecido em arquivo versionado nem incluído no bundle.
- A função usa a entrega de e-mail configurada no Supabase Auth. Para produção, é necessário configurar SMTP ou um provedor de e-mail Auth e permitir o redirect `https://jotachina.github.io/SplitUai/` em Authentication → URL Configuration. Nenhuma credencial foi criada nesta etapa. Sem entrega configurada, a UI informa falha, mantém o convite pendente e libera nova tentativa.
- O Supabase local permite redirects `http://localhost:5173/**` e `http://127.0.0.1:5173/**`; a função escolhe o redirect local quando o Supabase está local e usa GitHub Pages no ambiente hospedado.
- Convites usam os estados pendente, enviado, aceito, expirado e cancelado. Cancelamento impede aceite. Expiração, e-mail incompatível e sessão sem e-mail confirmado são recusados pela RPC, não apenas pela interface.
- Admins podem mudar o papel entre `member` e `admin`, editar o nome usado naquele grupo e remover outro participante. Não é possível rebaixar/remover o último admin nem remover a própria conta sem transferir a administração.
- Remover é uma desativação lógica de `group_members`; despesas, rateios e parcelas não são removidos. A pessoa perde acesso ao grupo e permanece no histórico e nos cálculos de saldo.
- As operações privilegiadas usam funções `SECURITY DEFINER` com autorização no banco. Escrita direta em associação e convites segue revogada para `authenticated`.

Migrations: `supabase/migrations/20261023000200_gestao_participantes_convites.sql`, `supabase/migrations/20261023000300_convites_envio_seguro.sql` e `supabase/migrations/20261023000400_endurecer_cancelamento_convite.sql`. A Edge Function exige a chave Auth server-side gerenciada pelo Supabase, nunca uma credencial no cliente. Aplicar e validar primeiro no Supabase local. Não publicar frontend nem aplicar ao projeto hospedado antes de revisar e ordenar a atualização do banco antes do Pages.

A CLI e as migrações estão em `supabase/`. O projeto alvo é `yzxeyqutmvjmrglmpcbb` (**SplitUai**, organização **Free**, São Paulo, `sa-east-1`, `t3.nano`); o vínculo local da CLI aponta para esse ref. A integração GitHub `JotaChina/SplitUai` está configurada para aplicar novas migrations quando há push para produção em `main`. O workflow Pages também publica no push para `main`; esses processos não garantem ordem entre banco e frontend. A documentação do [deploy Supabase via GitHub](https://supabase.com/docs/guides/deployment/branching/github-integration) confirma o comportamento da integração. Em 2026-10-08, o commit somente com migrations `8594f99` foi enviado; as migrations 004/005 foram aplicadas automaticamente no projeto São Paulo e a consulta de histórico confirmou 001/002/004/005 local/remoto. Depois, o commit frontend `b447871` publicou a Etapa 4/5 pelo Pages, workflow `37874511350` (sucesso). O HTML público respondeu HTTP 200 e o bundle servido contém os textos de saldos e sugestões de acerto. O workflow `37874029710` publicou apenas o frontend anterior na fase de banco. O workflow `37722182113` do commit `5122a6d` publicou a correção anterior de busca de grupo.

A migration `20261007000100_etapa_2_schema_e_rls.sql` e `20261007000200_fix_invited_auth_user_trigger.sql` já constavam no histórico remoto. As migrations `20261008000100_etapa_4_expense_crud.sql` e `20261008000200_etapa_5_saldos_e_autorizacao.sql` foram aplicadas localmente e depois pelo deploy automático do GitHub no projeto São Paulo a partir do commit `8594f99`; o histórico local/remoto agora contém as quatro versões. Leitura de catálogo confirmou RPCs de edição/exclusão disponíveis para `authenticated`, helper auxiliar público sem EXECUTE e INSERT direto em `expenses` negado. O painel Data API mostrou apenas `graphql_public` e `public` expostos; `private` não está exposto. Não houve `db push`.

Registro histórico da configuração inicial de Auth: cadastro público desabilitado e URL do GitHub Pages. O titular inicial entrou por `bootstrap_invites` e envio pelo painel. Para convites de grupo, a implementação atual é a Etapa 8 descrita acima: o app chama a Edge Function e o trigger não associa a conta antes do aceite.

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
- Convites: admins leem por RLS; criação, envio, cancelamento, aceite e mudança de estado são controlados por RPC. O trigger valida a allowlist e cria o perfil, mas a associação ao grupo ocorre somente no aceite autenticado. A Edge Function envia via Auth server-side.
- Perfis: cada usuário e seus colegas de grupo podem ler o perfil; cada usuário só pode alterar seu próprio `display_name`.
- Despesas/parcelas: membros podem ler e criar por RPC; escrita direta segue negada por RLS/grants. Apenas admins podem editar ou excluir, por RPC com checagem no banco; a interface oculta essas ações a membros. Criação/edição validam pagador, participantes, campos, valores e soma das parcelas.
- Saldos: o cliente soma o que cada pessoa pagou e subtrai suas parcelas, tudo em centavos. Verifica soma zero e gera sugestões determinísticas de devedores para credores. Sugestão não representa pagamento liquidado.

As policies e funções originais estão em `supabase/migrations/20261007000100_etapa_2_schema_e_rls.sql`; a migration `20261008000200_etapa_5_saldos_e_autorizacao.sql` revoga os RPCs públicos auxiliares, recria helpers no schema interno e atualiza policies e RPCs. O schema `private` deve continuar fora da lista de schemas expostos pela API REST.

Histórico de checks anteriores: 37 verificações cobriam grupos e despesas antes da Etapa 8. A revisão local atual adicionou cenários para aceite, envio, falha recuperável, duplicidade concorrente, expiração, cancelamento, contas existentes e remoção segura; o número corrente consta em `PLANO_DO_PROJETO.md`.

**Limite local/remoto:** não iniciar o app contra o `.env.local` atual para testes, pois aponta ao remoto. Neste trabalho, as fixtures foram criadas/removidas apenas localmente e a única consulta ao banco remoto foi a leitura do histórico de migrations. A sincronização anterior do histórico 002 ocorreu após confirmar que o SQL já estava aplicado. Nenhum dado ou schema remoto foi alterado agora, nenhum convite foi enviado e nenhum teste de autorização foi feito no remoto. O projeto Virginia `ipbnqofmggytdkgmadtc` permanece intocado. Chaves `secret`/`service_role` nunca devem ir ao frontend ou Git.

## Estado

- Etapas 0 e 1 concluídas; protótipo publicado em <https://jotachina.github.io/SplitUai/>.
- Etapa 2 aplicada e validada inicialmente: schema/RLS, Auth por convite e login/sessão implementados localmente. `.env.local` aponta para o projeto correto e contém uma chave publicável; a tela de login local abriu. A correção do trigger foi aplicada, o fluxo de convite foi concluído e o titular confirmou que o login funcionou no GitHub Pages. O Site URL de GitHub Pages foi restaurado.
- Etapas 4 e 5 foram publicadas. Migrations 004/005 foram aplicadas primeiro no Supabase São Paulo pela integração GitHub; depois, `b447871` publicou o frontend via Pages. Build Vite e 37 verificações de autorização, despesas, saldos e sugestões passaram localmente. A página publicada respondeu HTTP 200 e seu bundle contém a interface de saldos e sugestões.
- O commit `6e72f3a` foi publicado pelo workflow `40022604851` (build e deploy concluídos). A URL pública respondeu HTTP 200 e o bundle contém os fluxos de acerto, importação Splitwise e a categoria Corrida. O workflow usa as variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` do ambiente GitHub `SplitUai`, conferidas sem exibir seus valores. Nenhuma migration nova foi necessária: o histórico remoto já continha as versões 001–008.

### Melhorias publicadas (2026-10-23)

- A tela de participantes agora oferece acesso ao perfil pelo nome, mantém a edição de papel para admins ativos e não permite que um admin defina o apelido de outra pessoa. Apelidos continuam sendo geridos pelo titular na própria conta.
- O perfil mostra nome, apelido, foto, chave PIX, grupos comuns, saldos, período de participação e despesas/acertos compartilhados. A consulta usa apenas colunas de perfil e respeita RLS; o e-mail da conta não é selecionado nem exibido no perfil. A chave PIX é opcional, armazenada como texto porque precisa ser exibida para uso, editável pelo titular e legível no mesmo escopo autorizado do perfil.
- O botão **Visão de admin** aparece para admins ativos. A importação CSV do Splitwise só aparece nessa visão; o RPC também exige associação ativa e admin. Prévia, validações e chaves de origem/índices únicos foram mantidos.
- O gráfico reúne Aluguel, Luz, Água e IPTU em **Contas da Casa**; o filtro permite escolher o grupo ou uma subcategoria. Gráficos de categoria têm títulos com as despesas relacionadas e seleção para filtrar a lista. A tendência apresenta cada mês e valor; em períodos longos, a faixa rola horizontalmente sem omitir rótulos.
- A migration `20261023000900_perfis_categorias_e_visao_admin.sql` foi aplicada ao Supabase remoto depois que a listagem e o dry-run confirmaram a 009 como única pendente. A consulta posterior confirmou 001–009 aplicadas. Ela altera schema, políticas e RPCs sem reclassificar despesas nem registrar operações financeiras. O banco local continua na 004, com 005–009 pendentes; a migration 007 contém uma reclassificação histórica, por isso não apliquei a cadeia ao banco local existente.
- O build local passou com Node 24.22.1. Para revisar a interface autenticada localmente, use uma instância Supabase isolada e dados sintéticos; o atalho `iniciar-teste-local.bat` aponta o frontend para a URL e a chave locais. Não use o banco local existente sem revisar a cadeia de migrations nem use `.env.local` para testes, pois aponta ao Supabase remoto.
- Publicação concluída pelo commit `a026e8f`, workflow GitHub Pages `40030430010` (build e deploy com sucesso). A URL pública respondeu HTTP 200; o bundle servido contém a Visão de admin, o campo PIX e Contas da Casa. A migration 009 foi aplicada ao Supabase antes do push do frontend e conferida no histórico remoto.

### Publicação de 2026-10-24: categorias, favoritos e upload de imagens

- Despesas novas podem receber uma sugestão de categoria pelo título, ignorando acentos, diferenças de caixa, espaços e pontuação. A categoria segue editável; uma opção manual permanece selecionada ao continuar digitando. Lançamentos existentes não são recategorizados.
- Favoritos de rateio e despesas recorrentes são isolados por grupo. Membros ativos podem usar favoritos; a criação é restrita a membros ativos e edição/exclusão ao criador ou admin ativo. Participantes e pagador são validados no banco. Arredondamentos percentuais fecham o total em centavos; recorrências continuam materializadas sob demanda, sem duplicar ocorrências nem reescrever o histórico.
- Migration 012 corrige a chamada ao helper privado nas policies de Storage. Fotos do grupo respeitam o papel permitido; foto de perfil só pode ser alterada pelo próprio usuário. O schema `private` segue não exposto e sem grants amplos.
- A validação isolada da cadeia 001–012 passou no lint e em 111 verificações sintéticas de RLS/Storage, favoritos, categorias, rateios e recorrências. O build local e o build do workflow passaram. Não use `.env.local` para testes.
- A migration 012 foi aplicada antes do frontend; o histórico remoto foi conferido com 001–012. O commit de publicação é `e56fcfd65291f94f6a676a18c7189d1ae95ed421`; o workflow Pages `40099559260` concluiu build e deploy. A aplicação respondeu HTTP 200; o bundle `assets/index-BzrEuWWo.js` contém a sugestão de categoria e controles para usar e guardar favoritos.
- Backup pré-publicação protegido por DPAPI e verificado está em `.production-backups/2026-10-24/pre-012/`; dumps lógicos de schema e dados públicos/privados/storage, sem Auth. O rollback SQL é `supabase/rollbacks/20261024001200_category_favorites_storage_permissions.sql` e aborta se ainda houver favoritos. Para reverter o frontend: `git revert e56fcfd65291f94f6a676a18c7189d1ae95ed421` e push para `main`; o workflow Pages publica a reversão e a migration pode permanecer. Para reverter também o banco, preserve/exporte os favoritos, remova-os somente após decisão explícita, execute o SQL de rollback e confira as policies; o SQL mantém corrigidas as policies de Storage. A migration 011 permanece aplicada.
