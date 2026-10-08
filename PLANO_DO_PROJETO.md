# Plano do projeto — SplitUai

## Contexto para novos chats

Leia este documento antes de propor ou executar mudanças. Este arquivo é a fonte de verdade do projeto. Atualize a seção **Andamento** e as decisões relevantes quando uma etapa for concluída, para que o próximo chat possa continuar sem pedir o contexto de novo.

**Prompt para iniciar um novo chat:**

> Vamos continuar o projeto SplitUai. Leia primeiro `PLANO_DO_PROJETO.md` e os arquivos atuais do repositório. Siga as decisões e a próxima etapa indicadas no documento. Atualize o plano quando concluir trabalho. Não refaça etapas já concluídas.

## Visão do produto

Criar um aplicativo web privado e simples para uso pessoal e de amigos próximos, inspirado em aplicativos de divisão de gastos. O app ajudará pequenos grupos, especialmente viagens, a registrar despesas e entender como acertar os saldos.

O app **não movimentará dinheiro**. Ele apenas registra gastos e calcula sugestões de acerto.

### Objetivo da primeira versão

Uma pessoa consegue criar uma conta, criar um grupo, registrar uma despesa paga por alguém, dividir o valor entre participantes e consultar os saldos do grupo.

### Público e acesso

- Uso pessoal e de amigos convidados; não é um serviço público ou comercial.
- Cada participante usa a própria conta.
- Somente pessoas adicionadas ao grupo podem consultar ou alterar os dados daquele grupo.
- Evitar coletar dados desnecessários. Não armazenar dados bancários, números de cartão ou credenciais financeiras.

## Arquitetura prevista

- **Frontend:** aplicação web estática publicada no GitHub Pages.
- **Backend gerenciado:** Supabase para autenticação e banco de dados PostgreSQL.
- **Acesso do frontend ao backend:** API do Supabase com chave pública e políticas de segurança no banco.
- **Segredos:** nunca colocar chave secreta/service role no frontend, no repositório ou em arquivos publicados.
- **Primeira implementação sugerida:** React, TypeScript e Vite, compilados para arquivos estáticos. Confirmar ou ajustar essa escolha antes de iniciar o scaffold.

O GitHub Pages não executa código de servidor. O Supabase ficará responsável por contas e dados compartilhados.

## Escopo do MVP

### Incluído

1. Cadastro/entrada de usuários.
2. Criação de grupo de viagem ou grupo de despesas.
3. Adição de participantes a um grupo.
4. Registro de despesa com descrição, valor, categoria, data, pagador e participantes da divisão.
5. Divisão igualitária como opção inicial.
6. Lista e detalhe de despesas do grupo.
7. Resumo de saldo por pessoa e sugestão simples de acertos.
8. Edição e exclusão de despesas por usuários autorizados.
9. Interface responsiva, em português e com valores em BRL.

### Fora do MVP

- Pagamentos ou integração bancária.
- Câmbio e despesas em moedas diferentes.
- Recibos/imagens anexadas.
- Notificações push/e-mail personalizadas.
- Convites públicos ou descoberta de usuários.
- Aplicativos nativos para iOS/Android.
- Recursos avançados de auditoria e relatórios.

## Modelo de dados inicial

O esquema pode mudar durante a implementação, mas deve preservar as relações e regras de acesso abaixo.

- **profiles**: perfil básico associado ao ID do usuário autenticado; nome de exibição.
- **groups**: nome, descrição opcional, criador e datas.
- **group_members**: grupo, usuário e papel (por exemplo, membro ou administrador); combinação grupo/usuário única.
- **expenses**: grupo, autor, pagador, descrição, categoria, valor em centavos, moeda (inicialmente BRL), data e observações opcionais.
- **expense_shares**: despesa, participante e parcela atribuída em centavos.

Guardar dinheiro como inteiro em centavos, não como ponto flutuante. A soma das parcelas deve fechar exatamente com o valor da despesa; tratar o resto de centavos de forma determinística.

## Regras de produto e segurança

- O acesso deve exigir autenticação.
- A autorização é por participação no grupo, não apenas por estar logado.
- Aplicar Row Level Security (RLS) às tabelas expostas e definir políticas explícitas para leitura, criação, alteração e exclusão.
- Para consultar um grupo, despesa ou parcela, o usuário precisa pertencer ao grupo correspondente.
- Escritas devem validar também quem pode agir e se os participantes pertencem ao grupo.
- Não confiar em validações feitas somente na interface; aplicar controles no banco/API.
- Não publicar informações financeiras pessoais no repositório. Dados de teste devem ser fictícios.
- Desativar cadastro público após definir o fluxo de entrada dos amigos; preferir adicionar/convidar pessoas de forma controlada.

## Plano de ação

### Etapa 0 — Definição e preparação

- [x] Confirmar nome visual, idioma e moeda padrão (SplitUai, português, BRL).
- [x] Confirmar frontend com React + TypeScript + Vite.
- [x] Definir fluxo para adicionar amigos: entrada controlada por convite do administrador; não abrir cadastro público.
- [x] Identificar o projeto Supabase existente (`ipbnqofmggytdkgmadtc`), saudável em `us-east-1` (East US / North Virginia).
- [x] Confirmar o novo projeto Supabase Free em São Paulo (`sa-east-1`); manter o projeto existente da Virginia sem alterações.
- [x] Conectar o repositório GitHub e habilitar publicação por GitHub Actions para Pages.

**Pronto quando:** as escolhas estão anotadas, o repositório tem a aplicação inicial e os serviços externos foram criados sem segredos no código.

### Etapa 1 — Esqueleto visual

- [x] Criar aplicação frontend com configuração para caminho de projeto do GitHub Pages.
- [x] Montar navegação e telas iniciais: entrar, grupos, detalhe do grupo e formulário de despesa (dados demonstrativos locais).
- [x] Criar identidade visual simples, responsiva e acessível como primeira versão.
- [x] Publicar uma primeira versão estática no Pages.

**Pronto quando:** a URL do Pages abre a aplicação e a navegação básica funciona em desktop e celular.

### Etapa 2 — Banco e autenticação

- [x] Preparar migração SQL local para tabelas, restrições, índices, relações e políticas RLS explícitas.
- [x] Definir configuração local de Auth por e-mail, sem cadastro público nem sessões anônimas.
- [x] Implementar entrada, saída, restauração de sessão e definição de senha após convite; sem cadastro público.
- [x] Aplicar migração e revisar as políticas RLS no projeto confirmado de São Paulo.
- [x] Verificar isolamento entre grupos e usuário sem associação com dados sintéticos em transação revertida.

**Pronto quando:** usuários conseguem entrar e as regras de acesso são aplicadas pelo banco, inclusive em chamadas diretas à API.

### Etapa 3 — Grupos e participantes

- [ ] Antes de qualquer futuro deploy/push, a comparação foi feita: `20261007000100` aparece local/remoto; `20261007000200` aparece local, mas ausente no histórico remoto. Uma consulta somente de leitura confirmou que a definição remota de `handle_invited_auth_user()` corresponde ao SQL local 002. Ainda falta autorizar e executar `supabase migration repair --status applied 20261007000200 --linked` (altera apenas o histórico de migrations) ou decidir outro plano. Não executar `db push` às cegas.
- [x] Implementar a listagem e criação de grupos usando a sessão autenticada e a chave publicável, mantendo despesas demonstrativas. A política existente limita leitura a membros e a criação exige `created_by = auth.uid()`; o trigger adiciona o criador como admin.
- [x] Mostrar participantes e papéis no detalhe. A leitura de `group_members` e dos perfis dos colegas é permitida somente a membros do mesmo grupo; o cliente não escreve diretamente em `group_members`.
- [x] Implementar a criação de convite pendente por admin; o envio do convite Auth continua sendo feito pelo painel Supabase nesta primeira versão, sem chave privilegiada no navegador. O trigger associa a conta ao grupo quando o usuário convidado é criado no Auth. O app informa o procedimento e mostra os convites e estados.
- [x] Compilar a aplicação localmente com Node 24.19.0; corrigir o estado React `reload` não utilizado identificado pelo TypeScript.
- [x] Cobrir permissões com testes positivos e negativos no Supabase local usando sessões autenticadas distintas. A chave privilegiada local foi usada só para provisionar/remover contas de teste; as asserções usaram a chave pública e sessões dos usuários.

**Pronto quando:** criação e listagem persistem; o criador é admin; participantes autorizados veem o mesmo grupo e seus participantes; convite válido associa somente a conta convidada; usuários de fora não leem nem alteram o grupo; tentativas diretas de escrita de associação são recusadas. Build e 17 cenários locais passaram. Falta validar o envio pelo painel Auth e cobrir convites expirados/revogados e usuários Auth preexistentes antes de considerar o fluxo de convite completo. Despesas continuam demonstrativas até a Etapa 4.

#### Revisão das políticas e riscos para a Etapa 3 (2026-10-07)

Fonte: `supabase/migrations/20261007000100_etapa_2_schema_e_rls.sql` e a redefinição do trigger em `supabase/migrations/20261007000200_fix_invited_auth_user_trigger.sql`. A revisão inicial é do SQL versionado local. Posteriormente foram consultados somente o histórico de migrations e a definição remota do trigger; nenhuma alteração foi feita no banco.

| Área | Acesso atual | Lacunas e riscos a tratar |
|---|---|---|
| `groups` | `groups_select_members` permite SELECT a membros; `groups_insert_self_as_creator` permite INSERT se `created_by = auth.uid()`; `groups_update_admins` permite UPDATE a admins. Grants só liberam INSERT de `name`, `description`, `created_by` e UPDATE de `name`, `description`. Trigger `groups_add_creator_as_admin` cria o admin. DELETE negado por `groups_delete_denied`. | O frontend já lista/cria grupos e edita nome/descrição pelo cliente autenticado. Os testes locais confirmaram criação/admin inicial, recusa de `created_by` forjado, edição por admin e recusa de membro comum. Não há DELETE intencional. |
| `group_members` | `group_members_select_group_peers` dá SELECT de membros do mesmo grupo; INSERT/UPDATE/DELETE são negados (`*_denied`). Associação é criada pelo trigger do grupo e pelo trigger de Auth para convite válido. | Os testes locais confirmaram leitura entre membros, isolamento de outros usuários e recusa de INSERT/UPDATE/DELETE diretos, inclusive tentativa de autopromoção. Não há API de remoção/troca de papel. O convite associa a conta quando o registro Auth é criado, antes do aceite do link; o fluxo de envio por e-mail ainda depende do painel. |
| `group_invitations` | SELECT apenas para admins (`group_invitations_select_admins`); INSERT para admin do grupo, com `invited_by = auth.uid()`, `status = 'pending'` e expiração futura (`group_invitations_insert_admins`). UPDATE/DELETE negados. Grants liberam INSERT das colunas de convite. | Os testes locais confirmaram que admin cria/consulta e membro comum não cria nem lê convites. Inserir a linha não envia e-mail; envio, expiração/revogação e usuário Auth preexistente ainda precisam de validação/processo pelo painel ou operação controlada. O prazo máximo não é limitado pela tabela. Nunca automatizar com chave Admin no frontend. |
| `profiles` | SELECT do próprio perfil e dos colegas de grupo via `profiles_select_self_or_group_peers`; UPDATE próprio limitado pelo grant à coluna `display_name`; INSERT/DELETE diretos negados. Perfil inicial é criado pelo trigger de Auth. | Selecionar perfil expõe aos colegas o ID, nome e timestamps disponíveis; não expõe e-mail nesta tabela. Confirmar na UI que só se mostra o necessário. |
| `expenses` e `expense_shares` | SELECT a membros do grupo (`expenses_select_group_members`, `expense_shares_select_group_members`); INSERT/UPDATE/DELETE diretos negados por políticas e grants. A função `create_expense_with_shares` permite criação atômica a membro e valida pagador/participantes no grupo, valores e soma das parcelas. | Nenhuma conexão de despesas nesta etapa. A função não oferece edição/exclusão; isso fica para a Etapa 4. Testar a RPC com participante de outro grupo e soma inválida antes de usá-la. |
| `bootstrap_invites` | RLS habilitada e políticas `*_denied`; sem grants para `anon`/`authenticated`. | Operação exclusiva do proprietário via SQL Editor; não expor no app. |

As funções auxiliares `is_current_user_group_member`, `is_current_user_group_admin` e `can_current_user_view_profile` são `SECURITY DEFINER`, fixam `search_path` vazio e têm execução concedida a `authenticated` para uso nas políticas. Como também podem ser chamadas diretamente com UUIDs, revisar se a resposta booleana permite sondagem de associação/perfil além do esperado; restringir ou redesenhar sem quebrar as policies antes de ampliar o uso. A função de criação de despesa também é `SECURITY DEFINER`, valida a associação e só tem execução concedida a `authenticated`.

#### Sequência proposta e critérios de autorização

1. **Preparação e revisão local:** confirmar schema/policies acima; preparar casos com usuários A e B no grupo G1, usuário C somente em G2 e usuário D sem grupo. Revisar a sincronização de histórico CLI antes de qualquer futuro `db push`, comparando migrations e estado remoto e confirmando o alvo São Paulo. A aplicação corretiva foi feita no SQL Editor e não deve ser reaplicada às cegas.
2. **Grupos:** implementar chamadas autenticadas para listar grupos e criar grupo, com estados de carregamento/erro/vazio. Validar que A cria G1 e torna-se admin; membros de G1 leem G1; C e D não recebem G1; C não renomeia G1; A consegue renomear. Tentativas de criar grupo com `created_by` de outra conta devem falhar.
3. **Participantes:** consultar `group_members` e os perfis permitidos para renderizar nome e papel. Confirmar que A/B veem a composição de G1; C/D não leem membros/perfis de G1; qualquer INSERT/UPDATE/DELETE direto de `group_members` pelo cliente falha, inclusive tentativa de promover a si mesmo a admin.
4. **Convite controlado:** admin cria convite pendente para e-mail normalizado do grupo; usuário comum e pessoa externa não criam convite nem leem a lista de convites. Operador autorizado envia pelo painel Auth; testar convite válido, expirado, revogado/ausente e e-mail diferente. Confirmar que apenas a conta com o e-mail convidado ganha associação ao grupo esperado. Até existir serviço confiável para envio, manter a operação de painel documentada e não simular envio no frontend.
5. **Validação de isolamento:** fazer cenários positivos e negativos em ambiente local de Supabase quando disponível; antes de usar dados reais ou publicar, repetir com contas de teste no alvo remoto em transações/ações reversíveis e revisar resultado. Usar sessões autenticadas distintas e verificar a API como cada usuário, sem credenciais privilegiadas para a prova. Despesas permanecem demo durante toda a Etapa 3.

**Localmente:** build e 17 verificações com Supabase local concluídos. Contas e grupos foram provisionados em banco local e removidos ao final; serviço privilegiado local só preparou/limpou fixtures, enquanto as verificações usaram sessões pela chave pública. **Painel/projeto remoto:** a definição remota da função 002 foi conferida antes de sincronizar seu histórico com `supabase migration repair --status applied 20261007000200 --linked`. Nenhum schema ou dado foi alterado por essa sincronização. O commit `c22d736` foi enviado a `main` e o workflow Pages concluiu com sucesso. A inspeção visual da página revelou que o build não recebeu `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`, então a tela de login desabilita os campos. O workflow foi atualizado para exigir essas variáveis antes do build; falta cadastrá-las em **Settings → Secrets and variables → Actions → Variables** e executar novo deploy. O teste de entrega Auth ainda exige envio manual pelo painel Supabase. Não alterar o projeto Virginia `ipbnqofmggytdkgmadtc` nem conectar despesas reais; nunca incluir `secret`/`service_role` no frontend ou Git.

#### Validação de implementação (2026-10-07)

- `npm run build` com Node global 20.11.1 não pôde concluir: essa versão está abaixo do requisito do Vite e o sandbox bloqueou o subprocesso do esbuild. Com Node empacotado 24.19.0, `tsc -b` e `vite build` passaram após a correção descrita abaixo.
- O erro TypeScript identificado foi o estado `reload` declarado em `Group` e não usado. Foi removido. Os testes também descobriram que `createGroup` encadeava `.select()` ao INSERT; a policy de leitura falhava no mesmo request enquanto o trigger criava a associação. O cliente agora insere primeiro e lê o grupo em request separado; o teste chamou a função real do app.
- Com Docker ativo, o Supabase local aplicou as duas migrations. Dezessete verificações passaram com usuários Auth distintos e chamadas autenticadas por chave pública: cadastro público bloqueado; criação/admin inicial; convite normalizado e associação de membro pelo trigger; leitura dos membros e dos convites por papel; isolamento entre grupos e de usuário sem associação; rejeição de `created_by` forjado; edição por admin/recusa de membro; recusa de INSERT/UPDATE/DELETE diretos em `group_members`; recusa de convite por membro comum. O service role local serviu somente para provisionamento/limpeza das contas, nunca como sessão usada nas asserções.
- O trigger foi exercitado por criação local de conta Auth. O envio de e-mail no painel, convites expirados/revogados e usuário Auth preexistente ainda não foram testados.
- `.env.local` não foi usado para criar dados de teste remoto. A definição do trigger foi consultada em modo somente leitura; em seguida, o histórico da migration 002 foi sincronizado com a CLI após confirmação de que seu SQL já estava aplicado. Não houve alteração de schema/dados de grupos remoto. O commit `c22d736` foi enviado e o deploy Pages terminou com sucesso.
- As funções auxiliares `is_current_user_group_member`, `is_current_user_group_admin` e `can_current_user_view_profile` continuam executáveis diretamente por `authenticated`, além de seu uso pelas policies. Isso pode permitir sondagem booleana para UUIDs conhecidos; avaliar isolamento dessas funções em schema não exposto pela API antes de ampliar a exposição.
- A configuração local inicialmente desabilitava o provedor de e-mail junto com o cadastro. Ela foi ajustada para permitir login por e-mail de contas existentes, mantendo `auth.enable_signup = false` global; um teste confirmou que o cadastro público segue bloqueado. Isso afeta apenas a configuração local.

#### Deploy e autenticação no Pages (2026-10-08)

- A página `https://jotachina.github.io/SplitUai/` respondeu HTTP 200 e o workflow `Deploy to GitHub Pages` do commit `c22d736` concluiu build e deploy com sucesso.
- A captura do usuário mostra a mensagem “Autenticação não configurada neste ambiente” e campos de login inativos. O componente desabilita os campos quando o cliente Supabase não foi criado; a causa é o workflow Pages compilar sem `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
- O workflow agora lê essas duas variáveis de **Settings → Secrets and variables → Actions → Variables** e interrompe o build se estiverem ausentes. Falta ao dono do repositório cadastrá-las e executar novamente o workflow. A chave Publishable/anon é pública e destinada ao cliente; não usar `service_role`/`secret`.
- Uma validação local de build com Node global 20.11.1 falhou porque essa versão não atende o Vite e o sandbox bloqueou o subprocesso do esbuild; com Node 24.19.0 do runtime do Codex, `tsc -b` e `vite build` passaram. A página pública ainda servia uma referência de JavaScript antiga durante a janela de cache, então não foi confirmado que o asset novo chegou ao navegador.
- O projeto Supabase da Virginia permaneceu intocado. Nenhum teste Auth ou escrita de dados foi feito contra o projeto remoto. O workflow foi preparado para configuração, mas uma nova publicação funcional depende das variáveis de Actions.

### Etapa 4 — Despesas e divisão

- [ ] Criar, listar, editar e excluir despesas.
- [ ] Implementar categorias iniciais (ex.: hospedagem, alimentação, transporte, atividades e outros).
- [ ] Permitir selecionar pagador e participantes.
- [ ] Dividir igualmente e distribuir centavos restantes sem erro.
- [ ] Validar valores positivos, campos necessários e associação de participantes ao grupo.

**Pronto quando:** despesas e parcelas persistem, são compartilhadas entre participantes e totalizam exatamente o valor lançado.

### Etapa 5 — Saldos e acertos

- [ ] Calcular quanto cada pessoa pagou, sua parte atribuída e saldo líquido.
- [ ] Gerar sugestões de transferências que zerem os saldos líquidos do grupo.
- [ ] Mostrar explicação do cálculo e atualizar o resumo após alterações.
- [ ] Verificar casos de empate, vários pagadores e valores com centavos.

**Pronto quando:** o resumo bate com as despesas lançadas e as sugestões de acerto zeram o total líquido.

### Etapa 6 — Acabamento e entrega

- [ ] Tratar estados de carregamento, erro, lista vazia e sessão expirada.
- [ ] Verificar uso em telas pequenas e acessibilidade básica.
- [ ] Revisar permissões RLS, configuração de publicação e ausência de segredos no bundle.
- [ ] Documentar como configurar ambiente, publicar e fazer backup/exportação dos dados.

**Pronto quando:** amigos conseguem usar o app sem assistência técnica, e o dono sabe recuperar/configurar o projeto.

## Andamento atual

- **Status:** Etapas 0, 1 e 2 concluídas nos escopos registrados. Etapa 3 implementada e validada localmente: build e 17 cenários RLS/autorização passaram. Login publicado aguarda configurar variáveis no GitHub Actions, pois a captura mostrou controles desabilitados sem configuração Supabase. Falta validar envio de e-mail pelo painel e cobrir convites expirados/revogados e usuários Auth preexistentes. Despesas e saldos seguem demonstrativos.
- **Projeto alvo (2026-10-08):** `yzxeyqutmvjmrglmpcbb`, SplitUai, saudável, organização Free, São Paulo (`sa-east-1`, `t3.nano`), confirmado pelo painel e pela CLI. O projeto Virginia `ipbnqofmggytdkgmadtc` permanece intocado. GitHub `JotaChina/SplitUai`, produção em `main` e deploy automático de banco habilitado. `c22d736` foi enviado; histórico local/remoto das migrations 001/002 está sincronizado. O workflow Pages concluiu, mas a publicação funcional seguinte depende das variáveis de Actions descritas acima.
- **Banco e Auth:** aplicada `supabase/migrations/20261007000100_etapa_2_schema_e_rls.sql`; lint remoto sem erros. Todas as sete tabelas públicas estão com RLS habilitada e políticas explícitas. Teste transacional com dois membros de grupos distintos e um usuário externo retornou apenas grupos/dados autorizados; as linhas sintéticas foram revertidas e sua ausência foi conferida. Auth remoto atualizado para desabilitar cadastro público; URL de retorno aponta para o GitHub Pages. CLI Supabase 2.120.0 vinculada somente ao projeto alvo.
- **Frontend:** implementados login por e-mail/senha, estado/restauração de sessão, logout e formulário de senha após convite. O cliente só inicializa com URL e chave publicável fornecidas por ambiente; nenhum segredo foi adicionado. Grupos e participantes consultam/escrevem no Supabase usando sessão e chave publicável; despesas seguem demonstrativas. O fluxo de criação de grupo foi corrigido para separar INSERT e SELECT e passou teste local. Admin cria registro de convite e deve enviar Auth pelo painel. Contas Auth preexistentes não são associadas por este trigger. Build Vite e 17 verificações locais aprovados; envio de e-mail no painel ainda pendente. A captura do Pages mostrou autenticação desabilitada porque o workflow não recebia as variáveis públicas; a configuração do workflow agora interrompe o build quando elas estiverem ausentes.
- **Configuração local:** `.env.local` já está preenchido para o projeto `yzxeyqutmvjmrglmpcbb`; conferidos somente correspondência da URL e presença/formato público da chave, sem exibir seu valor. A tela de login inicializou em `http://127.0.0.1:5173/SplitUai/` com Node 24 do ambiente. O Node global 20.11.1 não inicia o Vite 7 atual. `.gitignore` ignora `.env.local`. Não enviar chaves pelo chat nem usar chave `secret`/`service_role` no frontend.
- **Uso e cobrança (2026-10-07):** o painel confirmou `JotaChina's Org` com um único projeto e plano Free. Com filtro **All projects**, a organização não excedeu a cota no ciclo exibido (08/10/2026–08/11/2026); banco em 0,027/0,5 GB (5%), os outros indicadores visíveis em zero. A página de cobrança confirmou **spend cap habilitado** e nenhuma fatura listada. O painel informa que excedentes não geram cobrança com esse controle ligado, mas podem deixar projetos indisponíveis ou somente leitura. Revalidar limites antes de expandir uso.
- **Convite inicial:** o redirect `http://localhost:5173/**` foi adicionado e verificado. O `bootstrap_invite` foi inserido (expira em sete dias). O primeiro envio falhou; logs registraram `SplitUai accounts are invitation-only`, emitido pela checagem de `invited_at` da função do trigger antes da validação do convite. A função foi corrigida pela migração `20261007000200_fix_invited_auth_user_trigger.sql`, aplicada pelo SQL Editor somente no projeto alvo e depois sincronizada no histórico da CLI após comparação. O segundo envio teve sucesso: o Auth criou o usuário não confirmado e o painel mostrou `Sent invite email`. O Site URL foi restaurado para GitHub Pages. O fluxo manual do painel ainda precisa ser validado para convites criados por admins.
- **Próximos passos:** cadastrar `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` em GitHub Actions Variables e executar novamente `Deploy to GitHub Pages`; depois confirmar login ativo no site. Testar convite criado por admin e envio pelo painel, revisar funções auxiliares expostas e cenários de convite expirado/revogado/preexistente. Despesas reais seguem fora do escopo. Nunca versionar token CLI, senha do banco, chave `secret` ou `service_role`; nunca alterar/apontar o app ao projeto Virginia.

## Registro de decisões

| Data | Decisão | Estado |
|---|---|---|
| 2026-10-07 | Hospedar frontend no GitHub Pages e usar backend gerenciado para autenticação e dados compartilhados. | Confirmado como direção do projeto |
| 2026-10-07 | Supabase é o backend escolhido para autenticação e dados relacionais. | Confirmado e configurado somente no projeto de São Paulo |
| 2026-10-07 | Usar o projeto novo `yzxeyqutmvjmrglmpcbb`, Free em São Paulo (`sa-east-1`). | Confirmado pelo painel e CLI; uso atual abaixo das cotas exibidas e spend cap habilitado |
| 2026-10-07 | Registrar o projeto Supabase existente `ipbnqofmggytdkgmadtc`, em `us-east-1` (East US / North Virginia). | Projeto saudável conforme captura do usuário; ref e URL pública registradas, sem segredos |
| 2026-10-07 | Manter o projeto existente da Virginia sem alterações e não apontar o SplitUai para ele. | Em vigor; CLI e migração apontam somente para São Paulo |
| 2026-10-07 | O deploy Pages usará GitHub Actions com `configure-pages`, `npm ci` e artefato `dist`. | Publicado e funcionando em `https://jotachina.github.io/SplitUai/` |
| 2026-10-07 | O produto é para uso pessoal e amigos próximos, sem pagamentos integrados. | Confirmado |
| 2026-10-07 | Usar React + TypeScript + Vite, idioma português e valores em BRL. | Confirmado; scaffold criado |
| 2026-10-07 | Manter a entrada controlada por convite do administrador, sem cadastro público. | Auth local/remoto sem signup público; fluxo de autenticação implementado |
| 2026-10-07 | Não conectar o frontend a dados reais até revisar RLS e confirmar isolamento entre grupos. | RLS aplicada e teste transacional inicial aprovado; dados reais ainda não conectados |

## Notas operacionais

- Planos gratuitos e limites dos provedores podem mudar; verificar os limites atuais ao criar/configurar as contas.
- O Supabase Free pode pausar projetos com pouca atividade. Planejar como reativar e exportar os dados.
- Um frontend publicado é público por natureza; a privacidade depende da autenticação e, principalmente, das políticas RLS corretas.
- Atualizar este documento ao fechar decisões ou concluir cada etapa. Manter o status da próxima etapa acionável.
