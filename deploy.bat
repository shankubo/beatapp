@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

rem ============================================================================
rem  Deploiement complet: portes du projet, push GitHub, puis attente de la
rem  mise en ligne effective sur le Raspberry Pi.
rem
rem  Usage:  deploy.bat "message de commit"
rem          deploy.bat                     (message demande a la volee)
rem
rem  Le script s'arrete a la PREMIERE erreur. Publier une version qui ne
rem  compile pas, ou dont une traduction manque, serait pire que ne rien
rem  publier: le conteneur servirait un ecran blanc a tout le monde.
rem
rem  PIEGE CENTRAL, mesure le 30/07/2026 --------------------------------------
rem  Verifier un deploiement par le code HTTP ne prouve RIEN. nginx sert la
rem  PWA avec un repli `try_files ... /index.html`, donc une URL d'asset qui
rem  n'existe pas renvoie quand meme 200, avec le contenu de l'index. Un
rem  fichier .webp absent repondait « 200 OK » de facon parfaitement credible.
rem  Le script teste donc le TYPE MIME (image/webp contre text/html), seul
rem  signal qui distingue un asset reellement present.
rem ============================================================================

cd /d "%~dp0"

set "REPO=shankubo/beatapp"
set "SITE=https://app.francotamouls.com/beatapp"
rem Sentinelle: un fichier qui n'existe QUE dans la nouvelle version. S'il
rem revient en image/webp, le conteneur a bien ete remplace.
set "SENTINELLE=%SITE%/steps/promo-720.webp"
set "TYPE_ATTENDU=image/webp"

rem Attente du deploiement: Watchtower interroge le registre toutes les 60 s,
rem et la construction multi-arch (amd64 + arm64) prend ~3 min sur le runner.
set "SONDAGES=20"
set "DELAI=30"

echo.
echo ===============================================================
echo   Deploiement Beatapp
echo ===============================================================
echo.

rem --- 0. Outils requis -------------------------------------------------------
for %%T in (git.exe npm.cmd gh.exe curl.exe) do (
  where %%T >nul 2>&1 || (
    echo [ECHEC] %%T introuvable dans le PATH.
    goto :erreur
  )
)

rem --- 1. Message de commit ---------------------------------------------------
set "MESSAGE=%~1"
if "%MESSAGE%"=="" (
  set /p "MESSAGE=Message de commit : "
)
if "!MESSAGE!"=="" (
  echo [ECHEC] Message de commit vide.
  goto :erreur
)

rem --- 2. Branche -------------------------------------------------------------
for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD') do set "BRANCHE=%%B"
if not "!BRANCHE!"=="main" (
  echo [ATTENTION] Branche courante : !BRANCHE! ^(et non main^).
  echo             Seuls les pushes sur main declenchent la publication.
  set /p "SUITE=Continuer quand meme ? (o/N) "
  if /i not "!SUITE!"=="o" goto :annule
)

rem --- 3. Y a-t-il quelque chose a publier ? ----------------------------------
rem `git status --porcelain` est vide quand l'arbre est propre. Sans ce test,
rem `git commit` echouerait plus bas et l'on croirait a une vraie panne.
set "MODIFIE="
for /f "delims=" %%S in ('git status --porcelain') do set "MODIFIE=1"

if not defined MODIFIE (
  git diff --quiet HEAD origin/!BRANCHE! 2>nul
  if not errorlevel 1 (
    echo [INFO] Rien a publier : l'arbre est propre et deja pousse.
    goto :fin_ok
  )
  echo [INFO] Arbre propre, mais des commits locaux restent a pousser.
)

rem --- 4. Regeneration des visuels -------------------------------------------
rem Les images de public/steps/ derivent de assets/sources/. Les regenerer ici
rem evite de publier une vignette obsolete apres retouche d'une source.
echo [1/7] Regeneration des visuels...
call npm run steps:images >nul 2>&1
if errorlevel 1 (
  echo [ECHEC] La generation des visuels a echoue.
  echo         Detail : npm run steps:images
  goto :erreur
)
echo       ok

rem --- 5. Les portes du projet ------------------------------------------------
rem Memes verifications que la CI, mais ici on echoue en 30 s au lieu de
rem decouvrir la panne trois minutes plus tard dans GitHub Actions.
echo [2/7] Verification des types...
call npm run typecheck >nul 2>&1 || (echo [ECHEC] typecheck. Detail : npm run typecheck & goto :erreur)
echo       ok

echo [3/7] Lint...
call npm run lint >nul 2>&1 || (echo [ECHEC] lint. Detail : npm run lint & goto :erreur)
echo       ok

echo [4/7] Traductions...
call npm run i18n:check >nul 2>&1 || (echo [ECHEC] i18n. Detail : npm run i18n:check & goto :erreur)
echo       ok

echo [5/7] Tests unitaires...
call npm test >nul 2>&1 || (echo [ECHEC] tests unitaires. Detail : npm test & goto :erreur)
echo       ok

echo [6/7] Tests navigateur...
call npm run test:browser >nul 2>&1 || (echo [ECHEC] tests navigateur. Detail : npm run test:browser & goto :erreur)
echo       ok

echo [7/7] Build de production...
call npm run build >nul 2>&1 || (echo [ECHEC] build. Detail : npm run build & goto :erreur)
echo       ok
echo.

rem --- 6. Commit et push ------------------------------------------------------
echo Publication sur GitHub...
git add -A || goto :erreur

rem Un commit vide echoue: on ne le tente que s'il reste quelque chose d'indexe.
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "!MESSAGE!" || goto :erreur
  echo       commit cree
) else (
  echo       rien a committer, push des commits existants
)

git push origin !BRANCHE! || (
  echo [ECHEC] Le push a echoue.
  goto :erreur
)
for /f "delims=" %%C in ('git rev-parse --short HEAD') do set "SHA=%%C"
for /f "delims=" %%C in ('git rev-parse HEAD') do set "SHALONG=%%C"
echo       pousse : !SHA!
echo.

rem --- 7. Construction de l'image (GitHub Actions) ----------------------------
echo Construction de l'image sur GitHub Actions...
echo   (typecheck, lint, tests, puis image multi-arch vers ghcr.io)
echo.

rem Le workflow n'apparait pas instantanement apres le push.
call :pause_court 10

rem On cible le run de CE commit, par son SHA.
rem
rem Piege mesure: `gh run watch` sans argument prend le run le plus recent
rem *toutes branches confondues*, qui peut etre celui d'un push anterieur deja
rem termine — le script concluait alors a un echec alors que la construction
rem en cours se portait bien. Le SHA leve toute ambiguite.
set "RUNID="
for /l %%A in (1,1,12) do (
  if not defined RUNID (
    for /f "delims=" %%R in ('gh run list --commit !SHALONG! --limit 1 --json databaseId --jq ".[0].databaseId" 2^>nul') do set "RUNID=%%R"
    if not defined RUNID call :pause_court 5
  )
)

if not defined RUNID (
  echo [ATTENTION] Aucun workflow trouve pour !SHA! apres une minute.
  echo             Le push est fait; suivre la construction a la main :
  echo             gh run list
  goto :erreur
)

gh run watch !RUNID! --exit-status --compact >nul 2>&1
if errorlevel 1 (
  echo [ECHEC] La construction a echoue sur GitHub Actions.
  echo         Detail : gh run view !RUNID! --log-failed
  goto :erreur
)
echo       image publiee sur ghcr.io
echo.

rem --- 8. Mise en ligne effective sur le RPi ----------------------------------
rem C'est ici que se joue la seule verification qui compte. Le reste peut etre
rem vert alors que les visiteurs recoivent encore l'ancienne version.
echo Attente de la mise en ligne ^(Watchtower verifie chaque minute^)...
echo.

set "ENLIGNE="
for /l %%I in (1,1,%SONDAGES%) do (
  if not defined ENLIGNE (
    set "MIME="
    rem -s silencieux, -o nul pour jeter le corps: seul l'en-tete compte.
    for /f "delims=" %%M in ('curl.exe -s -o nul -w "%%{content_type}" --max-time 15 "%SENTINELLE%" 2^>nul') do set "MIME=%%M"

    echo   [%%I/%SONDAGES%] type recu : !MIME!

    echo !MIME! | findstr /i /c:"%TYPE_ATTENDU%" >nul 2>&1
    if not errorlevel 1 set "ENLIGNE=1"

    if not defined ENLIGNE call :pause_court %DELAI%
  )
)

echo.
if defined ENLIGNE (
  echo ===============================================================
  echo   EN LIGNE — %SITE%/
  echo ===============================================================
  echo.
  echo Les utilisateurs n'ont RIEN a faire: la PWA est en autoUpdate,
  echo la nouvelle version s'installe au prochain chargement.
  goto :fin_ok
)

rem --- Echec du deploiement: dire quoi faire, precisement ---------------------
echo ===============================================================
echo   IMAGE PUBLIEE, MAIS LE SITE SERT ENCORE L'ANCIENNE VERSION
echo ===============================================================
echo.
echo La sentinelle repond « text/html » au lieu de « %TYPE_ATTENDU% » :
echo nginx retombe sur index.html, donc le fichier n'existe pas encore
echo dans le conteneur. Watchtower n'a pas tire la nouvelle image.
echo.
echo Cause la plus frequente : le paquet ghcr.io est PRIVE. Watchtower
echo ne peut pas s'authentifier, echoue en boucle sans bruit, et le
echo site continue de servir l'ancienne version.
echo.
echo   A. Rendre le paquet public ^(le plus simple — l'image ne contient
echo      que des fichiers deja publics sur le site^) :
echo      https://github.com/users/shankubo/packages/container/beatapp/settings
echo      « Change visibility » ^> Public
echo.
echo   B. Ou authentifier le RPi, une fois pour toutes :
echo      ssh shan@192.168.1.87
echo      echo LE_JETON ^| docker login ghcr.io -u shankubo --password-stdin
echo      sudo mkdir -p /root/.docker ^&^& sudo cp ~/.docker/config.json /root/.docker/
echo      docker restart beatapp-watchtower
echo.
echo   Forcer la mise a jour sans attendre :
rem Les `^&` ne doivent PAS etre echappes ici: a l'interieur des guillemets,
rem cmd.exe ne les interprete plus comme des separateurs de commande, et le
rem caret s'affichait tel quel dans le message (« pull ^&^& docker »).
echo      ssh shan@192.168.1.87 "cd /srv/beatapp && docker compose pull && docker compose up -d"
echo.
echo Voir deploy/rpi/README.md pour le diagnostic complet.
goto :erreur

rem --- Pause de N secondes ----------------------------------------------------
rem
rem Deux precautions, chacune pour une panne observee:
rem
rem  - chemin ABSOLU vers timeout.exe. Lance depuis un shell qui a Git pour
rem    Windows en tete du PATH, `timeout` resolvait vers l'outil POSIX de
rem    coreutils, qui attend une duree en premier argument et rejette « /t »
rem    (« timeout: invalid time interval '/t' »);
rem  - repli sur `ping`. timeout.exe refuse de s'executer quand l'entree
rem    standard est redirigee (« ERROR: Input redirection is not supported »),
rem    ce qui arrive des que le script tourne dans un pipeline ou une tache
rem    planifiee. `ping -n` compte les secondes sans toucher a stdin.
:pause_court
set "N=%~1"
if not defined N set "N=5"
"%SystemRoot%\System32\timeout.exe" /t %N% /nobreak >nul 2>&1
if errorlevel 1 (
  set /a "PINGS=%N%+1"
  ping -n !PINGS! 127.0.0.1 >nul 2>&1
)
exit /b 0

:annule
echo.
echo Annule. Rien n'a ete publie.
endlocal
exit /b 1

:erreur
echo.
endlocal
exit /b 1

:fin_ok
echo.
endlocal
exit /b 0
