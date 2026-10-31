# LGO — Logiciel de Gestion d'Officine (Côte d'Ivoire)

Fonctionne **sans internet** dans la pharmacie. Les vendeuses vendent sur **tablette**. Le pharmacien consulte **à distance** sur le web (comme Smokehouse Devis).

```
Tablettes / PC de l'officine ──(WiFi local)──▶  Serveur LGO local (1 PC dans la pharmacie)
                                                      │  envoi automatique quand internet revient
                                                      ▼
Pharmacien (téléphone, n'importe où) ──web──▶  Serveur LGO cloud (VPS, copie en lecture)
```

## Ce qui est fait
- **Caisse tablette** (PWA) : recherche, panier, Espèces / Wave / Orange / MTN / Moov / Bon de santé. Si le serveur est injoignable, la vente est gardée sur la tablette et renvoyée toute seule.
- **Stock par lots, FEFO** : le lot qui périme en premier part en premier ; les lots périmés ne sont jamais vendus.
- **Bons de santé** : organismes et taux configurés par le pharmacien (part patient / part organisme).
- **Mobile money** : paiement « à confirmer » tant que le titulaire ne l'a pas vérifié.
- **Portail titulaire** : tableau du jour (CA, par mode, par vendeuse, top produits), alertes (ruptures, stock bas, péremptions, périmés), réception de lots, ventes (confirmer / annuler), équipe, journal d'audit.
- **Sécurité** : titulaire = mot de passe + code d'application d'authentification (pas de SMS). Vendeuses = PIN, accepté **uniquement depuis le réseau de l'officine**. Blocage 5 minutes après 5 essais. Le serveur recalcule les prix (le client n'est jamais cru). Aucun compte par défaut. Le cloud ne reçoit ni mot de passe, ni PIN, ni clé TOTP.
- Pas de FNE dans ce produit.

## Lancer (démo)
```bash
npm run seed      # base de démonstration (fictive)
npm start         # http://localhost:3000
```
Démo : titulaire `titulaire@demo.ci` / `demo-officine-2026` + code TOTP affiché par `seed` ; vendeuses Awa `1234`, Koffi `5678`.
Pour une vraie officine : ne PAS lancer `seed`, ouvrir l'application, écran « Installer l'officine ».

## Installer dans la pharmacie
1. Un PC allumé en permanence dans l'officine, Node.js 22+, `npm start` (variables `DB=/chemin/lgo.db`, `PORT=3000`).
2. Les tablettes ouvrent `http://IP-DU-PC:3000` puis « Ajouter à l'écran d'accueil ».
3. Sauvegarde : copier `lgo.db` chaque soir (clé USB / cloud).
4. Pour que la tablette s'ouvre même si le PC est éteint, il faut HTTPS en local (les navigateurs refusent le mode hors ligne complet en `http://` sur une adresse IP). Sans HTTPS, tout marche tant que le PC de l'officine est allumé ; seul le cas « PC éteint » n'est pas couvert.

## Portail web du pharmacien (cloud)
Sur un VPS (Contabo / Hostinger), derrière HTTPS (Caddy / Nginx) :
```bash
MODE=cloud SYNC_KEY=<longue-clé-secrète> PORT=3000 npm start
```
Sur le PC de l'officine :
```bash
CLOUD_URL=https://lgo.ton-domaine.ci SYNC_KEY=<la-même-clé> npm start
```
Le PC envoie toutes les 15 s ventes, stock et organismes dès qu'internet est là. Le pharmacien crée son compte sur le cloud (écran d'installation) et consulte tout en lecture seule.

## Tests
`npm test` : 24 vérifications (FEFO, hors ligne, bons de santé, PIN, TOTP, synchronisation cloud).

## Limites connues
- Données de santé des patients (ordonnances, registre des stupéfiants) : **pas encore faits**.
- Vente hors ligne sur un produit au stock insuffisant : acceptée et signalée « à régulariser ».
- La clé TOTP est stockée en clair dans la base (à chiffrer avant la mise en production).
- Pas d'impression de ticket, pas d'import du catalogue (Excel), pas de commandes fournisseurs (seulement la réception de lots).
