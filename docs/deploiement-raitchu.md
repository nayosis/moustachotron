# Déployer Le Moustachotron sur Raitchu (Dockge)

Dépôt privé : https://github.com/nayosis/moustachotron. Serveur : Raitchu, avec **Dockge**. Adresse :
**https://moustachotron.gouadon.fr**.

## Vue d'ensemble

```
PC (code) ──git push + étiquette v0.4.2──► GitHub (dépôt privé, Actions : tests)
                                              │ clé de déploiement (SSH, lecture seule, ce dépôt seulement)
                                              ▼
                     Raitchu : /opt/stacks/moustachotron/src  (git fetch + checkout v0.4.2)
                                              │ docker compose up -d --build  (pile Dockge)
                                              ▼
                     conteneur moustachotron (127.0.0.1:3000, données dans ./data)
                                              │
                     reverse proxy HTTPS ──► https://moustachotron.gouadon.fr
```

**Pourquoi une clé de déploiement** : elle ne donne accès qu'à **ce dépôt**, en **lecture seule**, et ne dépend
d'aucun compte personnel ni jeton à renouveler. Elle ne permet pas de lire le registre d'images ghcr.io : Raitchu
**construit donc l'image lui-même** à partir du code (une à deux minutes à chaque mise à jour). L'autre voie — image
construite par GitHub et téléchargée avec un jeton — est décrite en annexe.

## 1. Sur le PC : publier une version

Le code est sur GitHub (branche `main`). Une **version** est une étiquette `vX.Y.Z` égale à la version de
`package.json` (le CHANGELOG dit ce qu'elle contient) :

```powershell
git push
```

```powershell
git tag v0.4.2; git push origin v0.4.2
```

Attendre que l'onglet **Actions** du dépôt soit vert (tests). Avant chaque nouvelle version : augmenter `version` dans
`package.json` et compléter `CHANGELOG.md`.

> L'étiquette déclenche aussi le workflow « Publication », qui pousse une image sur ghcr.io : inutile avec la clé de
> déploiement, mais sans conséquence (et prête si tu passes un jour à l'annexe A).

## 2. Une seule fois : la clé de déploiement

Sur Raitchu, en SSH, **avec l'utilisateur qui gère les piles Dockge** (souvent `root`, car `/opt/stacks` lui
appartient ; sinon adapter les chemins) :

```bash
sudo -i
ssh-keygen -t ed25519 -N "" -C "raitchu – moustachotron (lecture)" -f /root/.ssh/moustachotron_deploy
cat /root/.ssh/moustachotron_deploy.pub
```

Sur GitHub : dépôt `moustachotron` → **Settings** → **Deploy keys** → **Add deploy key** :
- Title : `Raitchu (lecture)` ;
- Key : coller la ligne `ssh-ed25519 …` affichée ;
- **ne pas cocher** « Allow write access ».

Toujours sur Raitchu, un alias SSH pour que Git utilise cette clé-là (et seulement pour ce dépôt) :

```bash
cat >> /root/.ssh/config <<'EOF'
Host github-moustachotron
    HostName github.com
    User git
    IdentityFile /root/.ssh/moustachotron_deploy
    IdentitiesOnly yes
EOF
chmod 600 /root/.ssh/config /root/.ssh/moustachotron_deploy
ssh -T github-moustachotron
```

La dernière commande répond « Hi nayosis/moustachotron! You've successfully authenticated… » (accepter l'empreinte
de github.com à la première connexion).

## 3. Une seule fois : la pile Dockge

Dockge range ses piles dans `/opt/stacks` (vérifier le dossier choisi à son installation, variable
`DOCKGE_STACKS_DIR`). Récupérer le code dans la future pile :

```bash
mkdir -p /opt/stacks/moustachotron && cd /opt/stacks/moustachotron
git clone git@github-moustachotron:nayosis/moustachotron.git src
cp src/docker/dockge/compose.yaml compose.yaml
cp src/docker/dockge/mettre-a-jour.sh mettre-a-jour.sh && chmod +x mettre-a-jour.sh
cat > .env <<'EOF'
APP_VERSION=0.4.2
APP_PORT=3000
TZ=Europe/Paris
APP_SAUVEGARDES_CONSERVEES=14
EOF
chmod 600 .env
./mettre-a-jour.sh v0.4.2
```

Le premier lancement construit l'image (une à deux minutes), applique les migrations et démarre le conteneur.

Dans **Dockge**, la pile `moustachotron` apparaît (sinon : bouton *Scan Stacks Folder*). On y voit l'état, les
journaux, et on peut arrêter / relancer. Le fichier `compose.yaml` et le `.env` y sont modifiables ; ne pas y coller
de mot de passe d'administrateur si l'écran de création au premier lancement suffit.

Contrôle sur Raitchu : `curl -s http://127.0.0.1:3000/api/sante` → `{"ok":true,"version":"0.4.2"}`.

Arborescence obtenue :

```
/opt/stacks/moustachotron/
├── compose.yaml          pile Dockge (construit l'image depuis ./src)
├── .env                  version, port, fuseau
├── mettre-a-jour.sh      passer à une autre version
├── src/                  code (clé de déploiement, lecture seule)
└── data/                 base, fichiers, sauvegardes de la nuit  ← à sauvegarder
```

## 4. HTTPS sur moustachotron.gouadon.fr

L'application installée sur le téléphone, le hors ligne et les notifications n'existent qu'en **HTTPS**.

### 4.1 DNS

Zone DNS de `gouadon.fr` chez le registrar :

| Type | Nom | Valeur |
|---|---|---|
| `A` | `moustachotron` | adresse IPv4 publique de la box / de Raitchu |
| `AAAA` (si IPv6) | `moustachotron` | adresse IPv6 publique de Raitchu |

Ou `CNAME moustachotron → raitchu.gouadon.fr.` si ce nom existe déjà. Vérifier depuis le PC :

```powershell
Resolve-DnsName moustachotron.gouadon.fr
```

Raitchu derrière une box : rediriger les ports **80 et 443** vers Raitchu (le 80 sert au certificat Let's Encrypt).
IP publique qui change : DNS dynamique chez le registrar (ou `ddclient`).

### 4.2 Reverse proxy

Le conteneur n'écoute que sur `127.0.0.1:3000` (voir `compose.yaml`) : seul le reverse proxy de Raitchu y accède.

**Caddy** (certificat obtenu et renouvelé tout seul) — `/etc/caddy/Caddyfile` :

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
systemctl reload caddy && curl -I https://moustachotron.gouadon.fr/api/sante
```

**nginx** : partir de `docker/nginx-exemple.conf` (remplacer `app.example.org` par `moustachotron.gouadon.fr`), puis
`certbot --nginx -d moustachotron.gouadon.fr`.

**Proxy lui-même dans Dockge** (Caddy, Nginx Proxy Manager, Traefik en conteneur) : `127.0.0.1` désigne alors le
conteneur du proxy, pas Raitchu. Mettre les deux piles sur un même réseau Docker et viser `moustachotron:3000`, ou
viser l'adresse de Raitchu sur le pont Docker (`172.17.0.1:3000`) en publiant le port sur cette adresse.

### 4.3 Contrôle

- `https://moustachotron.gouadon.fr` affiche la connexion, cadenas valide.
- Sur le téléphone : ouvrir l'adresse, menu du navigateur → **Ajouter à l'écran d'accueil** (iPhone : Safari →
  Partager → Sur l'écran d'accueil).

## 5. Y mettre tes données actuelles

La base du PC contient la reprise des tableurs (mouvements, charges, chantiers) :

1. Sur Raitchu, créer ton compte administrateur à l'écran (premier lancement).
2. Sur le PC (appli lancée) : **Sauvegarde** → **Télécharger une sauvegarde** (ZIP : base + fichiers).
3. Sur Raitchu : **Sauvegarde** → **Restaurer** → choisir le ZIP.

Les comptes ne voyagent pas dans la sauvegarde (propres à chaque installation). Ensuite, c'est **Raitchu** qui fait
foi : ne plus saisir sur le PC.

## 6. Mettre à jour

Après une nouvelle étiquette (§ 1, Actions vertes), sur Raitchu :

```bash
/opt/stacks/moustachotron/mettre-a-jour.sh v0.4.3
```

Revenir à la version précédente : `./mettre-a-jour.sh v0.4.2` (et restaurer la sauvegarde de la nuit si une
migration a été appliquée entre-temps). Le bouton *Update* de Dockge ne suffit pas ici : il télécharge des images,
il ne reconstruit pas depuis le code.

## 7. Sauvegardes

- Une sauvegarde complète chaque nuit dans `/opt/stacks/moustachotron/data/sauvegardes` (14 gardées).
- La copier **hors de Raitchu** (NAS, disque externe, cloud chiffré), par exemple chaque jour :

```bash
0 4 * * * rsync -a --delete /opt/stacks/moustachotron/data/sauvegardes/ /mnt/sauvegardes/moustachotron/
```

## 8. Dépannage

| Message | Cause probable | Solution |
|---|---|---|
| `Permission denied (publickey)` au `git` | clé non ajoutée au dépôt, alias SSH absent, autre utilisateur (sans `sudo -i`) | refaire § 2 avec le même utilisateur ; `ssh -T github-moustachotron` |
| `ERROR: Repository not found` | URL sans l'alias (`git@github.com:` au lieu de `git@github-moustachotron:`) | `git -C src remote set-url origin git@github-moustachotron:nayosis/moustachotron.git` |
| `error: pathspec 'v0.4.3' did not match` | étiquette pas encore poussée | `git push origin v0.4.3` sur le PC |
| construction lente ou interrompue (mémoire) | petite machine | fermer d'autres piles pendant la construction ; ou annexe A (image construite par GitHub) |
| page blanche, « verrou d'instance » dans les journaux | deux conteneurs sur le même `data/` | dans Dockge, n'en garder qu'un |
| 502 du reverse proxy | conteneur arrêté, ou proxy dans un conteneur visant `127.0.0.1` | journaux Dockge ; § 4.2, cas du proxy dans Dockge |
| téléphone : pas d'installation possible | site en HTTP | § 4 |

## Annexe A — Image construite par GitHub (ghcr.io) avec un jeton

À préférer si Raitchu est trop juste pour construire l'image, ou pour ne plus avoir le code sur le serveur.

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** : portée
   **uniquement `read:packages`**, expiration 1 an. (Le registre ghcr.io n'accepte pas les clés de déploiement, et
   gère mal les jetons *fine-grained*.)
2. Dockge exécute `docker compose` **depuis son propre conteneur** : c'est là qu'il faut se connecter au registre.

```bash
docker exec -it dockge docker login ghcr.io -u nayosis
```

   (coller le jeton quand le mot de passe est demandé). Pour que la connexion survive à une recréation de Dockge,
   monter `/root/.docker` du conteneur Dockge sur un dossier de Raitchu dans la pile de Dockge.
3. Dans `compose.yaml`, remplacer le bloc `build:` et la ligne `image:` par
   `image: ghcr.io/nayosis/moustachotron:${APP_VERSION:-latest}`. Les mises à jour se font alors avec le bouton
   *Update* de Dockge (ou `docker compose pull && docker compose up -d`).
