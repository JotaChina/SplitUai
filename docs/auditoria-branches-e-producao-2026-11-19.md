# Auditoria de branches e estado remoto — 2026-11-19

## Escopo e limites

Esta auditoria foi feita sobre os dados remotos do GitHub em 19/11/2026. O checkout local não pôde ser consultado nesta sessão porque o terminal do ambiente falhou ao iniciar. Portanto, este documento não declara o repositório local sincronizado, nem certifica o estado atual da publicação Pages ou do banco Supabase.

## Branches remotas

| Branch | Situação verificada | Ação recomendada |
| --- | --- | --- |
| `main` | Branch principal. Contém os PRs #1 a #3 e #5 integrados. | Manter como referência de integração. |
| `codex/melhorias-splituai` | PR #1 integrado: categorias e despesas recorrentes. | Candidata a remoção após comparar o SHA remoto e confirmar ausência de commits exclusivos. |
| `codex/balances-and-settlement-default` | PR #2 integrado: saldo mensal e acerto padrão. | Candidata a remoção após comparar o SHA remoto e confirmar ausência de commits exclusivos. |
| `feat/direct-charges` | PR #3 integrado: cobranças entre amizades e rateios. O PR relata migração inicial aplicada e verificada no Supabase; não comprova teste ponta a ponta com duas contas reais. | Candidata a remoção após comparar o SHA remoto e confirmar ausência de commits exclusivos. |
| `ci/detailed-direct-db` | PR #5 integrado: adicionou workflow manual e artefatos de migração detalhada. A integração do workflow não significa que a migração foi executada. | Candidata a remoção após comparar o SHA remoto e confirmar ausência de commits exclusivos. |
| `feat/detailed-direct-expenses` | PR #4 aberto contra `main`; dois commits à frente e um atrás no momento da consulta. Inclui UI e migração detalhada; o PR instrui aplicar a migração `20261118000300` antes de integrar o frontend. | Revisar CI, diff atual, estado da migração em produção e teste funcional antes de integrar. |

A consulta retornou seis branches remotas. A branch `docs/project-governance-audit` foi criada para esta documentação e, portanto, passa a ser uma branch de trabalho adicional.

## Estado das funcionalidades

- Cobranças diretas básicas entre amizades estão integradas em `main` pelo PR #3. A descrição desse PR afirma que a migração `20261118000200` foi aplicada e verificada por workflow manual.
- Despesas detalhadas e novos modos de rateio estão no PR #4, ainda aberto na consulta. A interface não deve ser considerada disponível em produção somente porque existe uma branch ou migration.
- O PR #5 integrou um workflow manual para executar uma migration; não é evidência de que esse workflow foi executado.
- O README remoto consultado em `main` ainda descreve cobranças diretas como “Em desenvolvimento” e informa que a integração na navegação principal está pendente. Isso está desatualizado em relação à integração do PR #3 e deve ser revisado após confirmar o build e o site efetivamente publicado.
- O README também afirma que certas capacidades refletem o código local; isso não é confirmação de equivalência entre código local, `main` e produção.

## Próximos passos para concluir a auditoria

1. No checkout local, registrar `git status --short --branch`, `git branch -avv` e `git log --graph --oneline --decorate --all`. Guardar as mudanças locais antes de atualizar referências.
2. Buscar referências remotas sem fazer reset, checkout destrutivo, limpeza ou force-push.
3. Comparar cada branch integrada com `main`. Excluir somente branches remotas que não tenham commits únicos e depois de confirmar que ninguém depende delas.
4. Revisar o diff atual do PR #4 e os resultados de CI.
5. Confirmar no Supabase o registro da migration `20261118000300` e as funções/constraints esperadas. Não inferir execução a partir do workflow integrado.
6. Conferir a execução mais recente do GitHub Pages e testar o site hospedado, incluindo fluxo entre duas contas.
7. Corrigir README e documentos redundantes usando `main` como fonte de verdade após a validação acima.

## Participação de Codex

O commit `8648c275505b244ab2ad188cb65f735b168ac854`, integrado no PR #5, contém o trailer `Co-authored-by: Codex <codex@openai.com>`. A atribuição decorre desse trailer, não da existência de uma branch local chamada `codex/...`.

Remover a coautoria do commit já integrado requer reescrever o commit/histórico e atualizar a branch compartilhada `main`. Isso pode alterar SHAs, afetar clones e workflows e exige coordenação. Não foi feito nesta auditoria. A remoção deve ser planejada como operação separada, com backup da referência anterior, confirmação de proteção da branch e autorização para reescrever o histórico.
