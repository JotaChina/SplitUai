# Amizades entre usuários

## Modelo e estados

Uma relação é armazenada uma única vez por par de usuários, sem direção no índice de unicidade. `pending` significa que o solicitante enviou um pedido ainda não respondido; quem iniciou e quem recebeu ficam registrados em colunas próprias. `accepted` significa amizade ativa. Não há estado persistido de recusado, cancelado ou desfeito: essas ações encerram e removem o pedido ou a amizade. Isso mantém o histórico e os dados de grupos existentes independentes do ciclo de amizade.

| Ação | Quem pode executar | Resultado |
| --- | --- | --- |
| Enviar pedido | Qualquer usuário autenticado, para outro username exato | Cria `pending`; pedido para si mesmo é recusado. |
| Receber pedido | Destinatário | Pedido aparece na lista de recebidos, sem dados de grupos ou e-mail. |
| Aceitar | Destinatário de pedido `pending` | Muda para `accepted`; a relação fica disponível nas listas de amizade dos dois. |
| Recusar | Destinatário de pedido `pending` | Remove o pedido; não cria bloqueio nem altera grupos. |
| Cancelar | Solicitante do pedido `pending` | Remove o pedido; um novo pedido pode ser enviado depois. |
| Desfazer amizade | Qualquer pessoa da amizade `accepted` | Remove a relação; não altera grupos, membros ou convites. |

## Concorrência e privacidade

O par é canonicalizado e tem índice único, e as operações por par são serializadas com advisory lock no PostgreSQL. Pedidos repetidos ou simultâneos não criam linhas duplicadas. Se já existe amizade, o envio é idempotente; se existe um pedido no sentido inverso, ele permanece recebido e aguarda decisão explícita do destinatário.

A procura aceita somente usernames completos e exatos, normalizados, e retorna apenas o identificador interno necessário à operação, username, nome de exibição e avatar. Não retorna e-mail, saldo, nomes/IDs de grupos ou dados de convite. A RPC autenticada aplica um limite por conta no banco; erros de ausência não revelam outros perfis. A UI não consulta `profiles` diretamente para procurar pessoas.

As tabelas têm RLS e não permitem escrita direta pelo cliente. RPCs `SECURITY DEFINER` verificam `auth.uid()` e o papel da pessoa em cada transição; apenas as rotinas necessárias são executáveis por `authenticated`. Relações podem ser listadas somente pelos próprios participantes.

## Convites para grupos

Em grupos onde a pessoa atual é admin, amizades aceitas aparecem como atalhos no formulário de convite. O banco confirma a amizade e o papel de admin, resolve o e-mail internamente e cria o convite existente; o cliente não recebe o e-mail por essa operação. A entrega usa o fluxo seguro de e-mail já existente. A pessoa ainda precisa aceitar o convite do grupo. Recusar/desfazer uma amizade não adiciona nem remove membros, e convites já enviados continuam sujeitos às regras próprias de convite.

## Migração e compatibilidade

A migration acrescenta tabelas e funções ao domínio de grupos existente, sem reescrever ou remover associações e convites. O atalho de convite cria registros através da rotina segura de convite já instalada e não insere em `group_members`. A aplicação depende de usernames já definidos; perfis sem username permanecem válidos e não aparecem em busca até que escolham um. A cadeia deve ser validada apenas num Supabase local/isolado antes de qualquer implantação.
