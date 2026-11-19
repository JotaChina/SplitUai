<div align="center">
  <img src="public/brand/splituai-graffiti.png" alt="SplitUai" width="380" />

# SplitUai

**Divida a conta. Organize os acertos. Curta o rolê.**

Despesas compartilhadas para a viagem, a república, as contas de casa e os encontros com a turma.

[Acessar o SplitUai](https://jotachina.github.io/SplitUai/) · [Funcionalidades](#funcionalidades) · [Rodar localmente](#rodar-localmente)

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?logo=supabase&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-instalável-ec4899)

</div>

---

Quem pagou o mercado? Quanto ficou para cada pessoa? E aquela parcela do mês que vem?

O **SplitUai** reúne os gastos do grupo, calcula a participação de cada pessoa e mostra quem precisa acertar com quem. Tudo em português, com valores em reais e uma interface que funciona no computador e no celular.

> **Acesso por convite:** o cadastro público está desabilitado na configuração atual. Para entrar, é necessário ter uma conta ou receber um convite pelo fluxo da aplicação.

## Funcionalidades

### 🧾 Cada despesa, do seu jeito

- **Rateio igual, por percentual ou por valor personalizado**, escolhendo quem participa de cada gasto.
- **Despesas parceladas**, com prévia da divisão e do vencimento de cada parcela.
- **Despesas recorrentes** para organizar compromissos que se repetem.
- **Categorias** para alimentação, hospedagem, contas da casa, transporte, lazer e outros gastos.
- **Sugestão de categoria pela descrição**, com liberdade para ajustar manualmente.
- **Favoritos de despesas e rateios por grupo**, para reaproveitar configurações frequentes.
- Registro de pagador, data e observações, com edição e exclusão conforme as permissões.

### 🤝 Contas claras entre a turma

- **Saldo mensal e saldo de todo o período** para acompanhar o que cada pessoa deve ou tem a receber.
- **Sugestões de acerto** para orientar os pagamentos entre participantes.
- **Pagamentos totais ou parciais**, com acertos pendentes e confirmação de pagamento.
- Registro da forma de pagamento: Pix, dinheiro, transferência, cartão ou outro meio.
- **Chave Pix opcional no perfil**, disponível conforme as regras de acesso da aplicação.

O SplitUai registra despesas e acertos. Os pagamentos são realizados fora da aplicação.

### 👥 Grupos, perfis e amizades

- Grupos com nome, descrição, capa e ícone personalizados.
- Administração de participantes, papéis e convites.
- **Arquivamento e restauração de grupos**, preservando histórico e saldos.
- Perfis com foto, nome de exibição e identificador `@username`.
- **Busca por username exato** e pedidos de amizade, com aceite, recusa e cancelamento.
- Ações de amizade ao abrir o perfil de outra pessoa.
- **Convites de grupo para amizades aceitas**, além do fluxo por e-mail.

### 📊 Do lançamento à visão geral

- **Gráficos por categoria e evolução dos gastos** para entender o uso do dinheiro.
- Filtros por período e categoria para explorar as despesas.
- **Exportação CSV** de despesas e acertos do período selecionado.
- **Importação do histórico do Splitwise via CSV**, com prévia e validações, disponível na visão de administração do grupo.

### 🔔 Avisos e experiência no celular

- **Central de avisos** com histórico e indicação de lidos e não lidos.
- Atualização da central por **Supabase Realtime**, com recuperação de avisos ao retomar a conexão ou voltar ao app.
- **Web Push por dispositivo**, mediante configuração do servidor e permissão do usuário.
- **PWA instalável**, com atalho na tela inicial e abertura em janela própria nos ambientes compatíveis.
- Interface responsiva, modo claro ou escuro e cores de destaque em verde, vermelho ou rosa.

A entrega de Push depende do navegador, da conexão e das configurações do sistema. No iPhone/iPad, adicione o SplitUai à Tela de Início antes de ativar os avisos. A instalação como PWA não oferece operação financeira offline; o acesso aos dados depende do Supabase.

## Um exemplo na prática

1. Crie um grupo para a viagem e convide os participantes.
2. Registre a hospedagem, o combustível e o mercado, indicando quem pagou cada gasto.
3. Escolha a divisão de cada despesa: igual para todos, percentual ou valores individuais.
4. Consulte os saldos e as sugestões de acerto.
5. Depois do pagamento, registre ou confirme o acerto para atualizar os saldos.

## Como os saldos funcionam

Os valores são tratados em **centavos**, com regras de arredondamento para manter os rateios consistentes.

- O saldo do mês considera despesas da competência que continuam devidas no saldo geral.
- Parcelas afetam o saldo mensal no mês de vencimento de cada parcela.
- Acertos pagos ajustam o saldo de todo o período; acertos pendentes não alteram saldos.
- O formulário de acerto sugere o valor para quitar a dívida e permite pagamentos parciais.
- No histórico importado do Splitwise, despesas e pagamentos permanecem em registros separados.

## Em desenvolvimento

**Cobranças diretas entre amizades aceitas, sem criar um grupo:** esta cópia do projeto já contém uma migration, funções de acesso e componentes para esse fluxo. A integração com a navegação principal ainda está pendente, portanto o recurso não é apresentado aqui como disponível na interface atual.

As funcionalidades descritas neste README refletem o código local. A disponibilidade no site depende da versão publicada e da configuração do backend.

## Tecnologias

| Camada | Tecnologias e responsabilidade |
| --- | --- |
| Interface | React 19 e TypeScript |
| Desenvolvimento e build | Vite 7 |
| Autenticação | Supabase Auth |
| Banco de dados | PostgreSQL, migrations SQL e funções RPC |
| Controle de acesso | Row Level Security (RLS) e validações no servidor |
| Imagens | Supabase Storage |
| Atualizações de avisos | Supabase Realtime |
| Serviços no servidor | Supabase Edge Functions |
| Instalação e Push | Web App Manifest, Service Worker e Web Push com VAPID |
| Publicação do frontend | GitHub Pages via GitHub Actions |

## Rodar localmente

### Pré-requisitos

- Node.js **22.12 ou superior** e npm.
- Um projeto Supabase próprio ou uma instância local com as migrations e funções necessárias.
- Para executar o Supabase local: Docker em execução e Supabase CLI, incluída nas dependências do projeto.

### Iniciar o frontend

```bash
git clone https://github.com/JotaChina/SplitUai.git
cd SplitUai
npm ci
```

Copie `.env.example` para `.env.local` e preencha as configurações do seu ambiente de desenvolvimento:

```dotenv
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sua-chave-publicavel
VITE_VAPID_PUBLIC_KEY=sua-chave-vapid-publica
```

A chave VAPID pública é opcional para iniciar o frontend e necessária para habilitar Push. A URL e a chave publicável do Supabase são necessárias para autenticar e acessar os dados.

```bash
npm run dev
```

Abra **http://127.0.0.1:5173/SplitUai/**. O caminho base configurado no Vite é `/SplitUai/`.

O comando inicia o frontend; a preparação do banco, das funções e do acesso por convite é feita separadamente no Supabase. Configure também as URLs de redirecionamento de autenticação para o endereço de desenvolvimento utilizado.

### Testar Supabase local e Push

No Windows, o projeto inclui o atalho [`iniciar-teste-local.bat`](iniciar-teste-local.bat), que prepara HTTPS, inicia o Supabase local, aplica migrations locais e abre os serviços de desenvolvimento. Antes de executá-lo, revise o IP de rede configurado e os requisitos de certificados e chaves do roteiro.

Consulte o [roteiro de testes e configuração das notificações](docs/roteiro-notificacoes-producao.md) e os [detalhes de Web Push](docs/web-push.md).

### Comandos disponíveis

| Comando | Finalidade |
| --- | --- |
| `npm run dev` | Inicia o servidor de desenvolvimento |
| `npm run build` | Verifica TypeScript e gera o frontend em `dist/` |
| `npm run preview` | Serve o build local para conferência |
| `npm run test:notifications` | Executa as verificações de notificações |
| `npm run validate:category-suggestions` | Valida as sugestões de categoria |

## Estrutura do projeto

| Caminho | Conteúdo |
| --- | --- |
| `src/App.tsx` | Telas, navegação e fluxos principais |
| `src/components/` | Componentes extraídos e novos fluxos de interface |
| `src/lib/` | Integração Supabase, cálculos, importação e hooks de notificações |
| `public/` | Identidade visual, ícones, manifesto e service worker |
| `supabase/migrations/` | Evolução do banco, regras de acesso e funções SQL |
| `supabase/functions/` | Edge Functions de autenticação, convites e Push |
| `scripts/` | Preparação do ambiente e verificações técnicas |
| `docs/` | Documentação de amizades e notificações |
| `.github/workflows/deploy.yml` | Build e publicação no GitHub Pages |

## Configuração e publicação

O workflow publica o frontend no GitHub Pages após atualizações na branch `main` e também permite execução manual. O build utiliza estas variáveis do ambiente GitHub **SplitUai**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_VAPID_PUBLIC_KEY`

O workflow atual exige as três variáveis e executa as verificações de notificações antes do build. Migrations, Edge Functions e secrets do Supabase precisam ser configurados separadamente; publicar o frontend não atualiza o backend.

Use somente configurações públicas nas variáveis `VITE_*`. Chaves `service_role`, chaves privadas VAPID e segredos de webhook pertencem ao servidor e devem ficar fora do frontend e do Git. Arquivos `.env.local` são ignorados pelo repositório.

## Saiba mais e participe

- [Regras de amizades e convites](docs/amizades.md)
- [Arquitetura e configuração do Web Push](docs/web-push.md)
- [Roteiro de testes e preparação das notificações](docs/roteiro-notificacoes-producao.md)
- [Reportar um problema ou sugerir uma melhoria](https://github.com/JotaChina/SplitUai/issues)

Ao propor uma mudança, descreva o cenário de uso, o comportamento esperado e os passos para reproduzir o problema. Para alterações de código, valide o build e as verificações relacionadas ao fluxo alterado.

---

<div align="center">

**SplitUai — as contas em dia, a amizade também.**

Desenvolvido por [JotaChina](https://github.com/JotaChina).

</div>
