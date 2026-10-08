# SplitUai

Aplicação web para organizar despesas compartilhadas em grupos pequenos.

## Rodar localmente

Requer Node.js 22 ou superior (ou Node.js 20.19+ para compatibilidade com as versões atuais do Vite).

```bash
npm install
npm run dev
```

O protótipo atual contém telas navegáveis com dados de exemplo. Login, grupos e despesas ainda não estão conectados a um backend.

## Publicação

O workflow em `.github/workflows/deploy.yml` usa Node 22, instala as dependências do `package-lock.json`, compila o site e publica o diretório `dist` no GitHub Pages quando há push para `main` ou execução manual. No repositório GitHub, habilite **Settings → Pages → Build and deployment → Source: GitHub Actions**. O Vite usa `/SplitUai/` como caminho base, correspondente ao nome atual do repositório. Se o repositório ou caminho mudar, ajuste `base` em `vite.config.ts`.

## Supabase

O projeto local da CLI fica em `supabase/`. Já existe um projeto Supabase saudável na região **East US (North Virginia, `us-east-1`)**, com referência `ipbnqofmggytdkgmadtc`. O projeto alvo do SplitUai será um novo projeto **Free em São Paulo (`sa-east-1`)**, condicionado à cota disponível; o projeto da Virginia não será usado pelo app. A URL pública e a chave anon do novo projeto ficam vazias em `.env.example` até sua criação e a configuração/revisão de RLS.

Na captura, o projeto da Virginia aparece sem migrações e sem repositório conectado; ainda não verificamos se há tabelas ou dados fora do SplitUai. A região de um projeto não pode ser alterada diretamente. O projeto existente será mantido sem alterações por enquanto.

O plano Free inclui até dois projetos ativos, sujeito à cota compartilhada do titular nas organizações em que é Owner/Admin; projetos Free podem pausar após sete dias de baixa atividade. Confira na tela de criação que a organização/plano está em **Free** e o total é **US$ 0** antes de confirmar.

As variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` são apenas um modelo para a futura integração. O frontend ainda não se conecta ao Supabase. Nunca adicione chaves `service_role`, senhas do banco ou outros segredos ao frontend, ao repositório ou ao bundle publicado. Use a chave pública somente com RLS configurado e revisado.

## Estado das configurações externas

- GitHub: a cópia local está na branch `main`, ainda sem commits ou remoto. GitHub Free só publica Pages de repositórios públicos; repositórios privados precisam de GitHub Pro para Pages, e o site publicado continua público em conta pessoal. Crie `JotaChina/SplitUai`, faça o primeiro push e habilite Pages por GitHub Actions.
- Supabase: projeto alvo Free em São Paulo ainda precisa ser criado; verifique a cota e o total de US$ 0 no painel. A senha do banco e as chaves secretas não estão neste repositório.
- O protótipo usa dados demonstrativos. Login, grupos, despesas e persistência ainda não estão conectados.
