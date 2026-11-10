$ErrorActionPreference = "Stop"

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
  & .\gradlew.bat assembleDebug
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
