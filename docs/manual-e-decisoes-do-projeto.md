# Manual do projeto e decisões operacionais

## Produto

SplitUai é uma aplicação web para registrar e acompanhar despesas compartilhadas entre pessoas e grupos. As principais entidades incluem usuários autenticados, amizades, grupos, despesas, rateios, acertos, avisos e anexos.

## Arquitetura confirmada

- Frontend: React 19, TypeScript e Vite.
- Serviços: Supabase Auth, PostgreSQL, Row Level Security (RLS), RPCs, Storage, Realtime e Edge Functions.
- Publicação do frontend: GitHub Pages por GitHub Actions, a partir de `main`.
- O frontend acessa Supabase usando URL e chave publicável. Segredos administrativos, `service_role`, token de administração Supabase e chave privada VAPID não podem ser incluídos no bundle do frontend.

## Decisões de domínio e segurança

- Valores monetários são representados em centavos inteiros; rateios precisam tratar arredondamento sem perder nem criar centavos.
- O banco deve aplicar autorização para operações sensíveis. Esconder botões no frontend não é controle de acesso suficiente.
- RLS e funções RPC devem restringir acesso a participantes autorizados.
- Cobranças diretas básicas são independentes dos saldos de grupos. Pagamentos acontecem fora do app; o app registra estados e evidências, mas não movimenta dinheiro.
- Desfazer uma amizade bloqueia novas cobranças, mas preserva o histórico existente, segundo a documentação da feature básica.
- Push depende de configuração, inscrição e permissões do dispositivo; Realtime e mecanismos de recuperação complementam Push, não são garantia de entrega.
- Migrations devem ser pequenas, versionadas, revisáveis e compatíveis com dados existentes. Deploy do frontend não aplica migrations automaticamente.

## Fluxo de trabalho obrigatório

1. Verificar `git status`, branch atual, upstream, branches locais/remotas e commits antes de qualquer edição.
2. Ler README, documentação pertinente, migrations e workflows relacionados à tarefa.
3. Preservar todas as mudanças não commitadas. Não executar reset, clean, checkout forçado, rebase destrutivo ou substituição ampla de arquivos sem cópia e revisão.
4. Identificar separadamente: trabalho local, commits na branch de trabalho, PR aberto, conteúdo em `main`, frontend publicado e migrations aplicadas no Supabase.
5. Criar branch de trabalho e PR para integração em `main`. Não publicar diretamente na branch principal, salvo processo explicitamente autorizado e seguro.
6. Executar build e testes relevantes e comunicar seus resultados reais. Não afirmar sucesso sem saída verificável.
7. Antes de deploy de frontend, migration ou alteração de configuração de produção, obter autorização explícita para aquela operação e verificar os pré-requisitos.
8. Depois de uma migration, verificar o registro e objetos esperados no banco. Workflow presente ou PR integrado não comprova execução.
9. Ao concluir, resumir arquivos alterados, testes, integração, publicação e pendências.

## Regras de autoria e histórico

- Não adicionar `Co-authored-by: Codex` nem atribuir participação a assistentes sem autorização explícita.
- Não alterar autoria de commits existentes, reescrever `main`, fazer force-push ou excluir branches sem apresentar o impacto e obter autorização específica.
- Branch integrada só pode ser removida após comparar seu HEAD com `main` e confirmar que não contém commits únicos ou trabalho ainda referenciado por alguém.
- Preferir remover branches obsoletas depois da integração do PR, conforme política do repositório.

## Estrutura documental sugerida

- `README.md`: apresentação, funcionalidades que estejam realmente disponíveis e instruções rápidas.
- `docs/decisoes-e-manual.md`: regras de produto, arquitetura, segurança e fluxo de trabalho.
- `docs/estado-de-producao.md`: versão publicada, migrations aplicadas e evidências, com data de verificação.
- `docs/`: guias específicos por funcionalidade e procedimentos de operação.
- Workflows em `.github/workflows/` devem indicar explicitamente se são validação, deploy de frontend ou operação manual de banco.

## Limites do estado documentado

Este manual registra decisões e arquitetura observadas nos arquivos e dados remotos consultados em 19/11/2026. Não certifica a situação atual do checkout local, execução de workflows, estado do site hospedado ou esquema do Supabase. Atualize `docs/estado-de-producao.md` somente após obter evidência direta e datada.
