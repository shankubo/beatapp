# Déploiement sur Raspberry Pi (Docker)

L'application est servie sous **<https://app.francotamouls.com/beatapp/>**

## Comment ça marche

```text
push sur main
      ↓
GitHub Actions : typecheck · lint · tests · i18n
      ↓
image Docker multi-arch (amd64 + arm64) → ghcr.io
      ↓
Watchtower sur le RPi (vérifie chaque minute)
      ↓
docker pull + redémarrage du conteneur
```

Le Raspberry Pi **ne compile rien** : il tire une image déjà construite. Un
build Vite sur un RPi prend plusieurs minutes et échoue par manque de mémoire
sur les modèles à 1 Go.

Le RPi **n'exécute pas l'application** non plus : c'est une PWA entièrement
cliente. L'analyse du rythme et l'encodage MP4 se font dans le navigateur du
visiteur. Le conteneur ne fait que servir des fichiers statiques — sa charge est
négligeable, même avec plusieurs utilisateurs simultanés.

**Aucun port n'est ouvert sur Internet** : Watchtower interroge le registre
depuis le RPi. Pas de webhook à exposer, donc pas de service supplémentaire
joignable de l'extérieur.

## Si le RPi fait déjà tourner d'autres conteneurs

C'est le cas ici, et trois points méritent une vérification avant d'installer.

### Watchtower ne touchera pas tes autres conteneurs

Par défaut, Watchtower met à jour **tout** ce qu'il trouve. Trois garde-fous
l'en empêchent dans ce compose — `--scope beatapp`, `--label-enable`, et les
étiquettes correspondantes sur le seul service `beatapp`. Ne les retire pas.

Si tu fais **déjà** tourner un Watchtower sans `--scope`, il mettra à jour
Beatapp *et* tout le reste. Vérifie :

```bash
docker ps --filter ancestor=containrrr/watchtower --format '{{.Names}}'
docker inspect LE_NOM --format '{{.Config.Cmd}}'
```

S'il en existe un sans `--scope`, deux options : lui ajouter un scope, ou ne pas
lancer celui-ci (`docker compose up -d beatapp` seul) et laisser l'existant
gérer la mise à jour.

### Le port 8080 est peut-être déjà pris

```bash
sudo ss -ltnp | grep -E ':(8080|443|80)\b'
```

S'il est occupé, choisis-en un autre sans modifier le compose :

```bash
echo 'BEATAPP_PORT=8099' | sudo tee /srv/beatapp/.env
```

Pense alors à reporter le port dans le snippet nginx (`proxy_pass`).

### Ton reverse proxy est peut-être un conteneur

Le snippet fourni suppose un **nginx sur l'hôte**. Si tu utilises Traefik,
Caddy ou un nginx conteneurisé, l'intégration diffère :

- **nginx conteneurisé** : le `proxy_pass` doit viser le nom du service
  (`http://beatapp:8080`) et les deux conteneurs partager un réseau Docker,
  plutôt que de passer par `127.0.0.1`.
- **Traefik** : remplace la publication de port par des étiquettes de routage.

Dis-moi lequel tu utilises et j'adapte.

## Installation

### 1. Docker

Déjà installé ici. Vérification :

```bash
docker --version
docker compose version
docker ps        # inventaire de ce qui tourne déjà
```

### 2. Accès au registre

L'image est publiée sur `ghcr.io`. Si le dépôt est **privé**, il faut
s'authentifier une fois — un jeton avec la seule portée `read:packages` :

```bash
# https://github.com/settings/tokens → « Generate new token (classic) »
# Portée : read:packages
echo 'LE_JETON' | docker login ghcr.io -u shankubo --password-stdin
```

> Si tu rends le dépôt public, cette étape devient inutile.

### 3. Compose

```bash
sudo mkdir -p /srv/beatapp
sudo curl -o /srv/beatapp/docker-compose.yml \
  https://raw.githubusercontent.com/shankubo/beatapp/main/deploy/rpi/docker-compose.yml

cd /srv/beatapp
docker compose up -d
docker compose ps
```

Vérifie que le conteneur répond avant d'aller plus loin :

```bash
curl -I http://127.0.0.1:8080/beatapp/
```

### 4. nginx de l'hôte

```bash
sudo mkdir -p /etc/nginx/snippets
sudo curl -o /etc/nginx/snippets/beatapp.conf \
  https://raw.githubusercontent.com/shankubo/beatapp/main/deploy/rpi/nginx-beatapp.conf
```

Puis, dans le bloc `server` de **app.francotamouls.com** (celui qui porte déjà
le certificat TLS) :

```nginx
include /etc/nginx/snippets/beatapp.conf;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

C'est tout. Chaque push sur `main` sera servi automatiquement dans la minute.

## Commandes utiles

```bash
cd /srv/beatapp

docker compose logs -f beatapp        # journaux
docker compose pull && docker compose up -d   # mise à jour immédiate
docker compose ps                     # état et santé

# Revenir à une version précédente (le SHA est étiqueté à chaque build)
docker compose down
docker run -d --name beatapp -p 127.0.0.1:8080:8080 \
  ghcr.io/shankubo/beatapp:sha-LE_SHA_COMPLET
```

## Deux pièges à connaître

**Le service worker sert l'ancienne version au premier rechargement.** La PWA
est en `registerType: 'autoUpdate'` : la nouvelle version prend effet au
chargement *suivant*. Après un déploiement, un rechargement forcé
(Ctrl+Shift+R) affiche la version à jour tout de suite. C'est pourquoi
`index.html` et `sw.js` sont servis en `no-cache` — ce sont eux qui portent la
mise à jour.

**Ne pas ajouter de `add_header` dans le snippet nginx de l'hôte.** nginx
remplace alors la liste entière des en-têtes renvoyées par le conteneur, et
l'isolation cross-origin exigée par WebCodecs saute — l'export MP4 échouerait à
la toute fin du parcours, après tout le travail de montage.
