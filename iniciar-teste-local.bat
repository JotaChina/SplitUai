@echo off
setlocal
cd /d "%~dp0"

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

echo Iniciando o Supabase local. Nenhuma migration sera aplicada por este script.
call npx --no-install supabase start >nul 2>nul
if errorlevel 1 (
  echo Nao foi possivel iniciar o Supabase local. Confira se o Docker Desktop esta aberto.
  echo Para detalhes, execute: npx supabase start
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

rem Process environment overrides .env.local so the app cannot connect to production.
set "VITE_SUPABASE_URL=http://127.0.0.1:54321"
set "VITE_SUPABASE_PUBLISHABLE_KEY=%LOCAL_SUPABASE_KEY%"
echo Abrindo o teste em http://127.0.0.1:5173/SplitUai/
echo Este atalho nao importa dados nem aplica migrations. Pare o servidor com Ctrl+C na outra janela.
start "SplitUai - teste local" cmd /k "npm run dev -- --host 127.0.0.1"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173/SplitUai/"
exit /b 0
