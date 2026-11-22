# Déployer Le Moustachotron sur Raitchu

Raitchu récupère l'image Docker publiée par GitHub (ghcr.io) depuis un **dépôt privé** : l'image est donc privée
aussi, et Raitchu doit s'authentifier pour la télécharger. Ce guide va du code sur ton PC jusqu'à l'appli en HTTPS.

> Dépôt : https://github.com/nayosis/moustachotron (privé) ; image : `ghcr.io/nayosis/moustachotron`.

## Vue d'ensemble

```
PC (code) ──git push + étiquette v0.4.0──► GitHub (dépôt privé)
                                              │ Actions « Publication » : tests, image amd64 + arm64
                                              ▼
                                     ghcr.io/nayosis/moustachotron  (paquet privé)
                                              │ docker login (jeton « read:packages »)
                                              ▼
                                    Raitchu : docker compose pull && up -d
                                              │ port 3000
                                              ▼
                              reverse proxy HTTPS ──► https://moustachotron.gouadon.fr
```

## 1. Une seule fois : mettre le code sur GitHub

Sur le PC, dans `D:\dev\src\rc-tools` :

1. Vérifier que rien de privé ne part : `.gitignore` exclut `data/` (ta base réelle), `.env` (mot de passe de
   test) et `docs/sources/` (tableurs et rapports du client). Le contrôler avant chaque premier envoi :

```powershell
git status --short
```

   La liste ne doit contenir **ni** `data/`, **ni** `.env`, **ni** `docs/sources/`.

2. Premier envoi (GitHub demandera de te connecter dans le navigateur la première fois) :

```powershell
git commit -m "Le Moustachotron 0.4.0"
```

```powershell
git branch -M main; git remote add origin https://github.com/nayosis/moustachotron.git; git push -u origin main
```

## 2. Publier une version (à chaque mise à jour)

L'image est construite par GitHub quand une **étiquette** `vX.Y.Z` égale à la version de `package.json` est poussée
(workflow `.github/workflows/publication.yml` : tests, image multi-architecture, release).

```powershell
git tag v0.4.0; git push origin v0.4.0
```

Suivre l'onglet **Actions** du dépôt. Au premier succès, le paquet apparaît dans GitHub → ton profil → **Packages**
→ `moustachotron`. Il est **privé** comme le dépôt : c'est voulu.

> `package.json` est en 0.4.0 : à chaque version, l'augmenter (et le CHANGELOG) avant l'étiquette, sinon le workflow
> s'arrête à « L'étiquette correspond à package.json ».

## 3. Une seule fois : donner à Raitchu le droit de télécharger l'image

### 3.1 Créer un jeton en lecture seule

GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** →
**Generate new token (classic)** :

- Note : `Raitchu – lecture ghcr` ;
- Expiration : 1 an (noter la date : il faudra le renouveler) ;
- Portée : **uniquement `read:packages`** (rien d'autre : ce jeton ne peut ni lire le code, ni publier).

Copier le jeton (`ghp_…`) : il ne s'affiche qu'une fois. Les jetons « fine-grained » ne gèrent pas encore bien le
registre de conteneurs : prendre un jeton *classic*.

### 3.2 Se connecter au registre depuis Raitchu

En SSH sur Raitchu (le jeton est lu au clavier, il ne reste pas dans l'historique du shell) :

```bash
read -s GHCR_TOKEN && echo "$GHCR_TOKEN" | docker login ghcr.io -u nayosis --password-stdin && unset GHCR_TOKEN
```

« Login Succeeded » : Docker garde l'accès dans `~/.docker/config.json` (de l'utilisateur qui lance
`docker compose`). Le protéger : `chmod 600 ~/.docker/config.json`.

- **Portainer** : *Registries* → *Add registry* → *Custom* → URL `ghcr.io`, authentification avec `nayosis` et le
  jeton ; puis choisir ce registre dans la pile.
- **Synology Container Manager** : *Registre* → *Paramètres* → *Ajouter* → `https://ghcr.io`, nom d'utilisateur et
  jeton.
- **Docker lancé en root (sudo)** : faire le `docker login` avec `sudo` aussi, sinon `pull` ne verra pas l'accès.

## 4. Installer sur Raitchu

```bash
sudo mkdir -p /opt/moustachotron && sudo chown "$USER" /opt/moustachotron && cd /opt/moustachotron
```

Copier `docker-compose.yml` du dépôt dans ce dossier (ou `curl` avec le jeton, le fichier étant privé), puis créer
`/opt/moustachotron/.env` :

```bash
cat > .env <<'EOF'
# Version de l'image : « latest », ou « 0.4 » pour rester sur les 0.4.x.
APP_VERSION=latest
APP_PORT=3000
TZ=Europe/Paris
# Dépôt privé : la vérification des nouvelles versions sur GitHub échouerait sans jeton → désactivée.
APP_VERIFIER_MISES_A_JOUR=non
APP_SAUVEGARDES_CONSERVEES=14
EOF
chmod 600 .env
```

Lancer :

```bash
docker compose pull && docker compose up -d && docker compose logs -f --tail=50
```

Les logs affichent « Migrations appliquées… » puis l'adresse. `http://raitchu:3000` doit répondre (créer alors le
compte administrateur à l'écran, ou le définir dans `.env` avec `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_MOT_DE_PASSE`).

## 5. HTTPS sur moustachotron.gouadon.fr (obligatoire pour le téléphone hors ligne et les notifications)

L'application installée sur le téléphone, le hors ligne (phase 3b) et les notifications n'existent qu'en **HTTPS**.
Adresse retenue : **https://moustachotron.gouadon.fr**.

### 5.1 DNS

Chez le registrar de `gouadon.fr` (zone DNS), créer l'enregistrement qui mène à Raitchu :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `moustachotron` | adresse IPv4 publique de la box / de Raitchu |
| `AAAA` (si IPv6) | `moustachotron` | adresse IPv6 publique de Raitchu |

Ou, si `raitchu.gouadon.fr` existe déjà : `CNAME moustachotron → raitchu.gouadon.fr.`. Vérifier depuis le PC :

```powershell
Resolve-DnsName moustachotron.gouadon.fr
```

Raitchu derrière une box : rediriger les ports **80 et 443** de la box vers Raitchu (le 80 sert au certificat Let's
Encrypt). Adresse IP publique qui change : un DNS dynamique chez le registrar (ou `ddclient` sur Raitchu).

### 5.2 Reverse proxy

**Caddy** (le plus simple : certificat obtenu et renouvelé tout seul). `/etc/caddy/Caddyfile` :

```
moustachotron.gouadon.fr {
    reverse_proxy 127.0.0.1:3000 {
        # Mise à jour en direct (événements continus) : pas de mise en mémoire tampon.
        flush_interval -1
    }
    header X-Robots-Tag "noindex, nofollow"
}
```

```bash
sudo systemctl reload caddy && curl -I https://moustachotron.gouadon.fr/api/sante
```

**nginx** (s'il tourne déjà sur Raitchu) : partir de `docker/nginx-exemple.conf` en remplaçant `app.example.org` par
`moustachotron.gouadon.fr`, puis `sudo certbot --nginx -d moustachotron.gouadon.fr` pour le certificat.

Le proxy étant sur Raitchu, n'exposer le conteneur qu'à la machine elle-même : dans `docker-compose.yml`, mapper le
port en `"127.0.0.1:3000:3000"` (sinon `http://raitchu:3000` contournerait le HTTPS).

**Sans ouvrir de port** (alternative) : Tailscale sur Raitchu et le téléphone, `tailscale serve --bg 3000` →
`https://raitchu.<tailnet>.ts.net`, accessible de tes seuls appareils (le domaine n'est alors pas utilisé).

### 5.3 Contrôle

- `https://moustachotron.gouadon.fr` affiche la connexion, cadenas valide.
- Sur le téléphone : ouvrir l'adresse, menu du navigateur → **Ajouter à l'écran d'accueil** (iPhone : Safari →
  Partager → Sur l'écran d'accueil). L'appli s'ouvre alors en plein écran.

## 6. Y mettre tes données actuelles

La base de développement du PC contient la reprise des tableurs (mouvements, charges, chantiers). Pour la
transférer :

1. Sur le PC (appli lancée) : menu **Sauvegarde** → **Télécharger une sauvegarde** (ZIP : base + fichiers).
2. Sur Raitchu (connecté avec le compte super admin) : **Sauvegarde** → **Restaurer** → choisir le ZIP.

Les comptes ne voyagent pas dans la sauvegarde (ils sont propres à chaque installation) : créer ton compte sur
Raitchu avant de restaurer. Une fois Raitchu en service, c'est **lui** qui fait foi : ne plus saisir sur le PC.

## 7. Mettre à jour

Après une nouvelle étiquette (§ 2) et la fin du workflow :

```bash
cd /opt/moustachotron && docker compose pull && docker compose up -d
```

Les migrations s'appliquent au démarrage ; une sauvegarde de la nuit précédente est toujours dans
`data/sauvegardes`. Pour revenir en arrière : `APP_VERSION=0.4.0` dans `.env` puis la même commande (et restaurer la
sauvegarde si une migration avait été appliquée).

## 8. Sauvegardes

- Une sauvegarde complète chaque nuit dans `/opt/moustachotron/data/sauvegardes` (14 gardées).
- Copier ce dossier **hors de Raitchu** (NAS, disque externe, cloud chiffré) : une sauvegarde sur la même machine ne
  protège pas d'une panne de disque. Exemple quotidien avec `rsync` dans la crontab de Raitchu :

```bash
0 4 * * * rsync -a --delete /opt/moustachotron/data/sauvegardes/ /mnt/sauvegardes/moustachotron/
```

## 9. Dépannage

| Message | Cause probable | Solution |
|---|---|---|
| `denied` / `unauthorized` au `pull` | pas connecté au registre, jeton expiré, portée sans `read:packages`, `docker login` fait avec un autre utilisateur (sudo) | refaire § 3 avec le même utilisateur que `docker compose` |
| `manifest unknown` | étiquette absente (workflow pas fini ou en échec), nom en majuscules | onglet Actions ; vérifier `ghcr.io/nayosis/moustachotron` en minuscules |
| `no matching manifest for linux/arm…` | architecture | l'image est publiée en amd64 et arm64 : vérifier que le workflow est allé au bout |
| page blanche, « verrou d'instance » dans les logs | deux conteneurs sur le même dossier `data` | `docker ps`, n'en garder qu'un |
| téléphone : pas d'installation possible | site en HTTP | passer en HTTPS (§ 5) |
| le jeton a expiré | — | en recréer un (§ 3.1), refaire `docker login` |
