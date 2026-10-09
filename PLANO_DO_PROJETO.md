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

- [x] Antes do deploy do commit `5122a6d`, o histórico 001/002 já estava sincronizado local/remoto, após comparação da função remota 002 e reparo de histórico autorizado anteriormente. O workflow `37722182113` terminou com sucesso e o Pages serve o bundle corrigido. Para futuras migrations, comparar os históricos e confirmar o alvo antes de qualquer `db push`.
- [x] Implementar a listagem e criação de grupos usando a sessão autenticada e a chave publicável, mantendo despesas demonstrativas. A política existente limita leitura a membros e a criação exige `created_by = auth.uid()`; o trigger adiciona o criador como admin.
- [x] Mostrar participantes e papéis no detalhe. A leitura de `group_members` e dos perfis dos colegas é permitida somente a membros do mesmo grupo; o cliente não escreve diretamente em `group_members`.
- [x] Implementar a criação de convite pendente por admin; o envio do convite Auth continua sendo feito pelo painel Supabase nesta primeira versão, sem chave privilegiada no navegador. O trigger associa a conta ao grupo quando o usuário convidado é criado no Auth. O app informa o procedimento e mostra os convites e estados.
- [x] Compilar a aplicação localmente com Node 24.19.0; corrigir o estado React `reload` não utilizado identificado pelo TypeScript.
- [x] Cobrir permissões com testes positivos e negativos no Supabase local usando sessões autenticadas distintas. A chave privilegiada local foi usada só para provisionar/remover contas de teste; as asserções usaram a chave pública e sessões dos usuários.

**Pronto quando:** criação e listagem persistem; o criador é admin; participantes autorizados veem o mesmo grupo e seus participantes; convite válido associa somente a conta convidada; usuários de fora não leem nem alteram o grupo; tentativas diretas de escrita de associação são recusadas. Build e 17 cenários locais passaram. Falta validar o envio pelo painel Auth e cobrir convites expirados/revogados e usuários Auth preexistentes antes de considerar o fluxo de convite completo. As despesas agora estão implementadas na Etapa 4.

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

Na revisão inicial, as funções auxiliares `is_current_user_group_member`, `is_current_user_group_admin` e `can_current_user_view_profile` tinham `EXECUTE` concedido a `authenticated` para uso nas policies e também podiam ser sondadas diretamente com UUIDs. A migration 005 moveu as funções usadas por policies/RPCs ao schema interno `private`, revogou o acesso às assinaturas públicas e verificou localmente e no painel do projeto São Paulo que `private` não é exposto pela API.

#### Sequência proposta e critérios de autorização

1. **Preparação e revisão local:** confirmar schema/policies acima; preparar casos com usuários A e B no grupo G1, usuário C somente em G2 e usuário D sem grupo. Revisar a sincronização de histórico CLI antes de qualquer futuro `db push`, comparando migrations e estado remoto e confirmando o alvo São Paulo. A aplicação corretiva foi feita no SQL Editor e não deve ser reaplicada às cegas.
2. **Grupos:** implementar chamadas autenticadas para listar grupos e criar grupo, com estados de carregamento/erro/vazio. Validar que A cria G1 e torna-se admin; membros de G1 leem G1; C e D não recebem G1; C não renomeia G1; A consegue renomear. Tentativas de criar grupo com `created_by` de outra conta devem falhar.
3. **Participantes:** consultar `group_members` e os perfis permitidos para renderizar nome e papel. Confirmar que A/B veem a composição de G1; C/D não leem membros/perfis de G1; qualquer INSERT/UPDATE/DELETE direto de `group_members` pelo cliente falha, inclusive tentativa de promover a si mesmo a admin.
4. **Convite controlado:** admin cria convite pendente para e-mail normalizado do grupo; usuário comum e pessoa externa não criam convite nem leem a lista de convites. Operador autorizado envia pelo painel Auth; testar convite válido, expirado, revogado/ausente e e-mail diferente. Confirmar que apenas a conta com o e-mail convidado ganha associação ao grupo esperado. Até existir serviço confiável para envio, manter a operação de painel documentada e não simular envio no frontend.
5. **Validação de isolamento:** fazer cenários positivos e negativos em ambiente local de Supabase quando disponível; antes de usar dados reais ou publicar, repetir com contas de teste no alvo remoto em transações/ações reversíveis e revisar resultado. Usar sessões autenticadas distintas e verificar a API como cada usuário, sem credenciais privilegiadas para a prova. Despesas permanecem demo durante toda a Etapa 3.

**Localmente:** build e 17 verificações da Etapa 3 passaram com Supabase local. Contas e grupos sintéticos foram removidos ao final; service role local só preparou/limpou fixtures e as asserções usaram sessões com chave pública. **Histórico remoto:** a definição da função 002 foi conferida antes de sincronizar o histórico da migration, sem alterar schema/dados. A publicação inicial do ajuste de variáveis do Pages foi confirmada pelo usuário. Em 2026-10-08, o workflow `37722182113` do commit `5122a6d` terminou com sucesso e a página foi confirmada com o bundle corrigido. A tentativa “Teste” do usuário não foi consultada nem modificada. O projeto Virginia `ipbnqofmggytdkgmadtc` permanece intocado; nunca incluir `secret`/`service_role` no frontend ou Git.

#### Validação de implementação (2026-10-07)

- `npm run build` com Node global 20.11.1 não pôde concluir: essa versão está abaixo do requisito do Vite e o sandbox bloqueou o subprocesso do esbuild. Com Node empacotado 24.19.0, `tsc -b` e `vite build` passaram após a correção descrita abaixo.
- O erro TypeScript identificado foi o estado `reload` declarado em `Group` e não usado. Foi removido. Os testes também descobriram que `createGroup` encadeava `.select()` ao INSERT; a policy de leitura falhava no mesmo request enquanto o trigger criava a associação. O cliente agora insere primeiro e lê o grupo em request separado; o teste chamou a função real do app.
- Com Docker ativo, o Supabase local aplicou as duas migrations. Dezessete verificações passaram com usuários Auth distintos e chamadas autenticadas por chave pública: cadastro público bloqueado; criação/admin inicial; convite normalizado e associação de membro pelo trigger; leitura dos membros e dos convites por papel; isolamento entre grupos e de usuário sem associação; rejeição de `created_by` forjado; edição por admin/recusa de membro; recusa de INSERT/UPDATE/DELETE diretos em `group_members`; recusa de convite por membro comum. O service role local serviu somente para provisionamento/limpeza das contas, nunca como sessão usada nas asserções.
- O trigger foi exercitado por criação local de conta Auth. O envio de e-mail no painel, convites expirados/revogados e usuário Auth preexistente ainda não foram testados.
- `.env.local` não foi usado para criar dados de teste remoto. A definição do trigger foi consultada em modo somente leitura; em seguida, o histórico da migration 002 foi sincronizado com a CLI após confirmação de que seu SQL já estava aplicado. Não houve alteração de schema/dados de grupos remoto. O commit `c22d736` foi enviado e o deploy Pages terminou com sucesso.
- Risco identificado nesta revisão: as funções auxiliares públicas permitiam sondagem booleana por UUID. Corrigido localmente pela migration 005; validar o schema exposto em São Paulo antes da publicação.
- A configuração local inicialmente desabilitava o provedor de e-mail junto com o cadastro. Ela foi ajustada para permitir login por e-mail de contas existentes, mantendo `auth.enable_signup = false` global; um teste confirmou que o cadastro público segue bloqueado. Isso afeta apenas a configuração local.

#### Deploy e autenticação no Pages (2026-10-08)

- A página `https://jotachina.github.io/SplitUai/` respondeu HTTP 200. O deploy `c22d736` não recebeu variáveis porque elas estavam no ambiente GitHub `SplitUai` e o job `build` não declarava esse ambiente.
- A captura do usuário mostrou as duas variáveis em **Settings → Environments → SplitUai → Environment variables**. O erro ocorreu porque o job `build` não declarava o ambiente `SplitUai`, então GitHub não as disponibilizou. O workflow foi ajustado para usar esse ambiente e ainda interrompe o build se faltar configuração. A chave Publishable/anon é pública e destinada ao cliente; não usar `service_role`/`secret`.
- O commit `df438d4` vinculou o job ao ambiente `SplitUai`; a execução `37721340491` concluiu build/deploy. A página e o bundle público foram conferidos e o usuário mostrou que conseguiu autenticar. O aviso de depreciação do runtime Node 20 nas actions era apenas warning.
- A tentativa de criar grupo exibiu “O grupo foi criado, mas não foi possível carregá-lo.” O INSERT foi confirmado; o filtro posterior comparava `created_at` do banco ao relógio do navegador e podia excluir a linha por diferença de relógio. O código foi ajustado para buscar o grupo mais recente por criador/nome/descrição. O UUID continua sendo gerado pelo banco, respeitando o grant atual; não foi necessária alteração de schema ou banco remoto.
- O workflow `37722182113` do commit `5122a6d5f2b7f55743734b627c106b3deafbfe90` terminou com sucesso em 2026-10-08; a página `https://jotachina.github.io/SplitUai/` serve um bundle que procura o grupo criado sem comparar `created_at` com o relógio do navegador. O grupo da tentativa do usuário não foi consultado nem alterado. O projeto Supabase da Virginia permanece intocado.

### Etapa 4 — Despesas e divisão

- [x] Criar, listar, editar e excluir despesas usando as sessões autenticadas.
- [x] Implementar categorias: hospedagem, alimentação, transporte, atividades e outros.
- [x] Permitir selecionar pagador, data, descrição, valor e participantes do grupo.
- [x] Dividir igualmente em centavos, entregando os centavos restantes aos primeiros participantes em ordem estável e preservando o total.
- [x] Manter escrita direta em `expenses`/`expense_shares` negada; usar RPCs transacionais com `SECURITY DEFINER`, `search_path` vazio e verificação de associação, pagador, participantes, categoria, valores e soma.
- [x] Testar no Supabase local com sessões distintas: CRUD, isolamento, escrita direta bloqueada, participante/valor/soma inválidos, divisão com resto, saldo zero e vários pagadores.
- [x] Aplicar a migration `20261008000100_etapa_4_expense_crud.sql` somente no banco local; não alterar histórico ou schema remoto.

**Pronto quando:** despesas e parcelas persistem, são compartilhadas entre participantes e totalizam exatamente o valor lançado. Implementado localmente; build Vite e 37 verificações locais passaram. As migrations 004 e 005 foram aplicadas ao projeto São Paulo pela integração GitHub, conforme histórico remoto.

#### Revisão de segurança e validação da Etapa 4 (2026-10-08)

- Leitura de despesas/parcelas mantém acesso RLS a membros do grupo. Escrita direta continua bloqueada por policies e ausência de grants. Qualquer membro pode criar despesas por RPC; somente admins podem editar ou excluir. A decisão segue o papel admin já usado para alterar o grupo e gerenciar convites, e evita que um participante altere os lançamentos dos demais sem controle.
- `create_expense_with_shares` valida associação, pagador, participantes, descrição, categoria, valor positivo e total das parcelas. `update_expense_with_shares` repete as validações, bloqueia a linha e substitui campos/parcelas atomicamente; `delete_expense` exige papel admin e remove parcelas pela FK em cascata. Todas são `SECURITY DEFINER`, fixam `search_path` vazio e só podem ser executadas por `authenticated`.
- A interface lê e salva pelo cliente Supabase de sessão; normaliza BRL para centavos sem arredondamento binário, seleciona pagador/data/categoria/participantes e mostra a partilha resultante. O banco é a autoridade final para autorização e validações.
- `scripts/test-local-rls.mjs`: 37 verificações passaram usando três contas no grupo, mais contas para isolamento. A chave privilegiada local foi usada somente para preparar/limpar fixtures; cada asserção usou sessões individuais com chave pública. Coberturas incluem criação por membro, edição/exclusão somente por admin, recusas por membro e usuário externo, escrita direta negada, divisão de 1001 centavos entre três pessoas (334/334/333), dois pagadores, saldo líquido zero, atualização após edição, saldo zero após exclusões e bloqueio de RPCs auxiliares públicas.
- A migration 004 foi aplicada por `supabase migration up --local`. Não houve `db push`, alteração no projeto remoto, uso do `.env.local`, convite enviado ou deploy desta Etapa 4.
- A migration 005 move os helpers de autorização para `private`, atualiza policies/RPCs e revoga EXECUTE público nas assinaturas antigas. `private` precisa ficar fora dos schemas expostos por PostgREST; teste local confirmou erro em RPC pública e ao solicitar o schema `private` pela API.

### Etapa 5 — Saldos e acertos

- [x] Calcular em centavos quanto cada pessoa pagou menos sua parte atribuída; validar integridade das parcelas e soma dos saldos em zero.
- [x] Gerar sugestões determinísticas de transferências entre devedores e credores; a soma sugerida corresponde à dívida líquida.
- [x] Mostrar saldos, explicação e sugestões no grupo; a tela recarrega os dados após a criação/edição/exclusão ao retornar ao grupo.
- [x] Verificar vários pagadores, divisão com resto, edição, exclusão e saldos zero com sessões distintas no Supabase local.
- [x] Na revisão RLS, manter criação para membros e restringir alteração/exclusão a admins; alinhar RPCs, interface e testes.
- [x] Revisar sondagem das funções auxiliares; movê-las para schema interno `private` e bloquear chamadas REST diretas.

**Pronto quando:** o resumo bate com as despesas lançadas e as sugestões de acerto zeram o total líquido. Implementado localmente; build Vite e 37 verificações passaram em 2026-10-08. Sugestões são indicativas e não registram pagamentos. As migrations 004 e 005 estão aplicadas no Supabase São Paulo; a interface será publicada após a confirmação do banco.

#### Revisão de segurança e liberação revisável (2026-10-08)

- **Decisão de papéis:** qualquer membro pode registrar uma despesa; somente admins podem editar ou excluir qualquer despesa do grupo. A regra é verificada no banco em cada RPC e refletida na interface. Admins já são responsáveis por editar o grupo e criar convites. Alterar a regra depois exigiria migration, testes e mudança coordenada do app.
- **Auxiliares de autorização:** o risco de sondagem booleana das RPCs `public.is_current_user_group_member`, `public.is_current_user_group_admin` e `public.can_current_user_view_profile` foi removido para o caminho PostgREST. A migration 005 cria as equivalentes em `private`, aponta policies e RPCs para lá e revoga EXECUTE das assinaturas públicas antigas. O schema `private` recebe `USAGE`/EXECUTE para avaliação de policies, mas não consta como schema exposto no API local; chamadas diretas públicas e seleção explícita de `private` falham nos testes. Não conceder exposição REST a esse schema.
- **Saldos:** `calculateBalances` credita o total ao pagador e debita as parcelas por participante, usando inteiros de centavos. Rejeita referências a pessoas ausentes, parcelas inconsistentes e acúmulos fora do limite inteiro seguro. A soma fecha em zero. `suggestSettlements` faz pareamento determinístico entre devedores/credores, sem criar registros de pagamentos.
- **Testes/build:** a build `tsc -b` + Vite passou com Node 24 empacotado. `scripts/test-local-rls.mjs` passou 37 verificações usando contas sintéticas e sessões anon separadas. Fixture de 1001 centavos para três participantes: 334/334/333. Foram registrados dois pagadores, saldo zero, sugestão integral, atualização de pagador/partilha ao editar e saldo zero após excluir as despesas. A fixture foi removida pelo próprio roteiro. Nenhum uso de `.env.local`.
- **Histórico verificado em modo somente leitura:** destino vinculado `yzxeyqutmvjmrglmpcbb` (SplitUai, São Paulo `sa-east-1`); projeto Virginia `ipbnqofmggytdkgmadtc` não foi consultado nem alterado. Antes da publicação, CLI comparou local/remoto: 001 e 002 constavam nos dois; 004 e 005 somente no local. O commit somente com migrations `8594f99` foi enviado a `main`; a integração aplicou 004/005 e a consulta posterior confirmou 001/002/004/005 local/remoto. Não houve `db push`.
- **Integração:** o painel mantém deploy automático para produção na branch `main`. A documentação oficial do [GitHub integration](https://supabase.com/docs/guides/deployment/branching/github-integration) diz que novos commits no branch de produção aplicam migrations pendentes. `.github/workflows/deploy.yml` também publica Pages em qualquer push a `main`. São processos separados, sem dependência configurada entre eles; um push único não garante banco antes do frontend.
- **Sequência de publicação concluída:** fase 1: commit somente de migrations `8594f99`; a integração Supabase aplicou 004/005 e o histórico remoto foi confirmado. O Pages workflow `37874029710` publicou o frontend anterior. Fase 2: commit `b447871` publicou interface e documentação sem migrations pendentes; Pages workflow `37874511350` concluiu com sucesso. A página pública respondeu HTTP 200 e o bundle contém os textos de saldo e sugestões de acerto. A atualização deste registro de resultado será publicada separadamente, sem alterações de banco.
- **Limitação atual:** não há ambiente de preview Supabase separado disponível para validar as migrations remotamente sem atingir produção. As sugestões de acerto são calculadas no navegador sobre despesas que todos os membros podem ler e não são lançamentos de liquidação.

### Etapa 6 — Acabamento e entrega

- [ ] Tratar estados de carregamento, erro, lista vazia e sessão expirada.
- [ ] Verificar uso em telas pequenas e acessibilidade básica.
- [ ] Revisar permissões RLS, configuração de publicação e ausência de segredos no bundle.
- [ ] Documentar como configurar ambiente, publicar e fazer backup/exportação dos dados.

**Pronto quando:** amigos conseguem usar o app sem assistência técnica, e o dono sabe recuperar/configurar o projeto.

## Andamento atual

- **Status:** Etapas 0–5 publicadas. Build e 37 verificações de RLS/despesas/saldos passaram no Supabase local. Migrations 004/005 foram aplicadas no banco de São Paulo antes do frontend; a publicação frontend `b447871` passou no Pages workflow `37874511350`. A página responde HTTP 200 e serve o bundle novo. Seguem pendentes os testes de convites expirados/revogados e de usuários Auth preexistentes.
- **Projeto alvo (2026-10-08):** `yzxeyqutmvjmrglmpcbb`, SplitUai, São Paulo (`sa-east-1`). O projeto Virginia `ipbnqofmggytdkgmadtc` permanece intocado. GitHub `JotaChina/SplitUai`, produção em `main`; integração Supabase aplica migrations ao push e Pages também publica no push. Histórico confirmado após o commit `8594f99`: 001/002/004/005 aplicadas remoto/local. Nenhum `db push` foi executado.
- **Banco e Auth:** aplicada `supabase/migrations/20261007000100_etapa_2_schema_e_rls.sql`; lint remoto sem erros. Todas as sete tabelas públicas estão com RLS habilitada e políticas explícitas. Teste transacional com dois membros de grupos distintos e um usuário externo retornou apenas grupos/dados autorizados; as linhas sintéticas foram revertidas e sua ausência foi conferida. Auth remoto atualizado para desabilitar cadastro público; URL de retorno aponta para o GitHub Pages. CLI Supabase 2.120.0 vinculada somente ao projeto alvo.
- **Frontend:** login, grupos, participantes, convites, despesas, saldos e sugestões consultam/calculam usando sessão e chave publicável; nenhuma chave secreta foi adicionada. Criação de despesa por qualquer membro; edição/exclusão só por admin. Helpers fora do schema exposto. Sugestões não registram pagamentos.
- **Configuração local:** `.env.local` já está preenchido para o projeto `yzxeyqutmvjmrglmpcbb`; conferidos somente correspondência da URL e presença/formato público da chave, sem exibir seu valor. A tela de login inicializou em `http://127.0.0.1:5173/SplitUai/` com Node 24 do ambiente. O Node global 20.11.1 não inicia o Vite 7 atual. `.gitignore` ignora `.env.local`. Não enviar chaves pelo chat nem usar chave `secret`/`service_role` no frontend.
- **Uso e cobrança (2026-10-07):** o painel confirmou `JotaChina's Org` com um único projeto e plano Free. Com filtro **All projects**, a organização não excedeu a cota no ciclo exibido (08/10/2026–08/11/2026); banco em 0,027/0,5 GB (5%), os outros indicadores visíveis em zero. A página de cobrança confirmou **spend cap habilitado** e nenhuma fatura listada. O painel informa que excedentes não geram cobrança com esse controle ligado, mas podem deixar projetos indisponíveis ou somente leitura. Revalidar limites antes de expandir uso.
- **Convite inicial:** o redirect `http://localhost:5173/**` foi adicionado e verificado. O `bootstrap_invite` foi inserido (expira em sete dias). O primeiro envio falhou; logs registraram `SplitUai accounts are invitation-only`, emitido pela checagem de `invited_at` da função do trigger antes da validação do convite. A função foi corrigida pela migração `20261007000200_fix_invited_auth_user_trigger.sql`, aplicada pelo SQL Editor somente no projeto alvo e depois sincronizada no histórico da CLI após comparação. O segundo envio teve sucesso: o Auth criou o usuário não confirmado e o painel mostrou `Sent invite email`. O Site URL foi restaurado para GitHub Pages. O fluxo manual do painel ainda precisa ser validado para convites criados por admins.
- **Próximos passos:** validar manualmente convites de admin e cobrir convites expirados/revogados/preexistentes. A integração GitHub e os workflows Pages podem publicar novamente em pushes futuros; para migrations, repetir comparação de histórico e confirmar o destino antes de qualquer liberação. Nunca versionar token CLI, senha do banco, chave `secret` ou `service_role`; nunca alterar/apontar o app ao projeto Virginia.

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
