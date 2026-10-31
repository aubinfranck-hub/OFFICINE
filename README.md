# LGO — Logiciel de Gestion d'Officine (Côte d'Ivoire)

Un vrai logiciel de pharmacie qui **fonctionne sans internet** à l'officine, avec une **caisse tactile pour tablettes** et un **portail web** pour que le pharmacien suive son officine à distance.

```
Tablettes / PC de l'officine ──(WiFi local)──▶  Serveur LGO local (1 PC dans la pharmacie)
                                                      │  envoi automatique quand internet revient
                                                      ▼
Pharmacien (téléphone, n'importe où) ──web──▶  Serveur LGO cloud (copie en lecture seule)
```

## Fonctions
**Comptoir** — recherche par nom, DCI ou code-barres · équivalents par DCI (du moins cher au plus cher) · remises · paiement mixte (espèces, Wave, Orange, MTN, Moov, chèque, crédit) avec rendu de monnaie · vente à crédit (ardoise) · tiers payant avec n° d'adhérent · ordonnance et prescripteur · ventes en attente · ticket imprimable · raccourcis F2 (recherche) et F4 (encaisser) · **vente possible même si le serveur est éteint** (la tablette garde la vente et la renvoie).

**Produits et stock** — fiche complète (DCI, dosage, forme, famille, laboratoire, emplacement, prix d'achat et de vente, marge, stock min/max) · import du catalogue par fichier CSV/Excel · lots avec péremption et vente « premier périmé, premier sorti » · alertes (ruptures, stocks bas, péremptions, périmés) · pertes et ajustements · journal des mouvements · inventaire avec comptage et correction des écarts.

**Achats** — suggestion de commande automatique (stock, ventes des 30 jours, commandes en cours) · bon de commande à imprimer ou envoyer par WhatsApp · réception de livraison (lots, péremptions, nouveaux prix) · dettes et paiements fournisseurs.

**Caisse** — ouverture avec fond de caisse, entrées/sorties d'espèces, clôture avec comptage et écart · paiements mobile money « à confirmer » par le pharmacien.

**Clients** — fiches, historique, dette et règlements, points de fidélité.

**Tiers payant** — parts des organismes à facturer, bordereaux imprimables, suivi des paiements, taux configurés par le pharmacien.

**Stupéfiants** — registre automatique (entrées, sorties, solde, patient, prescripteur, ordonnance), imprimable.

**Pilotage** — chiffre d'affaires, marge, panier moyen, graphique par jour, modes de paiement, familles, vendeurs, analyse ABC, produits dormants, valeur du stock, créances et dettes.

**Équipe et sécurité** — 4 rôles (titulaire, pharmacien adjoint, préparateur, vendeur) avec droits distincts · titulaire : mot de passe + code Google Authenticator (pas de SMS) · employés : PIN, accepté **uniquement sur le réseau de l'officine** · blocage après 5 essais · journal d'audit · le serveur recalcule tous les prix · aucun mot de passe ni PIN n'est envoyé sur internet.

## Installer à l'officine (Windows)
1. Installer **Node.js 22 ou plus** (nodejs.org).
2. Copier le dossier du logiciel sur le PC, puis copier `config-lgo.exemple.bat` en `config-lgo.bat` et y mettre l'adresse du site web et la clé d'envoi (facultatif : sans cela, pas de version web).
3. Double-cliquer sur **Demarrer-LGO.bat**. La fenêtre affiche l'adresse à ouvrir sur les tablettes (même WiFi). Au premier lancement : écran « Installer l'officine ».
4. Mises à jour : double-clic sur **Mettre-a-jour-LGO.bat** (récupère la dernière version, ne touche pas aux données).
5. **Sauvegarde** : copier `lgo.db` chaque soir (clé USB ou cloud).

Mode démonstration : `npm run seed` crée un catalogue et 14 jours de ventes fictifs.

## Version web du pharmacien
Sur un hébergeur (Render, VPS), derrière HTTPS :
```
MODE=cloud SYNC_KEY=<clé-secrète> INIT_EMAIL=<email> INIT_MDP=<mot-de-passe> INIT_TOTP=<clé-authenticator> npm start
```
L'officine envoie ses données toutes les 15 secondes quand internet est disponible (`CLOUD_URL` et `SYNC_KEY` dans `config-lgo.bat`). Si l'hébergeur perd ses données, l'officine les renvoie toute seule.

## Tests
`npm test` : 47 vérifications du serveur (migration depuis l'ancienne version, droits, FEFO, paiements, retours, caisse, tiers payant, inventaire, stupéfiants, statistiques, synchronisation cloud).

## Limites connues
- Pas de connexion aux bases officielles de médicaments (interactions, remboursements) : le catalogue est celui de l'officine.
- Impression de ticket via le navigateur (imprimante thermique réglée comme imprimante Windows).
- La clé d'authentification du titulaire est stockée en clair dans la base (à chiffrer avant déploiement à grande échelle).
- HTTPS en local nécessaire pour que la tablette s'ouvre même si le PC de l'officine est éteint.
