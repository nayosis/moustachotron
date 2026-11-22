# Rapport de visite (compte rendu de chantier)

Spécification tirée de l'exemple fourni le 22/11/2026 (`docs/sources/…Rapport de visite n°5.pdf`, **hors dépôt**,
données réelles). Aujourd'hui produit dans un tableur Excel : contenu bon, saisie et mise en forme pénibles, pas de
photos. Le PDF généré par l'appli reprend **la même structure**, avec des photos.

## Principe : un rapport cumulatif

Le rapport n°N **reprend le rapport n°N-1** et le complète. « Nouvelle visite » pré-remplit donc tout depuis le
rapport précédent du projet : présences remises à zéro, avancements et constats repris, observations à revoir.
Une visite peut couvrir **plusieurs dates** (« visites du 29 & 30/06 et 3, 6, 8 & 9/07 »).

## Structure du PDF

| Bloc | Contenu | Source dans l'appli |
|---|---|---|
| En-tête | logo du réseau, intitulé de l'opération (« Transformation partielle d'une maison d'habitation »), n° de dossier + adresse, « Rapport d'assistance à maîtrise d'ouvrage n°N » (ou MOE selon la mission), dates des visites | projet, mission, numéro auto |
| Intervenants | une ligne par partie : maître d'ouvrage, AMO, puis **chaque lot** (n°, corps d'état), entreprise, représentant ; colonnes **Présent / Absent / Retard / Excusé**, **Convoqué au prochain RV**, **Diffusion**, téléphone, e-mail | contacts du projet et des lots ; présence et convocation saisies à chaque visite |
| Principaux sujets de la réunion à venir | texte court | visite |
| Note générale | I Réunion de chantier, II Points généraux – modalités d'accès | **textes types** + fiche chantier |
| Fiche chantier | adresse, **conditions d'accès (clés, codes, horaires)**, stationnement, aire de stockage | projet (champs « accès ») |
| Clauses | nettoyage, sous-traitance, facturation, plans d'exécution | **textes types** paramétrables |
| III Délais – planning – formalités | version du planning et date d'envoi ; **Dépôt DP, Acceptation DP, Affichage, Arrêté DP n°, DOC déposée, Début des travaux, Réception, Levée de réserves, DAACT déposée** ; prescriptions DP | jalons et champs d'urbanisme du projet |
| IV à VI, « À toutes les entreprises », Sécurité | choix des matériaux, approvisionnements, pré-réception / réception / levée des réserves, règles de l'art, interdiction de fumer, EPI, point d'eau / WC | **textes types** |
| **Un bloc par lot** | titre « Lot n° : corps d'état — entreprise », **Avancement %** | lot |
| — Avancement | jalons du lot (« Devis validé le…, Acompte versé sur le compte séquestre le…, Déblocage d'acompte demandé le…, Devis travaux complémentaires validé le… ») puis **constats cumulés** (« Tableau électrique déplacé ») | jalons du lot + constats repris d'une visite à l'autre |
| — Observations | lignes datées ou non (« 16/07 : raccordement tableau »), certaines **en rouge = importantes** | observations de la visite, drapeau « important », date prévue facultative |
| — Photos | nouveau : photos du lot, légendées | photos de la visite rattachées au lot |
| Pied | approbation du rapport précédent (texte type), « Rapport établi le…, par…, agence… », **signature** | textes types, utilisateur, image de signature dans Paramètres |

## Ce que cela ajoute au modèle

- **Visite** : numéro (auto par projet), dates (1..n), mission (AMO/MOE → intitulé), sujets de la réunion à venir,
  envoyée le, figée une fois envoyée.
- **Présence** (visite × intervenant) : présent / absent / retard / excusé, convoqué au prochain RV, destinataire.
- **Point de lot** (visite × lot) : avancement %, constats (liste ordonnée, reprise de la visite précédente),
  observations (texte, date prévue facultative, important oui/non), photos.
- **Jalons du lot** : devis validé, acompte versé (compte séquestre), déblocage d'acompte demandé, devis de
  travaux complémentaires validé (avenant, avec montant → recalcul des honoraires), facture validée…
- **Urbanisme du projet** : dépôt / acceptation / affichage / arrêté DP (n°), DOC, DAACT, prescriptions.
- **Accès au chantier** : adresse, conditions d'accès, stationnement, stockage. Les **codes d'accès** sont des
  données sensibles : visibles dans l'appli et dans le PDF (comme aujourd'hui), jamais dans le journal en clair
  ni dans les notifications ; sur le téléphone ils font partie du paquet terrain (appareil à verrouiller).
- **Textes types** : bibliothèque de paragraphes dans Paramètres, par mission, avec une version par défaut reprise
  de l'exemple ; modifiables par projet si besoin.
- **Planning** : une observation datée « du 15 au 17/07 : parquet » peut alimenter l'agenda du chantier (hors V1 :
  simple texte au départ).

## Saisie sur le téléphone (hors ligne)

Écran visite en trois temps : **qui est là** (cases présent / absent / excusé par intervenant) → **lot par lot**
(curseur d'avancement, constats repris à cocher ou compléter, observations, photos, dictée) → **sujets du prochain
RV**. Le PDF se génère sur le serveur au retour du réseau ; l'utilisateur le relit sur l'ordinateur et l'envoie.
