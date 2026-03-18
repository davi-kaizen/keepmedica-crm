@echo off
chcp 65001 >nul
title KeepMedica CRM - Iniciando...
color 0A

echo.
echo  ██╗  ██╗███████╗███████╗██████╗ ███╗   ███╗███████╗██████╗ ██╗ ██████╗ █████╗
echo  ██║ ██╔╝██╔════╝██╔════╝██╔══██╗████╗ ████║██╔════╝██╔══██╗██║██╔════╝██╔══██╗
echo  █████╔╝ █████╗  █████╗  ██████╔╝██╔████╔██║█████╗  ██║  ██║██║██║     ███████║
echo  ██╔═██╗ ██╔══╝  ██╔══╝  ██╔═══╝ ██║╚██╔╝██║██╔══╝  ██║  ██║██║██║     ██╔══██║
echo  ██║  ██╗███████╗███████╗██║     ██║ ╚═╝ ██║███████╗██████╔╝██║╚██████╗██║  ██║
echo  ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝     ╚═╝     ╚═╝╚══════╝╚═════╝ ╚═╝ ╚═════╝╚═╝  ╚═╝
echo.
echo  ============================================================
echo    Verificando dependencias...
echo  ============================================================
echo.

:: Verificar Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERRO] Python nao encontrado!
    echo  Baixe em: https://www.python.org/downloads/
    echo  IMPORTANTE: Marque "Add Python to PATH" durante a instalacao.
    pause
    exit /b
)
echo  [OK] Python encontrado.

:: Verificar Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERRO] Node.js nao encontrado!
    echo  Baixe em: https://nodejs.org/
    pause
    exit /b
)
echo  [OK] Node.js encontrado.

:: Criar venv se não existir
if not exist ".venv" (
    echo.
    echo  Criando ambiente virtual Python...
    python -m venv .venv
)
echo  [OK] Ambiente virtual pronto.

:: Instalar dependências Python
echo.
echo  Instalando dependencias do Backend...
call .venv\Scripts\activate
pip install -r requirements.txt --quiet
echo  [OK] Backend pronto.

:: Instalar dependências Node
echo.
echo  Instalando dependencias do Frontend...
cd frontend
if not exist "node_modules" (
    call npm install
) else (
    echo  [OK] node_modules ja existe, pulando...
)
cd ..

echo.
echo  ============================================================
echo    Iniciando servidores...
echo  ============================================================
echo.
echo  Backend: http://localhost:5000
echo  Frontend: http://localhost:3000
echo.
echo  Para parar: feche esta janela ou pressione Ctrl+C
echo  ============================================================
echo.

:: Iniciar Backend em segundo plano
start "KeepMedica Backend" cmd /c "call .venv\Scripts\activate && python meu_crmatualizado.py"

:: Aguardar backend subir
timeout /t 3 /nobreak >nul

:: Iniciar Frontend
cd frontend
start "KeepMedica Frontend" cmd /c "npm run dev"
cd ..

:: Aguardar frontend subir e abrir navegador
timeout /t 5 /nobreak >nul
start http://localhost:3000

echo.
echo  [PRONTO] Sistema rodando! O navegador abrira automaticamente.
echo  Pressione qualquer tecla para PARAR os servidores...
pause >nul

:: Matar processos ao fechar
taskkill /FI "WINDOWTITLE eq KeepMedica Backend" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq KeepMedica Frontend" /F >nul 2>&1
