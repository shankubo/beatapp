# Image de Beatapp: nginx servant les fichiers deja construits.
#
# L'application est 100 % cliente — l'analyse du rythme et l'encodage MP4 se
# font dans le navigateur du visiteur. Le conteneur ne fait donc que servir des
# fichiers statiques, et sa charge sur un Raspberry Pi est negligeable.

# --- Etape 1: construction ---
#
# Elle tourne sur le RUNNER GitHub (amd64), jamais sur le RPi: un build Vite y
# prend plusieurs minutes et echoue par manque de memoire sur un modele a 1 Go.
# Seul le resultat est copie dans l'image finale, qui reste multi-architecture.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /app

# Les manifestes d'abord: cette couche est mise en cache tant que les
# dependances ne changent pas, et `npm ci` est de loin l'etape la plus longue.
COPY package.json package-lock.json ./
# `npm ci` et non `npm install`: il installe exactement le lockfile et echoue
# s'il ne correspond pas au package.json.
RUN npm ci

COPY . .

# Chemin de service. Passe en argument pour que la meme image puisse etre
# construite pour la racine si besoin.
ARG BASE_PATH=/beatapp/
ENV BASE_PATH=$BASE_PATH

# `build:noversion` et non `build`: ce dernier incremente la version dans
# package.json. Fait ICI, l'increment vivrait dans l'image sans jamais revenir
# au depot — la version affichee par l'application ne correspondrait donc a
# aucun commit. Le numero est deja pose par le poste qui publie.
#
# Les portes du projet (typecheck, lint, tests) tournent en amont dans le
# workflow: les rejouer ici doublerait le temps de build sans rien verifier.
RUN npm run build:noversion

# --- Etape 2: service ---
FROM nginx:1.27-alpine

# La configuration vit dans l'image: elle est ainsi versionnee avec le code
# qu'elle sert, et un `docker compose pull` la met a jour comme le reste.
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/beatapp

# nginx ecoute en 8080 et tourne sans privileges: un port au-dessus de 1024
# n'exige pas root, ce qui retire la principale raison de faire tourner un
# serveur web en tant que superutilisateur.
EXPOSE 8080

# Sonde de sante: `docker compose` et le redemarrage automatique s'en servent
# pour distinguer un conteneur vivant d'un conteneur qui repond encore au ping
# mais ne sert plus rien.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/beatapp/ || exit 1
