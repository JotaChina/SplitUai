# Roteiro de Web Push: desenvolvimento primeiro, produção depois

## Objetivo e cotas

Vamos validar primeiro no Supabase local se o SplitUai mostra a notificação interna em tempo real com o app aberto e entrega Web Push com o app fechado. Depois de aprovado, repetimos a configuração de secrets e webhook no Supabase de produção.

Web Push não tem uma tarifa por notificação cobrada pelo serviço de Push do navegador. Isso não significa uso ilimitado do Supabase: cada aviso ainda é gravado no banco; atualizações em tempo real usam mensagens Realtime; com Push ativo, cada aviso também chama `send-web-push` uma vez, independentemente de quantos dispositivos do usuário serão tentados. A entrega ao dispositivo é de melhor esforço e depende do navegador, do sistema operacional, da conectividade e das preferências de bateria/notificação.

Na documentação oficial consultada em 29/10/2026, o plano Free lista 500 mil invocações de Edge Functions e 2 milhões de mensagens Realtime por mês, além de cotas de banco, egress e conexões. Confirme os valores atuais em **Organization → Usage** antes do lançamento, pois as cotas podem mudar. Referências: [cobrança e cotas](https://supabase.com/docs/guides/platform/billing-on-supabase), [uso de Realtime](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages), [uso de Edge Functions](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations).

## Estado do projeto local

O repositório já tem o fluxo local preparado: `iniciar-teste-local.bat` inicia o Supabase local, aplica migrations somente ao banco local, configura a função Push, prepara contas de teste e abre o app por HTTPS. O arquivo local `supabase/functions/.env` contém as quatro variáveis esperadas (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_WEBHOOK_SECRET`); os valores não foram exibidos nem copiados. O próprio script valida o par VAPID antes de continuar.

## Roteiro 1 — validar no ambiente de desenvolvimento

### Iniciar

1. Abra o Docker Desktop.
2. Feche janelas antigas do Vite e do Supabase local para liberar a porta 5173.
3. Execute `iniciar-teste-local.bat` por duplo clique, na raiz do repositório. Ele usa o Supabase local, não o projeto remoto. Não use `npm run dev` sozinho para este teste: a configuração de backend local e o HTTPS são preparados pelo atalho.
4. Mantenha abertas as janelas **SplitUai - funcoes locais** e **SplitUai - teste HTTPS**.
5. Abra `https://192.168.3.140:5173/SplitUai/` (ou o endereço/IP que o atalho indicar). No celular, instale/confie o certificado raiz indicado no README antes de abrir a URL. Nunca copie `rootCA-key.pem`.
6. Entre com as contas locais documentadas no README (`teste`, `teste2`, `teste3`). Essas contas são exclusivas do banco local.

### Testar Push com o app aberto

1. Na conta que vai receber, abra **Avisos → Ativar neste dispositivo** e permita notificações do sistema.
2. Em outro navegador ou dispositivo, entre com outra conta de teste.
3. Envie um pedido de amizade de `@teste3` para `@teste` ou `@teste2`.
4. Confirme que a central recebe o aviso sem recarregar, o contador de não lidos atualiza e o sistema mostra a notificação Push. O texto do Push é genérico por privacidade.
5. Abra a notificação e confirme que o SplitUai navega para o destino correto.

### Testar com o app fechado

1. Mantenha a conta receptora inscrita no Push e permita notificações no sistema operacional.
2. Feche a aba ou o app instalado por completo; não basta apenas deixar a central aberta em segundo plano.
3. Com outra conta de teste, gere um novo pedido de amizade ou convite.
4. Confirme se o sistema operacional exibe o Push e se tocar nele reabre o SplitUai no destino. Teste preferencialmente em celular; políticas de navegador/desktop podem exigir que o navegador continue ativo em segundo plano.
5. Reabra o SplitUai e confirme que o mesmo aviso também está salvo na central.

### Resultado e diagnóstico

- Com app aberto: central e contador atualizam via Realtime; Push do sistema pode aparecer em paralelo.
- Com app fechado: o Push pode acordar o service worker e exibir uma notificação; o histórico permanece na central.
- Se a central atualizar, mas não houver Push, confira a janela **SplitUai - funcoes locais** para erros da função, confirme a permissão do sistema e se o dispositivo aparece como inscrito.
- Se nem a central nem o Push atualizarem, confirme que os dois serviços locais continuam abertos e que as contas estão usando a URL HTTPS local.
- Não teste lançando despesas ou acertos que representem transações reais. Use pedido de amizade e convite de grupo.

## Roteiro 2 — preparar produção após aprovação do teste local

O projeto remoto é `yzxeyqutmvjmrglmpcbb` e o site publicado usa o caminho `/SplitUai/`. A documentação do projeto registra migrations e funções de notificações publicadas; as chaves VAPID e o webhook de produção ainda precisam ser configurados.

1. Confirme em **Organization → Usage** o plano e o uso atual de Realtime, Edge Functions, banco e egress.
2. No projeto Supabase de produção, abra **Edge Functions → Secrets** e configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` ou URL de contato) e `PUSH_WEBHOOK_SECRET`. Gere outro par VAPID para produção; não reutilize o par local.
3. No projeto de produção, abra **Database → Webhooks** e crie um webhook HTTP `POST` para `public.notifications`, evento `INSERT`, URL `https://yzxeyqutmvjmrglmpcbb.supabase.co/functions/v1/send-web-push`, com header `x-push-webhook-secret` igual a `PUSH_WEBHOOK_SECRET`.
4. No GitHub, abra **Settings → Environments → SplitUai → Environment variables** e configure somente `VITE_VAPID_PUBLIC_KEY` com a chave pública de produção.
5. Execute o workflow de GitHub Pages e confirme o build/deploy concluído.
6. Ative **Avisos → Ativar neste dispositivo** em cada aparelho. No iPhone/iPad, primeiro adicione a web app à Tela de Início.
7. Faça um teste controlado com duas contas e confirme aviso no app aberto e fechado, logs da função, estado do webhook e uso no painel.

Nunca coloque chave privada ou segredo do webhook em `VITE_*`, no Git, no manifesto ou no chat. O service worker/Push do navegador não garante prazo exato de entrega nem notificação em relógio. Consulte [Edge Function Secrets](https://supabase.com/docs/guides/functions/secrets) e [Database Webhooks](https://supabase.com/docs/guides/database/webhooks).

## Prompts prontos

### 1. Acompanhar teste local

> Vamos testar o Web Push do SplitUai somente no ambiente local, antes de produção. Siga o roteiro 1 de `docs/roteiro-notificacoes-producao.md` e o README. Confirme que o destino é o Supabase local e que as variáveis locais existem, sem revelar valores. Oriente o teste com as contas locais e eventos de amizade/convite. Não use nem altere o projeto remoto, não crie dados financeiros de teste e não exponha secrets. Ajude a diagnosticar pelos logs locais se a central atualizar e o Push não chegar.

### 2. Investigar falha de Push no ambiente local

> O teste local do Web Push falhou. Revise `iniciar-teste-local.bat`, `scripts/configure-local-push.mjs`, `supabase/functions/send-web-push/index.ts`, `public/sw.js` e a janela de logs que vou informar. Investigue primeiro sem alterar produção e sem revelar secrets. Separe falhas de permissão/service worker, inscrição no banco, trigger/webhook local, função VAPID e entrega do navegador. Proponha a menor correção e aguarde antes de fazer qualquer alteração de código.

### 3. Preparar produção depois do teste aprovado

> O Web Push foi validado localmente e quero preparar produção no projeto SplitUai `yzxeyqutmvjmrglmpcbb`. Siga o roteiro 2 de `docs/roteiro-notificacoes-producao.md`. Primeiro confira por leitura a função publicada, migrations e se já existe webhook `INSERT public.notifications`; não crie duplicados. Não revele nem peça secrets no chat. Prepare os campos exatos para eu cadastrar VAPID e `PUSH_WEBHOOK_SECRET` no painel Supabase e somente a chave pública no Environment GitHub. Antes de qualquer alteração remota, mostre a checklist e espere minha autorização.

### 4. Validar publicação de produção

> As chaves de produção foram cadastradas diretamente nos painéis e o site foi publicado. Faça uma validação sem exibir secrets: confirme que o app servido contém a chave pública, que o webhook `INSERT public.notifications` aponta para `send-web-push`, que a função registra entregas sem erro e que o uso está dentro das cotas. Oriente um teste com duas contas de teste, primeiro com o app aberto e depois fechado. Não crie eventos financeiros reais e não altere produção sem me explicar a mudança antes.

## Revisão local de confiabilidade — 18/11/2026

Esta seção substitui as suposições e a receita antiga de webhook das seções anteriores. Nenhuma configuração, migration, função ou publicação remota foi conferida ou alterada nesta revisão. As alterações anteriores de amizades, saldos, CSV, estilos, README e configuração foram preservadas.

### Diagnóstico confirmado no código anterior

- Contador convertia erro de consulta em zero. Central e contador tinham canais Realtime independentes, sem recuperação explícita após reconexão, internet ou retorno ao app.
- Inscrição era gravada somente ao clicar em ativar. Cancelamento ignorava erros e o endpoint único podia conflitar na troca de conta.
- Função fazia envio imediato, sem trabalho persistido, novas tentativas ou teste controlado por dispositivo. Logs não distinguiam aceitação de exibição.
- Trigger local usava URL fixa do Kong. O workflow não exigia chave pública VAPID.

Hipóteses que exigem teste: suspensão/bateria, permissões do SO, navegador encerrado, inscrição expirada, par VAPID divergente, falhas 429/5xx, indisponibilidade da função e certificado HTTPS local. Não atribuímos nenhuma delas ao ambiente remoto sem evidência.

### Fluxo implementado

Evento de amizade/convite → trigger de negócio → `notifications` (central durável) → `notifications_dispatch_push` → `push_deliveries` (uma linha por aviso/dispositivo) → wakeup HTTP autenticado → `send-web-push` reivindica lote → serviço Push → `public/sw.js` → aviso genérico → destino dentro de `/SplitUai/`.

O cron `splituai-push-recovery` executa `private.recover_push_queue()` a cada minuto: recupera enfileiramentos ausentes de avisos recentes, acorda o worker e limpa diagnósticos terminais com mais de 14 dias. Não recebe dados financeiros no payload Push. Configuração privada não é exposta ao navegador.

- Recuperação central/contador: uma assinatura por conta, consultas agrupadas, no máximo uma consulta em andamento e uma recuperação pendente. Reconsulta ao conectar Realtime, voltar à internet, foco/visibilidade e a cada 60 s enquanto visível. Lista preserva o limite anterior de 100 avisos recentes; contador consulta todos os não lidos. Erro preserva o último resultado e informa desatualização.
- Reconciliação: inicial, foco, visibilidade, internet, mudanças de armazenamento e verificação a cada 30 s visível. Permissão já concedida não pede autorização novamente. Preferência de desativação vale para este navegador/origem e sobrevive a recargas. Chave VAPID incompatível, expiração ou revogação conhecida renovam a inscrição.
- Troca de conta: RPC exige posse das duas chaves da inscrição existente, transfere o vínculo e elimina trabalhos da conta anterior. Logout suspende reconciliação, cancela inscrição no navegador e tenta remover vínculo autenticado. Se houver falha, aparece mensagem para repetir a operação. Sessão encerrada por outra aba também cancela inscrição local.
- Teste: autenticação, propriedade do dispositivo e limite persistente de um teste/minuto por conta, inclusive se apagar/recriar a inscrição. Retorna `202 queued`, não confirmação de exibição. O cron executa o envio sem depender de aba aberta.
- Tentativas: até 6, intervalos mínimos de 30/60/120/240/480 s, arredondados pela execução do cron; respeita `Retry-After`. Validade 24 h para avisos e 10 min para testes. 404/410 invalidam a inscrição; outros 4xx permanentes encerram o trabalho; rede, 408/425/429/5xx permitem nova tentativa.
- Concorrência: `FOR UPDATE SKIP LOCKED`, lease de 2 min, token por reivindicação e comparação do token ao persistir resultado. Tag estável reduz duplicação visual. Lote máximo de 10 e timeout de envio de 10 s. Aceitação seguida de falha ao persistir pode causar repetição: entrega exatamente uma vez não é garantida.
- Diagnóstico: estado, tentativas, HTTP e códigos genéricos, sem endpoint, chave, payload ou resposta privada no log. A tela consulta a última tentativa do dispositivo. `accepted` significa aceito pelo serviço Push; exibição e leitura seguem desconhecidas.
- Serviços aceitos: Google FCM, Mozilla, Apple e Windows Notify. Novos hosts de Push precisam ser revisados no RPC e em `policy.ts`; URLs arbitrárias são recusadas para evitar requisições a redes privadas.

### Validação executada e pendências

- `npm run test:notifications`: 28 testes passaram (recuperação/limpeza, falha de consulta, reconexão/foreground, inscrição presente/ausente, preferência, permissão, renovação VAPID/revogação, troca de conta simulada, política de retries e navegação do SW). Os testes de hooks usam navegador/React/Supabase simulados; os testes da função usam Deno, banco e serviço Push simulados, cobrindo autenticação, teste restrito, frequência, configuração ausente, aceitação e falhas 503/410. Não são testes de integração com o banco nem com o runtime Deno.
- `node node_modules/typescript/bin/tsc -b`: passou.
- `node --check public/sw.js` e `node --check scripts/configure-local-push.mjs`: passaram.
- `npm run build`: tentou TypeScript e Vite; TypeScript passou, Vite bloqueado por Node 20.11.1 (requer 20.19+ ou 22.12+) e `spawn EPERM` do esbuild neste ambiente. Reexecutar com Node 22.12+ e permissão normal de subprocessos. Não declarar o bundle validado.
- Docker Desktop indisponível: migrations, cron, RLS, RPCs e função não foram executados contra Supabase local. Deno indisponível: não houve `deno check`/teste de runtime da Edge Function. Nenhum teste em aparelho foi executado.
- `scripts/test-push-queue.sql` preparado, ainda NÃO executado: duas contas locais, rate limit, proteção de propriedade, transferência, leases, deduplicação, revogação e grants. Usa transação com rollback, sem eventos financeiros. Não testa concorrência real entre duas conexões.

### Preparar teste integrado local

1. Instale/use Node 22.12+ e inicie Docker Desktop.
2. Rode `npx supabase start` e `npx supabase migration up --local`. Não use `db push` nesta etapa. Confirme extensão `pg_cron` e o job criado pela migration `20261118000100_reliable_push.sql`.
3. Prepare as duas contas exclusivamente locais pelo fluxo já existente, depois rode `node scripts/configure-local-push.mjs`. Ele configura somente `supabase_db_splituai` e URL `http://kong:8000/functions/v1/send-web-push`. Não exiba arquivos de secrets.
4. Execute `Get-Content scripts/test-push-queue.sql -Raw | docker exec -i supabase_db_splituai psql -U postgres -d postgres -v ON_ERROR_STOP=1`. Exige duas contas locais já criadas. O rollback impede que os wakeups de teste sejam enviados após a transação.
5. Rode `npx supabase functions serve send-web-push --env-file supabase/functions/.env`, o frontend HTTPS pelo atalho local, `npm run test:notifications` e `npm run build`.
6. Com Deno instalado, execute `deno check supabase/functions/send-web-push/index.ts` para verificar a função e suas dependências npm.

### Roteiro de aparelho com duas contas locais A e B

Use navegadores/perfis distintos; registre versões de navegador/SO, horário de criação no banco, horário `accepted` e horário observado no aparelho. Nunca anote endpoints/chaves. Use somente amizade ou convite de um grupo de teste.

| Cenário | Ação | Resultado a verificar |
| --- | --- | --- |
| App aberto | B ativa Push; A envia amizade | Central e contador atualizam; trabalho aparece; Push pode ser exibido; toque abre Amizades |
| Teste por dispositivo | B tem dois aparelhos e clica teste em um | Um trabalho, uma inscrição alvo; outro aparelho não recebe esse teste; segundo clique em menos de 1 min é recusado |
| Sem internet | B fica offline; A envia convite; B reconecta | Consulta recupera aviso mesmo se o evento Realtime se perdeu; sem falso zero |
| Segundo plano | B alterna de app; A envia amizade; B retorna | Consulta recupera central/contador sem recarga manual |
| App fechado | B fecha aba/app; A envia convite novo | Worker/cron continuam; observar Push e destino; ao reabrir, aviso continua na central |
| Celular bloqueado | B bloqueia celular; A envia amizade nova | Texto genérico na tela bloqueada; registrar atraso real e destino ao tocar |
| Desativação | B desativa; recarrega e volta ao app | Sem reinscrição automática; central continua funcionando |
| Conta trocada | Sair de B e entrar A no mesmo navegador | Inscrição anterior cancelada ou transferida com prova; nenhum trabalho antigo permanece vinculado à nova conta |
| Revogação | Só no banco local, invalidar inscrição com resposta simulada 410 | Marcar inscrição inválida; sem retries permanentes; reabrir renova se navegador permitir |
| Falha temporária | Em teste local controlado, simular 503/429 na chamada de envio | Incrementar tentativas, agendar retry, respeitar validade; central intacta |
| Worker interrompido | Interromper função após claim local e reiniciar | Reclaim após lease; token antigo não pode concluir; tag estável minimiza duplicação |
| Função/configuração indisponível | Parar função ou retirar configuração somente em ambiente descartável | Operação de amizade/convite e aviso persistem; fila espera; recuperar função permite processamento |

Injeção de falhas 410/503/429 e interrupção ainda precisa de ambiente local controlado; os testes automatizados atuais validam a política e o teste SQL valida transições, não o comportamento de uma rede real. Teste de duas conexões concorrentes e RLS com tokens de duas contas ainda é obrigatório antes da publicação.

### Produção — passos futuros, NÃO executados

1. Após todos os testes locais: revisar diff, executar testes, `deno check` e build com Node compatível. Guardar backup do banco e da função anterior. Conferir projeto alvo e migrations já aplicadas; não copiar banco local nem contas de teste.
2. Por leitura no painel: verificar Auth, publicação Realtime de `notifications`, políticas, extensão `pg_net`/`pg_cron`, função atual, webhooks existentes, contagem de inscrições, compatibilidade das chaves VAPID, logs e cotas. Nenhum desses itens foi confirmado nesta revisão.
3. Planejar janela de atualização do canal Push. Desativar o webhook HTTP antigo de `INSERT public.notifications` se existir; manter os triggers que criam avisos. Aplicar a nova migration e deixar o job pausado até configurar a função: `select cron.alter_job((select jobid from cron.job where jobname='splituai-push-recovery'), active := false);`. A fila preserva novos trabalhos durante a janela. Não implantar o novo frontend antes de RPCs/função estarem prontos.
4. Cadastrar secrets diretamente no painel: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_WEBHOOK_SECRET`. Preservar o par de produção existente se válido; trocar o par exige renovação das inscrições. Usar par separado do desenvolvimento. Publicar `send-web-push` com a configuração `verify_jwt=false` do repositório (autenticação validada dentro da função).
5. Configurar o worker no SQL Editor privado, preenchendo o segredo SOMENTE no painel (não salvar SQL preenchido no Git/chat):

```sql
insert into private.push_delivery_settings(singleton,webhook_secret,function_url)
values(true,'<PUSH_WEBHOOK_SECRET cadastrado no painel>',
  'https://<PROJECT_REF>.supabase.co/functions/v1/send-web-push')
on conflict(singleton) do update set
  webhook_secret=excluded.webhook_secret,function_url=excluded.function_url;
select cron.alter_job((select jobid from cron.job where jobname='splituai-push-recovery'), active := true);
select private.recover_push_queue();
```

O segredo fica na tabela privada já usada pelo projeto, sem acesso dos papéis de navegador. Não imprimir essa tabela. `function_url` precisa apontar para o MESMO projeto; o valor padrão Kong serve apenas ao desenvolvimento. Não configurar um segundo webhook: o trigger e o cron já acordam o worker; webhooks legados redundantes apenas causariam chamadas extras.

6. No GitHub Environment SplitUai, configurar somente as variáveis públicas de frontend já existentes e `VITE_VAPID_PUBLIC_KEY` correspondente à função. Após autorização de publicação, executar workflow. Ele passa a exigir essa chave e rodar testes antes do build. Conferir atualização do SW e reabertura do app nos dispositivos.
7. Verificar sem dados privados:

```sql
select jobid,jobname,schedule,active from cron.job where jobname='splituai-push-recovery';
select status,count(*) from public.push_deliveries group by status;
select id,status,attempts,last_status,last_error,next_attempt_at,expires_at
from public.push_deliveries order by created_at desc limit 20;
select status,start_time,end_time from cron.job_run_details
where jobid=(select jobid from cron.job where jobname='splituai-push-recovery')
order by start_time desc limit 10;
```

Verificar também códigos HTTP de wakeup no `net._http_response`, sem exibir headers, request queue ou bodies. Conferir logs genéricos da função. Um cron bem-sucedido confirma apenas execução SQL; é necessário confirmar função invocada e progressão da fila.

8. Repetir a matriz com duas contas de teste de produção e amizades/convites. Confirmar autenticação (sem sessão: 401), teste de dispositivo alheio (403), frequência (429), central sem Push, notificações abertas/fechadas/bloqueadas e troca de conta. Registrar observação de exibição separadamente de `accepted`.
9. Monitorar backlog e idade do trabalho mais antigo, tentativas, erros 401/403 de VAPID, 404/410, leases e cotas. Capacidade básica: 10 trabalhos por wakeup, mais wakeups por evento; dimensionar sob carga antes de ampliar. Polling e cron aumentam consumo; não assumir cotas/plano atuais.
10. Em falha, pausar o job para estabilizar o canal Push, manter a central/avisos e corrigir a causa. Não reativar a função antiga de envio direto sem planejar deduplicação. Retries não sobrevivem além da validade configurada. Evitar reaplicar jobs expirados em massa.

Limites: não há confirmação automática de exibição/leitura do sistema, nem garantia de instantaneidade ou exatamente uma entrega. Um envio já em trânsito pode terminar durante logout/troca de conta; o payload é genérico e os trabalhos antigos são eliminados ao transferir. Navegador totalmente encerrado, SO, economia de bateria, Modo Foco e conectividade podem impedir/adiar a apresentação.

Referências oficiais consultadas nesta revisão: [Supabase Cron](https://supabase.com/docs/guides/cron), [agendar Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), [PushSubscription applicationServerKey](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscriptionOptions/applicationServerKey), [WebKit Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/).
