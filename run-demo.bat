@echo off
setlocal
cd /d "%~dp0"

set "EMSDK_ENV=%~dp0..\..\emsdk\emsdk_env.bat"
set "NINJA=%~dp0.tools\pythonpkgs\bin\ninja.exe"

if not exist "%EMSDK_ENV%" (
  echo Emscripten SDK not found at "%EMSDK_ENV%".
  pause
  exit /b 1
)
if not exist "%NINJA%" (
  echo Ninja build tool not found at "%NINJA%".
  pause
  exit /b 1
)

if not exist build\emscripten-temp mkdir build\emscripten-temp
set "TEMP=%CD%\build\emscripten-temp"
set "TMP=%TEMP%"

call "%EMSDK_ENV%"
if errorlevel 1 goto :failed

emcmake cmake -S . -B build/wasm-windows -G Ninja -DCMAKE_MAKE_PROGRAM="%NINJA%" -DCMAKE_BUILD_TYPE=Release -DQUANTUMLAB_BUILD_WASM=ON -DQUANTUMLAB_BUILD_TESTS=ON
if errorlevel 1 goto :failed

cmake --build build/wasm-windows --parallel
if errorlevel 1 goto :failed

if not exist build\wasm mkdir build\wasm
copy /y build\wasm-windows\quantumlab_wasm.mjs build\wasm\ >nul
if errorlevel 1 goto :failed
copy /y build\wasm-windows\quantumlab_wasm.wasm build\wasm\ >nul
if errorlevel 1 goto :failed

if not exist frontend\node_modules (
  echo Installing QUARKS frontend packages for first launch...
  cd /d "%~dp0frontend"
  call npm.cmd install
  if errorlevel 1 goto :failed
  cd /d "%~dp0"
)

echo.
echo QUARKS Circuit IDE is ready at http://127.0.0.1:5173/
echo Keep this window open while using the IDE. Press Ctrl+C to stop it.
cd /d "%~dp0frontend"
call npm.cmd run dev
exit /b %errorlevel%

:failed
echo.
echo Setup or build failed. Review the error above.
pause
exit /b 1
