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
- [ ] Criar um novo projeto Supabase no plano Free e região São Paulo (`sa-east-1`), confirmando cota e total US$ 0; manter o projeto existente da Virginia sem alterações.
- [ ] Conectar/configurar o repositório GitHub e habilitar publicação por GitHub Actions para Pages.

**Pronto quando:** as escolhas estão anotadas, o repositório tem a aplicação inicial e os serviços externos foram criados sem segredos no código.

### Etapa 1 — Esqueleto visual

- [x] Criar aplicação frontend com configuração para caminho de projeto do GitHub Pages.
- [x] Montar navegação e telas iniciais: entrar, grupos, detalhe do grupo e formulário de despesa (dados demonstrativos locais).
- [x] Criar identidade visual simples, responsiva e acessível como primeira versão.
- [ ] Publicar uma primeira versão estática no Pages.

**Pronto quando:** a URL do Pages abre a aplicação e a navegação básica funciona em desktop e celular.

### Etapa 2 — Banco e autenticação

- [ ] Criar migrações SQL para tabelas, restrições, índices e relações.
- [ ] Configurar autenticação por e-mail/senha (ou escolher outro método adequado ao grupo).
- [ ] Implementar entrada, saída e estado de sessão.
- [ ] Configurar políticas RLS e privilégios mínimos para cada tabela.
- [ ] Criar contas de teste e verificar que usuário fora do grupo não acessa seus dados.

**Pronto quando:** usuários conseguem entrar e as regras de acesso são aplicadas pelo banco, inclusive em chamadas diretas à API.

### Etapa 3 — Grupos e participantes

- [ ] Criar grupo.
- [ ] Listar grupos dos quais a pessoa participa.
- [ ] Adicionar participantes de forma controlada.
- [ ] Mostrar participantes e permissões no detalhe do grupo.

**Pronto quando:** dois usuários de teste veem o mesmo grupo compartilhado e um terceiro usuário não consegue acessá-lo.

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

- **Status:** Etapa 0 parcialmente concluída: projeto Supabase existente identificado, novo projeto São Paulo condicionado à cota Free; Etapa 1 implementada localmente, aguardando repositório remoto e publicação.
- **Concluído nesta continuação:** região alvo São Paulo aceita pelo usuário, desde que no plano Free; registrados limites de cota e pausa por inatividade; identificada a restrição GitHub Pages para repositório privado; passos de criação e push documentados.
- **Limites atuais:** telas demonstrativas, sem login/persistência. O Git local está em `main`, ainda sem commits, remoto ou identidade de autoria configurados. `JotaChina/SplitUai` não existe. O Brave não está disponível para automação nesta sessão. Projeto alvo em São Paulo ainda não foi criado nem vinculado à CLI.
- **Decisões registradas:** React + TypeScript + Vite; português/BRL; entrada por convite controlado; GitHub Pages via Actions; criar o projeto alvo Supabase em São Paulo (`sa-east-1`) somente no Free/US$ 0; manter o projeto Virginia (`ipbnqofmggytdkgmadtc`, `us-east-1`) sem alterações.
- **Próxima etapa recomendada:** o usuário cria o novo projeto Supabase com organização Free, região São Paulo e total US$ 0; o usuário cria `JotaChina/SplitUai` no GitHub com visibilidade compatível com o plano e executa os comandos de Git do README. Depois, vincular a CLI, habilitar Pages e fazer o primeiro deploy.

## Registro de decisões

| Data | Decisão | Estado |
|---|---|---|
| 2026-10-07 | Hospedar frontend no GitHub Pages e usar backend gerenciado para autenticação e dados compartilhados. | Confirmado como direção do projeto |
| 2026-10-07 | Supabase é o backend escolhido para autenticação e dados relacionais. | Confirmado; projeto e região ainda precisam ser configurados |
| 2026-10-07 | Criar um novo projeto Free em São Paulo (`sa-east-1`) por proximidade dos usuários, desde que a tela confirme custo US$ 0 e haja cota. | Confirmado pelo usuário; criação ainda pendente |
| 2026-10-07 | Registrar o projeto Supabase existente `ipbnqofmggytdkgmadtc`, em `us-east-1` (East US / North Virginia). | Projeto saudável conforme captura do usuário; ref e URL pública registradas, sem segredos |
| 2026-10-07 | Manter o projeto existente da Virginia sem alterações e não apontar o SplitUai para ele. | Confirmado como caminho enquanto um projeto novo em São Paulo é criado |
| 2026-10-07 | O deploy Pages usará GitHub Actions com `configure-pages`, `npm ci` e artefato `dist`. | Workflow local pronto; remoto GitHub e primeira publicação pendentes |
| 2026-10-07 | O produto é para uso pessoal e amigos próximos, sem pagamentos integrados. | Confirmado |
| 2026-10-07 | Usar React + TypeScript + Vite, idioma português e valores em BRL. | Confirmado; scaffold criado |
| 2026-10-07 | Manter a entrada controlada por convite do administrador, sem cadastro público. | Confirmado; interface ainda demonstrativa |

## Notas operacionais

- Planos gratuitos e limites dos provedores podem mudar; verificar os limites atuais ao criar/configurar as contas.
- O Supabase Free pode pausar projetos com pouca atividade. Planejar como reativar e exportar os dados.
- Um frontend publicado é público por natureza; a privacidade depende da autenticação e, principalmente, das políticas RLS corretas.
- Atualizar este documento ao fechar decisões ou concluir cada etapa. Manter o status da próxima etapa acionável.
