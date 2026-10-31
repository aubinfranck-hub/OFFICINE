# Mettre le LGO en ligne (version complète)

Trois façons d'utiliser le LGO — **chaque officine en choisit une** :

| Mode | Où sont les données | Pour qui |
|---|---|---|
| **Officine** (`MODE=local`) | sur le PC de la pharmacie | pharmacie qui doit vendre même sans internet. Copie web en lecture seule pour le pharmacien (`MODE=cloud`). |
| **En ligne complet** (`MODE=online`) | sur le serveur web | pharmacie qui veut travailler directement sur le web, depuis n'importe quel appareil. |

> Une officine ne doit jamais avoir **deux** copies qui vendent en même temps (PC + web) : les stocks se contrediraient.

## Version en ligne complète
- Toutes les fonctions du comptoir, du stock, des achats, de la caisse, du tiers payant, des stupéfiants et des statistiques.
- Chaque personne a **son identifiant et son mot de passe** (double sécurité Google Authenticator en option). Le PIN est désactivé en ligne.
- Le titulaire donne ou retire **chaque fonction, case par case** (Réglages → Équipe → Habilitations). Les changements s'appliquent immédiatement.
- Sauvegarde automatique chaque jour, téléchargeable depuis Réglages → Sauvegardes et exports.
- La tablette garde en mémoire le catalogue et les ventes si la connexion tombe, puis renvoie les ventes toute seule.

### Option A — Render (le plus simple)
Il faut un **disque permanent** : offre payante *Starter* + disque de 1 Go. Render → New → Blueprint → ce dépôt (fichier `render.yaml`), puis renseigner : nom de l'officine, email, mot de passe, clé Google Authenticator.
*L'offre gratuite de Render efface les données à chaque redémarrage : ne l'utilise que pour essayer.*

### Option B — Serveur Linux (Contabo, Hostinger…)
`bash deploiement/vps-installer.sh pharmacie.mon-domaine.ci mon@email.ci` (installe Node, le service, le HTTPS). Le script est fourni sans avoir été testé sur un vrai serveur : essaie-le d'abord sur un serveur de test.

### Essayer sans risque
Variables `MODE=online DEMO=1 INIT_TOTP=<clé>` : crée un jeu de données fictif (35 produits, 14 jours de ventes).
