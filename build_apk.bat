@echo off
setlocal enabledelayedexpansion

REM ==========================================
REM  ZaBot - build automatico do APK
REM  Uso:
REM    build_apk.bat            -> gera APK debug
REM    build_apk.bat release    -> gera APK release
REM ==========================================

cd /d "%~dp0"

set BUILD_TYPE=debug
if /I "%~1"=="release" set BUILD_TYPE=release

echo ==========================================
echo  ZaBot - Build automatico do APK (%BUILD_TYPE%)
echo ==========================================

echo.
echo [1/6] Verificando Flutter no PATH...
where flutter >nul 2>&1
if errorlevel 1 (
    echo ERRO: Flutter nao encontrado no PATH.
    echo Instale o Flutter SDK e garanta que "flutter" funciona no terminal.
    goto :fim
)

echo.
echo [2/6] Verificando pasta "android"...
if not exist "android\app\build.gradle" (
    echo  Pasta "android" ausente ou incompleta. Gerando com "flutter create .":
    cmd /c "flutter create ."
    if not "%errorlevel%"=="0" (
        echo ERRO ao rodar "flutter create .".
        goto :fim
    )
)

echo.
echo [3/6] Limpando build anterior...
cmd /c "flutter clean"
if not "%errorlevel%"=="0" (
    echo ERRO ao rodar "flutter clean".
    goto :fim
)

echo.
echo [4/6] Instalando dependencias (flutter pub get)...
cmd /c "flutter pub get"
if not "%errorlevel%"=="0" (
    echo ERRO ao rodar "flutter pub get".
    goto :fim
)

echo.
echo [5/6] Gerando arquivos de localizacao (flutter gen-l10n)...
cmd /c "flutter gen-l10n"
if not "%errorlevel%"=="0" (
    echo ERRO ao rodar "flutter gen-l10n".
    goto :fim
)

echo.
echo [6/6] Gerando APK (%BUILD_TYPE%)...
REM Roda o flutter em um sub-processo (cmd /c). Assim, se o flutter.bat
REM fechar o processo de forma abrupta, so o sub-processo morre e esta
REM janela continua viva ate o "pause" la embaixo.
cmd /c "flutter build apk --%BUILD_TYPE%"
set BUILD_RESULT=%errorlevel%

echo.
if not "%BUILD_RESULT%"=="0" (
    echo ==========================================
    echo  ERRO ao gerar o APK ^(codigo %BUILD_RESULT%^).
    echo  Veja as mensagens acima para o motivo.
    echo ==========================================
    goto :fim
)

echo ==========================================
echo  APK gerado com sucesso!
if /I "%BUILD_TYPE%"=="release" (
    echo  Local: build\app\outputs\flutter-apk\app-release.apk
) else (
    echo  Local: build\app\outputs\flutter-apk\app-debug.apk
)
echo ==========================================

start "" "build\app\outputs\flutter-apk"

:fim
echo.
echo Pressione qualquer tecla para fechar esta janela...
pause >nul
endlocal
