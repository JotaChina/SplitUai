# SplitUai

Aplicação web para organizar despesas compartilhadas em grupos pequenos.

## Rodar localmente

Requer Node.js 22.12+.

```bash
npm ci
npm run dev
```

Copie `.env.example` para `.env.local` e preencha as configurações públicas do seu próprio projeto Supabase. Nunca use chaves `service_role`, secret ou credenciais privadas no frontend. Arquivos `.env.local` são ignorados pelo Git.

## Saldos e acertos

O saldo do mês considera despesas da competência que continuam devidas no saldo geral. Acertos pagos ajustam apenas o saldo de todo o período; acertos pendentes não alteram saldos. O formulário de acerto começa com o valor sugerido para quitar a dívida e permite registrar pagamentos parciais.

Despesas parceladas afetam o saldo no mês de vencimento de cada parcela. O histórico importado do Splitwise mantém despesas e pagamentos em registros separados.

## Build

```bash
npm run build
```

A publicação do frontend é feita pelo workflow de GitHub Pages após atualizações na branch principal.

Mais detalhes de desenvolvimento do Web Push estão em [docs/web-push.md](docs/web-push.md).

