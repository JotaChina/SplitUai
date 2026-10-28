@echo off
setlocal
cd /d "%~dp0"
set "SPLITUAI_LAN_IP=192.168.3.140"
set "SPLITUAI_DOCKER_NETWORK=splituai-loopback-https"

rem Prefer the Codex bundled Node when available; otherwise use system Node.
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  set "PATH=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%"
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale Node 20.19+ ou 22.12+.
  pause
  exit /b 1
)

node -e "const [major,minor]=process.versions.node.split('.').map(Number); process.exit((major===20&&minor>=19)||(major===22&&minor>=12)||major>22?0:1)"
if errorlevel 1 (
  echo A versao atual do Node e antiga para o Vite. Use Node 20.19+ ou 22.12+.
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Dependencias nao encontradas. Execute npm ci neste projeto e tente novamente.
  pause
  exit /b 1
)

for /f "delims=" %%I in ('powershell -NoProfile -Command "if (Get-NetIPAddress -AddressFamily IPv4 -IPAddress '%SPLITUAI_LAN_IP%' -ErrorAction SilentlyContinue) { 'OK' }"') do set "LAN_IP_FOUND=%%I"
if not "%LAN_IP_FOUND%"=="OK" (
  echo O IP %SPLITUAI_LAN_IP% nao esta configurado neste computador.
  echo Atualize SPLITUAI_LAN_IP neste arquivo com o IPv4 atual da rede Wi-Fi.
  pause
  exit /b 1
)

for /f "delims=" %%P in ('powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue) { 'BUSY' }"') do set "VITE_PORT_BUSY=%%P"
if "%VITE_PORT_BUSY%"=="BUSY" (
  echo A porta 5173 ja esta em uso. Feche a janela antiga do SplitUai com Ctrl+C e tente novamente.
  pause
  exit /b 1
)

docker network inspect "%SPLITUAI_DOCKER_NETWORK%" >nul 2>nul
if errorlevel 1 (
  echo Criando a rede Docker com portas limitadas a 127.0.0.1.
  call docker network create --driver bridge --opt "com.docker.network.bridge.host_binding_ipv4=127.0.0.1" "%SPLITUAI_DOCKER_NETWORK%"
  if errorlevel 1 (
    echo Nao foi possivel criar a rede Docker local.
    pause
    exit /b 1
  )
)

docker network inspect "%SPLITUAI_DOCKER_NETWORK%" --format "{{json .Options}}" | findstr /c:"com.docker.network.bridge.host_binding_ipv4" | findstr /c:"127.0.0.1" >nul
if errorlevel 1 (
  echo A rede Docker existente nao esta limitada a 127.0.0.1.
  echo Nao vou iniciar servicos com uma vinculacao de rede inesperada.
  pause
  exit /b 1
)

echo Preparando o certificado HTTPS para este computador e os dispositivos de teste...
call powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-local-https.ps1" -LanIp "%SPLITUAI_LAN_IP%"
if errorlevel 1 (
  echo Nao foi possivel preparar o certificado HTTPS local.
  pause
  exit /b 1
)

rem Stop preserves local database volumes; restart on the loopback-bound Docker network.
call npx --no-install supabase stop >nul 2>nul

echo Iniciando o Supabase local. Somente o app HTTPS ficara acessivel pela rede.
node "%~dp0scripts\start-local-supabase.mjs" "%SPLITUAI_DOCKER_NETWORK%"
if errorlevel 1 (
  echo Nao foi possivel iniciar o Supabase local. Confira se o Docker Desktop esta aberto.
  pause
  exit /b 1
)

echo Aplicando migrations pendentes somente ao Supabase local...
call npx --no-install supabase migration up --local
if errorlevel 1 (
  echo Nao foi possivel aplicar as migrations locais. Nenhum reset foi executado.
  pause
  exit /b 1
)

echo Configurando notificacoes Push para os dispositivos de teste...
node "%~dp0scripts\configure-local-push.mjs"
if errorlevel 1 (
  echo Nao foi possivel configurar o Push local. Confira VAPID_PUBLIC_KEY e PUSH_WEBHOOK_SECRET em supabase\functions\.env.
  pause
  exit /b 1
)

echo Preparando as contas locais de teste...
node "%~dp0scripts\ensure-local-test-users.mjs"
if errorlevel 1 (
  echo Nao foi possivel preparar as contas de teste locais.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%K in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-supabase-publishable-key.ps1"`) do set "LOCAL_SUPABASE_KEY=%%K"
if not defined LOCAL_SUPABASE_KEY (
  echo Nao foi possivel obter a chave publicavel do Supabase local.
  echo Confira o Supabase local com: npx supabase status
  pause
  exit /b 1
)

rem Route browser API calls through Vite HTTPS; Supabase ports remain on loopback.
set "VITE_SUPABASE_URL=https://%SPLITUAI_LAN_IP%:5173"
set "VITE_SUPABASE_PUBLISHABLE_KEY=%LOCAL_SUPABASE_KEY%"
set "SPLITUAI_LOCAL_HTTPS=1"
echo Abrindo o teste em https://%SPLITUAI_LAN_IP%:5173/SplitUai/
echo As contas teste e teste2 sao locais. Consulte README.md para os logins.
echo Somente o app HTTPS fica acessivel pela rede; as portas do Supabase ficam locais.
echo Copie .local-dev\certs\rootCA.pem para cada dispositivo e confie nele para HTTPS.
echo Nunca copie a chave rootCA-key.pem. Pare os servidores com Ctrl+C nas janelas abertas.
start "SplitUai - funcoes locais" cmd /k "npx --no-install supabase functions serve --env-file supabase/functions/.env --network-id %SPLITUAI_DOCKER_NETWORK%"
start "SplitUai - teste HTTPS" cmd /k "npm run dev -- --host %SPLITUAI_LAN_IP% --strictPort"
timeout /t 3 /nobreak >nul
start "" "https://%SPLITUAI_LAN_IP%:5173/SplitUai/"
exit /b 0
