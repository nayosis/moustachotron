#!/bin/sh
# Met Le Moustachotron à une version publiée (étiquette Git), sur Raitchu, dans le dossier de la pile Dockge :
#
#   ./mettre-a-jour.sh v0.4.0
#
# Récupère le code avec la clé de déploiement (dépôt ./src), passe sur l'étiquette, reconstruit l'image et relance le
# conteneur. Les migrations de la base s'appliquent au démarrage ; la sauvegarde de la nuit reste dans data/sauvegardes.
set -eu
cd "$(dirname "$0")"
VERSION="${1:?Usage : ./mettre-a-jour.sh v0.4.0}"

git -C src fetch --tags --quiet
git -C src checkout --quiet "$VERSION"
echo "Code : $(git -C src describe --tags)"

# Version affichée par l'application et nom de l'image.
if grep -q '^APP_VERSION=' .env 2>/dev/null; then
  sed -i "s/^APP_VERSION=.*/APP_VERSION=${VERSION#v}/" .env
else
  echo "APP_VERSION=${VERSION#v}" >> .env
fi

docker compose up -d --build
# Anciennes images construites (les données ne sont pas touchées).
docker image prune -f >/dev/null
docker compose ps
