$ErrorActionPreference = "Stop"

$requiredVariables = @(
  "ANDROID_KEYSTORE_PATH",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD"
)

foreach ($name in $requiredVariables) {
  if (-not [Environment]::GetEnvironmentVariable($name)) {
    throw "$name is required for an Android release build."
  }
}

$toolRoot = Join-Path $env:LOCALAPPDATA "QingjiAndroid"
$sdkRoot = if ($env:ANDROID_HOME) {
  $env:ANDROID_HOME
} else {
  Join-Path $toolRoot "android-sdk"
}

$jdkHome = $env:JAVA_HOME
if (-not $jdkHome) {
  $java = Get-ChildItem -Path (Join-Path $toolRoot "jdk21") `
    -Recurse -Filter java.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.Directory.Name -eq "bin" } |
    Select-Object -First 1
  if ($java) {
    $jdkHome = $java.Directory.Parent.FullName
  }
}

if (-not $jdkHome -or -not (Test-Path $jdkHome)) {
  throw "JDK 21 was not found. Set JAVA_HOME."
}

$platformPath = Join-Path $sdkRoot "platforms\android-36"
if (-not (Test-Path $platformPath)) {
  throw "Android SDK 36 was not found. Set ANDROID_HOME."
}

$env:JAVA_HOME = $jdkHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot

Push-Location (Join-Path $PSScriptRoot "..\apps\mobile\android")
try {
  & .\gradlew.bat assembleRelease
  if ($LASTEXITCODE -ne 0) {
    throw "Android release build failed."
  }

  $apkPath = Join-Path (Get-Location) "app\build\outputs\apk\release\app-release.apk"
  if (-not (Test-Path $apkPath)) {
    throw "Signed APK was not generated."
  }

  $apkSigner = Get-ChildItem -Path (Join-Path $sdkRoot "build-tools") `
    -Recurse -Filter apksigner.bat -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if (-not $apkSigner) {
    throw "apksigner was not found."
  }

  & $apkSigner.FullName verify --verbose $apkPath
  if ($LASTEXITCODE -ne 0) {
    throw "APK signature verification failed."
  }

  Write-Output "Signed APK: $apkPath"
} finally {
  Pop-Location
}
