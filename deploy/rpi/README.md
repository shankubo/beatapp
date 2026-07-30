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

## État de la machine cible

Relevé sur **192.168.1.87** (`shan@`) :

| | |
| --- | --- |
| Architecture | `aarch64` — l'image arm64 convient |
| Système | Debian 13 (trixie) |
| Mémoire | 15 Go (aucune contrainte) |
| Disque | 839 Go libres |
| Docker | 29.3.1, Compose v5.1.1 |
| Reverse proxy | **nginx sur l'hôte**, ports 80/443 |
| Port 8080 | **libre** |
| Watchtower | **aucun** — rien qui risque de toucher tes autres conteneurs |

Conteneurs déjà en production : `saisietemps`, `pwa-asso` (4000),
`pwa-asso-adherents` (4001), `portainer` (9443).

### Le point qui demande une modification

`app.francotamouls.com` **redirige aujourd'hui tout son trafic** vers
`app.saisietemps.fr`, par un `return 301` au niveau du bloc `server`. Cette
directive s'applique avant tout `location`, donc ajouter `/beatapp/` ne
suffirait pas : l'application resterait inaccessible.

Il faut déplacer le `return` dans un `location /`, ce qui en fait le cas par
défaut au lieu d'une règle qui court-circuite tout. La marche à suivre exacte
est en tête de `nginx-beatapp.conf`.

## Tes autres conteneurs sont protégés

Par défaut, Watchtower met à jour **tout** ce qu'il trouve — y compris
`saisietemps`, `pwa-asso` et `portainer`. Le garde-fou est `--scope beatapp`,
appuyé par l'étiquette `com.centurylinklabs.watchtower.scope` que porte le seul
service `beatapp`. **Ne le retire pas.**

> Ne **pas** y ajouter `--label-enable` : mesuré, les deux filtres se cumulent
> au lieu de se renforcer, et Watchtower rapportait `scanned=0` — des cycles
> apparemment réussis, mais plus aucune mise à jour. Les journaux doivent dire
> « Only checking containers in scope ».

L'image utilisée est `nickfedor/watchtower` : l'originale `containrrr/watchtower`
n'est plus maintenue depuis 2023 et parle l'API Docker 1.25, que le démon refuse
depuis la version 25 (« client version 1.25 is too old », redémarrage en boucle).

Aucun autre Watchtower ne tourne sur la machine, donc rien n'entre en conflit.
Si tu en ajoutes un plus tard, vérifie qu'il porte un `--scope` :

```bash
docker ps --filter name=watchtower --format '{{.Names}}'
```

Un Watchtower sans `--scope` mettrait à jour tous tes conteneurs.

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

# Sauvegarde avant modification
sudo cp /etc/nginx/sites-available/francotamouls \
        /etc/nginx/sites-available/francotamouls.avant-beatapp
```

Édite ensuite `/etc/nginx/sites-available/francotamouls`, bloc **HTTPS** de
`app.francotamouls.com` (vers la ligne 120). Il se termine actuellement par :

```nginx
    return 301 https://app.saisietemps.fr$request_uri;
}
```

Remplace cette ligne par :

```nginx
    include /etc/nginx/snippets/beatapp.conf;

    # Déplacé dans un location : un `return` au niveau du server s'applique
    # avant tout location, et /beatapp/ serait redirigé comme le reste.
    location / {
        return 301 https://app.saisietemps.fr$request_uri;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -I https://app.francotamouls.com/beatapp/
# Vérifier que la redirection existante fonctionne toujours :
curl -I https://app.francotamouls.com/
```

C'est tout. Chaque push sur `main` sera servi automatiquement dans la minute.

## Vérifier qu'un déploiement a bien eu lieu

Le piège : `curl -I .../beatapp/steps/promo-720.webp` renvoie **200 même quand le
fichier n'existe pas**, parce que nginx retombe sur `index.html` (`try_files`).
Un code 200 ne prouve donc rien. C'est le **type MIME** qui tranche :

```bash
# Doit répondre image/webp. Si c'est text/html, l'ancien conteneur tourne encore.
curl -sI https://app.francotamouls.com/beatapp/steps/promo-720.webp \
  | grep -i content-type

# Comparer le bundle servi à celui du dernier build
curl -s https://app.francotamouls.com/beatapp/ | grep -oE 'assets/index-[^"]+\.js'
```

### Si le conteneur ne se met pas à jour

Watchtower tire depuis un paquet **privé** : sans authentification au registre,
il échoue silencieusement, boucle sans rien faire, et le site continue de servir
l'ancienne version. Deux issues, au choix :

```bash
# A. Rendre le paquet public — le plus simple, l'image ne contient que des
#    fichiers statiques déjà publics sur le site.
#    github.com/users/shankubo/packages/container/beatapp/settings
#    → « Change visibility » → Public

# B. Authentifier le RPi une fois pour toutes (jeton classique, read:packages)
echo 'LE_JETON' | docker login ghcr.io -u shankubo --password-stdin
sudo mkdir -p /root/.docker && sudo cp ~/.docker/config.json /root/.docker/
docker restart beatapp-watchtower
```

> Watchtower tourne en `root` : le `docker login` d'un utilisateur normal ne lui
> sert à rien, d'où la copie du `config.json`.

Diagnostic sur la machine :

```bash
docker logs --tail 50 beatapp-watchtower   # « unauthorized » ? c'est le cas ci-dessus
docker compose -f /srv/beatapp/docker-compose.yml pull   # reproduit l'erreur en clair
```

Mise à jour immédiate, sans attendre Watchtower :

```bash
cd /srv/beatapp && docker compose pull && docker compose up -d
```

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
