$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$signingRoot = Join-Path $projectRoot ".ai\local\signing"
$keystorePath = Join-Path $signingRoot "qingji-release.keystore"
$envPath = Join-Path $signingRoot "android-signing.env"

if ((Test-Path -LiteralPath $keystorePath) -or (Test-Path -LiteralPath $envPath)) {
  throw "Android signing files already exist. Back them up before replacing them."
}

$toolRoot = Join-Path $env:LOCALAPPDATA "QingjiAndroid"
$keyTool = Get-ChildItem -Path (Join-Path $toolRoot "jdk21") `
  -Recurse -Filter keytool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.Directory.Name -eq "bin" } |
  Select-Object -First 1

if (-not $keyTool) {
  throw "keytool was not found. Install JDK 21 or set up the Qingji Android toolchain."
}

function New-UrlSafeSecret {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$storePassword = New-UrlSafeSecret
$keyPassword = $storePassword
$alias = "qingji"

New-Item -ItemType Directory -Path $signingRoot -Force | Out-Null

& $keyTool.FullName `
  -genkeypair `
  -noprompt `
  -keystore $keystorePath `
  -storepass $storePassword `
  -keypass $keyPassword `
  -alias $alias `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000 `
  -dname "CN=Qingji, OU=Mobile, O=Qingji, L=Shanghai, ST=Shanghai, C=CN"

if ($LASTEXITCODE -ne 0) {
  throw "Failed to create the Android signing key."
}

$envLines = @(
  "ANDROID_KEYSTORE_PATH=$keystorePath"
  "ANDROID_KEYSTORE_PASSWORD=$storePassword"
  "ANDROID_KEY_ALIAS=$alias"
  "ANDROID_KEY_PASSWORD=$keyPassword"
)

[IO.File]::WriteAllLines($envPath, $envLines, [Text.UTF8Encoding]::new($false))

Write-Output "Android signing key created."
Write-Output "Keystore: $keystorePath"
Write-Output "Environment: $envPath"
Write-Output "Back up both files securely; losing them prevents future upgrades."
