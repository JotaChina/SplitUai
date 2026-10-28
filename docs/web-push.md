# Web Push e central de avisos

## Caminho publicado

O Vite publica sob `/SplitUai/`. `public/sw.js` vira `/SplitUai/sw.js` e é registrado com escopo `/SplitUai/`; o manifesto, ícone e links de início também usam esse caminho. A inscrição do service worker tem de ficar na mesma origem e dentro do escopo, como ocorre no GitHub Pages do projeto.

## Eventos e autorização

A migration `20261026000300_notificacoes_web_push.sql` cria `notifications` e `web_push_subscriptions` com RLS. O usuário lê e marca como lidos somente os próprios avisos; o cliente não pode inserir ou apagar avisos. Triggers server-side geram eventos de amizade, convites de grupo, despesas e acertos. Os eventos são deduplicados por chave única. Só acertos `paid` notificam; um acerto pendente não é pagamento. O total compara o valor pago com a obrigação líquida ainda em aberto entre as duas pessoas; se ainda resta obrigação, é parcial. O servidor materializa convites expirados ao abrir a caixa de convites e emite a atualização ao remetente uma vez.

Convites para amizades já cadastradas são direcionados ao ID da conta e ficam em **Convites recebidos** até a pessoa aceitar. Esse caminho não consulta nem envia o e-mail dela. Convites por e-mail continuam disponíveis para pessoas que ainda não têm conta.

Uma inscrição Push é associada ao `auth.uid()` da sessão e contém endpoint/chaves do navegador. Cada usuário pode manter vários dispositivos. A Edge Function `send-web-push` envia o mesmo texto genérico para cada inscrição, remove endpoints que respondem 404/410 e não aceita identidade informada pelo navegador para escolher o destinatário. A inscrição pode ser desativada na central deste dispositivo; revogar a permissão no navegador também impede entregas futuras.

## Configuração necessária para habilitar Push

O ambiente local usa um par VAPID e um segredo próprios em `supabase/functions/.env`; mantenha esse arquivo fora do Git.

1. Gere um par VAPID fora do repositório. Configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` como secrets da Edge Function (`mailto:` ou URL de contato). Configure somente a chave pública como `VITE_VAPID_PUBLIC_KEY` no ambiente de build do frontend.
2. Gere `PUSH_WEBHOOK_SECRET` aleatório e configure-o como secret da função.
3. No modo local, `iniciar-teste-local.bat` aplica as migrations e `scripts/configure-local-push.mjs` valida o par VAPID, copia a chave pública para `.env.local` e grava o segredo do webhook no banco local. Um trigger usa `pg_net` para chamar a função local após cada novo aviso. Para outro ambiente, aplique as migrations e configure um Database Webhook para `INSERT` em `public.notifications`, apontando para `/functions/v1/send-web-push`, com o header `x-push-webhook-secret: <PUSH_WEBHOOK_SECRET>`.
4. Ative **Avisos → Ativar neste dispositivo** em cada celular/navegador que deve receber notificações. Sem uma inscrição Push, os avisos ainda ficam na central.
5. Para avisos de expiração sem depender de alguém abrir o app, habilite Supabase Cron no ambiente e agende `select public.expire_group_invitations();` (por exemplo, de hora em hora). A função só atualiza convites que venceram; a transição cria o aviso ao remetente uma única vez. A caixa do convidado também materializa expirações ao ser aberta.
6. O gateway da função tem `verify_jwt = false` porque o webhook usa o segredo dedicado; chamadas de usuários passam por validação de sessão dentro da função.

Não coloque chave privada, secret da service role ou segredo de webhook em `VITE_*`, no Git ou no manifesto. A configuração do webhook e das chaves descrita acima é somente local; não altera o projeto de produção.

## Permissão, suporte e aparência

Permissão negada ou não concedida não esconde nem apaga os avisos: eles permanecem na central com data, estado lido/não lido e destino. Em navegadores sem Service Worker/Push, a central continua disponível. Desativar uma inscrição remove este dispositivo da conta; a pessoa pode reativá-la por ação explícita. A revogação de endpoint inválido é automática após resposta 404/410 do serviço Push.

No iPhone/iPad, a pessoa precisa adicionar a web app à Tela de Início para receber Web Push. A aparência do aviso e do ícone na tela bloqueada depende do navegador e do sistema operacional. Não há promessa de entrega em relógios: ela depende do espelhamento e das configurações do telefone e do relógio. Os avisos do sistema usam texto genérico e não expõem valores, descrições ou nomes de grupos.
