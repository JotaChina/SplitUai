param(
  [string]$LanIp = '192.168.3.140'
)

$ErrorActionPreference = 'Stop'

$parsedIp = $null
if (-not [System.Net.IPAddress]::TryParse($LanIp, [ref]$parsedIp)) {
  throw "Endereco IPv4 invalido: $LanIp"
}
if ($parsedIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
  throw 'Informe um endereco IPv4 da rede local.'
}

$opensslCandidates = @(
  'C:\Program Files\Git\usr\bin\openssl.exe',
  'C:\Program Files\Git\mingw64\bin\openssl.exe'
)
$openssl = $opensslCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $openssl) {
  throw 'OpenSSL do Git for Windows nao foi encontrado. Instale o Git for Windows e tente novamente.'
}

$caDir = Join-Path $env:LOCALAPPDATA 'SplitUai\local-ca'
$certDir = Join-Path (Split-Path -Parent $PSScriptRoot) '.local-dev\certs'
New-Item -ItemType Directory -Force -Path $caDir, $certDir | Out-Null

$caKey = Join-Path $caDir 'rootCA-key.pem'
$caCert = Join-Path $caDir 'rootCA.pem'
$caKeyExists = Test-Path $caKey
$caCertExists = Test-Path $caCert
if ($caKeyExists -ne $caCertExists) {
  throw "A CA local esta incompleta em $caDir. Nao vou substituir uma chave existente automaticamente."
}

if (-not $caKeyExists) {
  & $openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out $caKey
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar a chave privada da CA.' }
  & $openssl req -x509 -new -key $caKey -sha256 -days 3650 -out $caCert `
    -subj '/CN=SplitUai Local Development CA' `
    -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' `
    -addext 'keyUsage=critical,keyCertSign,cRLSign' `
    -addext 'subjectKeyIdentifier=hash'
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o certificado raiz local.' }
}

$certConfig = Join-Path $certDir 'server-cert.cnf'
$csr = Join-Path $certDir 'server.csr'
$serverKey = Join-Path $certDir 'server-key.pem'
$serverCert = Join-Path $certDir 'server-cert.pem'
$publicCaCopy = Join-Path $certDir 'rootCA.pem'
$publicCaDer = Join-Path $certDir 'rootCA.cer'

$config = @"
[req]
distinguished_name = dn
prompt = no
req_extensions = server_ext
[dn]
CN = $LanIp
[server_ext]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
[alt_names]
IP.1 = $LanIp
IP.2 = 127.0.0.1
DNS.1 = localhost
"@
Set-Content -LiteralPath $certConfig -Value $config -Encoding ascii

& $openssl req -new -newkey rsa:2048 -nodes -keyout $serverKey -out $csr `
  -config $certConfig
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o certificado HTTPS local.' }

& $openssl x509 -req -in $csr -CA $caCert -CAkey $caKey -CAcreateserial `
  -out $serverCert -days 365 -sha256 -extfile $certConfig -extensions server_ext
if ($LASTEXITCODE -ne 0) { throw 'Falha ao assinar o certificado HTTPS local.' }

& $openssl verify -CAfile $caCert $serverCert
if ($LASTEXITCODE -ne 0) { throw 'A verificacao da cadeia do certificado falhou.' }
Copy-Item -LiteralPath $caCert -Destination $publicCaCopy -Force
& $openssl x509 -in $caCert -outform DER -out $publicCaDer
if ($LASTEXITCODE -ne 0) { throw 'Falha ao exportar o certificado publico para dispositivos moveis.' }
Remove-Item -LiteralPath $csr -Force -ErrorAction SilentlyContinue

$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $caKey /inheritance:r /grant:r "*$currentSid`:(F)" '*S-1-5-18:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel restringir o acesso a chave privada da CA.' }
& icacls.exe $serverKey /inheritance:r /grant:r "*$currentSid`:(F)" '*S-1-5-18:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel restringir o acesso a chave HTTPS local.' }

& certutil.exe -user -addstore -f Root $caCert | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel confiar na CA no perfil deste usuario do Windows.' }

Write-Output "HTTPS local pronto para https://${LanIp}:5173/SplitUai/"
Write-Output "Certificado publico da CA para instalar nos dispositivos: $publicCaDer"
Write-Output 'A chave rootCA-key.pem e privada. Nunca a copie para outro dispositivo.'
