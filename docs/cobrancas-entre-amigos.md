# Cobranças entre amigos

Cobranças diretas existem fora dos grupos. Apenas amizades aceitas podem criar novas solicitações. Desfazer a amizade impede novas cobranças, mas preserva o histórico e permite concluir as existentes.

## Fluxo

- Acesso em **Entre amigos**, na lista de amizades ou no perfil de uma amizade aceita.
- Cobrança de valor fixo ou divisão de uma despesa entre duas pessoas. Quem cria é quem pagou a despesa e recebe o valor. Quando o total é ímpar em centavos, o centavo excedente fica com quem criou.
- Descrição e valor obrigatórios; vencimento opcional. Limite de R$ 1 milhão por cobrança.
- A outra pessoa reconhece ou contesta. Solicitações pendentes e contestadas não entram nos totais reconhecidos.
- Somente quem deve informa o pagamento, após reconhecer. Somente quem recebe confirma a quitação ou informa que não recebeu. Ambas as ações exigem uma confirmação na interface.
- Quem recebe pode cancelar antes de haver pagamento informado. Não é permitido editar valores unilateralmente; cancelar e criar outra solicitação mantém o histórico.
- Contestação e pagamento não localizado exigem motivo. Todos os eventos ficam no histórico.
- Pix usa a chave cadastrada no perfil de quem recebe. Nenhum pagamento ou verificação bancária ocorre no aplicativo.
- Comprovantes de despesa e pagamento: PDF, JPG, PNG ou WebP, até 5 MB, bucket privado, leitura apenas pelos participantes e links assinados de 60 segundos. Referências aos comprovantes permanecem no histórico mesmo após uma nova tentativa de pagamento.
- Avisos persistidos usam o canal Push já publicado, sem depender da migração local de confiabilidade de Push. Recebimento de Push continua condicionado à inscrição e às permissões do dispositivo.
- Atualização por Realtime, retorno ao primeiro plano, reconexão e consulta a cada 30 segundos enquanto a página está visível.

## Validação

`node scripts/direct-charges.test.mjs` valida centavos, divisão, erros de envio e comprovantes. O workflow `Validate direct charges` executa esses testes, o build com Node 22 e os testes SQL em PostgreSQL 17 descartável, com três contas e papéis reais de autorização.

Os testes SQL usam um esquema mínimo de suporte a Auth/Storage/avisos; não substituem um teste entre duas contas e dois dispositivos no projeto hospedado. Nenhum dado de teste deve ser inserido em produção.

## Publicação

Projeto alvo: `yzxeyqutmvjmrglmpcbb` (São Paulo). Frontend: GitHub Pages, branch `main`.

### Pelo GitHub Actions

O job `Verify Supabase credential (read only)` testa o Secret com uma consulta de metadados, após a validação da branch. Ele não aplica migrations nem consulta cobranças ou dados pessoais. A alteração de produção continua restrita ao workflow manual descrito abaixo.

No Supabase, gerar um Personal Access Token limitado **somente ao projeto SplitUai**, com a permissão **Database: Read-write** e prazo curto de validade. Essa permissão permite executar SQL administrativo; não usar um token legado com acesso à conta inteira. Não compartilhar o token em chat ou no código.

No repositório GitHub: **Settings → Environments → SplitUai → Environment secrets → Add secret**. Nome: `SUPABASE_ACCESS_TOKEN`. Valor: o token pessoal do Supabase (não a chave pública nem `service_role`).

A proposta de publicação usa o workflow manual `Deploy direct charges database`, com confirmação explícita do identificador do projeto. Ele não executa em push nem pull request. O script valida o projeto alvo, guarda metadados do esquema anterior, executa somente a migração desta entrega em uma transação, registra-a no histórico e confere RLS, RPCs e bucket privado. Se a migração já estiver aplicada, apenas confere sua estrutura. A publicação deste workflow está pendente de autorização específica do responsável pelo projeto.

O token não é fornecido ao build do frontend e não é usado para aplicar o banco em eventos de pull request. O site só deve ser publicado após o sucesso desse job. Revogar o token após concluir a entrega se não houver intenção de mantê-lo para novas atualizações. Proteger os workflows e limitar quais branches podem usar o Environment é necessário: quem consegue modificar um workflow autorizado pode usar seus Secrets.

### Alternativa: SQL Editor autenticado

1. Conferir o projeto alvo e guardar um backup de esquema pelos meios administrativos existentes.
2. No SQL Editor autenticado do projeto alvo, aplicar **somente** `supabase/migrations/20261118000200_direct_charges.sql`, dentro de uma transação. Não executar `db push` com todas as migrations locais: a migração `20261118000100_reliable_push.sql` é de outra entrega.
3. Na mesma transação, registrar a migração no controle existente:

```sql
insert into supabase_migrations.schema_migrations(version,name,statements)
values ('20261118000200','direct_charges',array['Applied direct charges migration through SQL Editor'])
on conflict (version) do nothing;
```

4. Conferir RLS, RPCs, bucket e publicação Realtime, sem expor dados dos usuários:

```sql
select relname,relrowsecurity from pg_class
where oid in ('public.direct_charges'::regclass,'public.direct_charge_events'::regclass);
select id,public,file_size_limit from storage.buckets where id='direct-charge-receipts';
select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='direct_charges';
select version from supabase_migrations.schema_migrations where version='20261118000200';
```

5. Após a aplicação bem-sucedida do banco e os testes verdes do PR, integrar a branch no `main` e acompanhar o workflow de GitHub Pages até `success`.
6. Validar com duas contas autorizadas: criar cobrança, reconhecer, informar pagamento e confirmar recebimento; conferir que terceiros não conseguem consultar a cobrança. Comprovar Push em dispositivos reais depende das inscrições já configuradas.

Se o banco ainda não tiver sido aplicado, não publicar a interface no `main`. Reverter o frontend mantém os registros e comprovantes; não apagar tabelas ou documentos como rollback.
