import assert from 'node:assert/strict'
import fs from 'node:fs'
import { creerServeur } from '../server/server.js'
import { hotp } from '../server/lib.js'

const DB = '/tmp/lgo-test-online.db'
for (const s of ['', '-wal', '-shm']) fs.rmSync(DB + s, { force: true })
fs.rmSync('/tmp/sauvegardes', { recursive: true, force: true })
const srv = creerServeur({ fichier: DB, mode: 'online' })
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const B = `http://127.0.0.1:${srv.address().port}`
const api = async (m, p, body, token, extra = {}) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json(); return Array.isArray(j) ? j : { code: r.status, ...j }
}
const code = (s) => hotp(s, Math.floor(Date.now() / 30000))
let n = 0
const ok = async (nom, fn) => { await fn(); console.log('  ok', ++n, nom) }
const dans = (m) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10) }

const inst = await api('POST', '/api/installation', { officine: 'Pharmacie En Ligne', nom: 'Dr Web', email: 'dr@web.ci', mdp: 'mot-de-passe-solide' })
const T = (await api('POST', '/api/login', { email: 'dr@web.ci', mdp: 'mot-de-passe-solide', code: code(inst.totp_secret) })).token
await ok('le mode en ligne est annoncé', async () => assert.equal((await (await fetch(B + '/api/etat')).json()).mode, 'online'))

// Comptes en ligne : identifiant + mot de passe
const awa = await api('POST', '/api/utilisateurs', { nom: 'Awa', role: 'vendeur', identifiant: 'Awa@Pharma.ci', mdp: 'motdepasse1' }, T)
const moussa = await api('POST', '/api/utilisateurs', { nom: 'Moussa', role: 'preparateur', identifiant: 'moussa@pharma.ci', mdp: 'motdepasse2', double_securite: true }, T)
await ok('création de comptes en ligne (identifiant unique, mot de passe 8 caractères, double sécurité facultative)', async () => {
  assert.ok(awa.id); assert.equal(awa.totp_secret, null); assert.ok(moussa.totp_secret)
  assert.equal((await api('POST', '/api/utilisateurs', { nom: 'Doublon', role: 'vendeur', identifiant: 'awa@pharma.ci', mdp: 'motdepasse1' }, T)).code, 409)
  assert.equal((await api('POST', '/api/utilisateurs', { nom: 'Court', role: 'vendeur', identifiant: 'c@p.ci', mdp: 'court' }, T)).code, 400)
})
await ok('connexion en ligne d\'un employé (identifiant insensible à la casse)', async () => {
  assert.equal((await api('POST', '/api/login', { email: 'awa@pharma.ci', mdp: 'mauvais-mdp' })).code, 401)
  const r = await api('POST', '/api/login', { email: 'AWA@pharma.ci', mdp: 'motdepasse1' })
  assert.equal(r.code, 200); assert.equal(r.user.role, 'vendeur')
})
await ok('double sécurité : le code est exigé pour Moussa', async () => {
  assert.equal((await api('POST', '/api/login', { email: 'moussa@pharma.ci', mdp: 'motdepasse2' })).code, 401)
  assert.equal((await api('POST', '/api/login', { email: 'moussa@pharma.ci', mdp: 'motdepasse2', code: code(moussa.totp_secret) })).code, 200)
})
await ok('en ligne, le PIN et la liste d\'équipe sont fermés', async () => {
  assert.equal((await api('GET', '/api/equipe')).code, 403)
  assert.equal((await api('POST', '/api/pin', { user_id: awa.id, pin: '1234' })).code, 403)
})
const A = (await api('POST', '/api/login', { email: 'awa@pharma.ci', mdp: 'motdepasse1' })).token
const M = (await api('POST', '/api/login', { email: 'moussa@pharma.ci', mdp: 'motdepasse2', code: code(moussa.totp_secret) })).token

// Habilitations
await ok('catalogue des habilitations et droits par défaut des rôles', async () => {
  const h = await api('GET', '/api/habilitations', null, T)
  assert.ok(h.catalogue.length >= 14); assert.ok(h.roles.vendeur.droits.includes('vente')); assert.ok(!h.roles.vendeur.droits.includes('stats'))
  assert.equal((await api('GET', '/api/habilitations', null, A)).code, 403)
})
await ok('droits du rôle par défaut : la vendeuse ne voit pas les statistiques ni les produits à gérer', async () => {
  assert.equal((await api('GET', '/api/stats', null, A)).code, 403)
  assert.equal((await api('POST', '/api/produits', { nom: 'X', prix: 1 }, A)).code, 403)
})
await ok('habilitation donnée : la vendeuse obtient les statistiques sans changer de rôle', async () => {
  const r = await api('POST', `/api/utilisateurs/${awa.id}/habilitations`, { perms: ['vente', 'caisse', 'clients', 'stats'] }, T)
  assert.equal(r.personnalise, true); assert.ok(r.perms.includes('stats'))
  assert.equal((await api('GET', '/api/stats', null, A)).code, 200)       // effet immédiat, sans reconnexion
  assert.equal((await api('GET', '/api/me', null, A)).perms.includes('stats'), true)
  assert.equal((await api('GET', '/api/stats', null, A)).marge, null)      // pas d'habilitation « marges »
})
await ok('habilitation retirée : plus de vente possible', async () => {
  await api('POST', `/api/utilisateurs/${awa.id}/habilitations`, { perms: ['caisse', 'clients'] }, T)
  assert.equal((await api('POST', '/api/ventes', { id: 'x', lignes: [{ produit_id: 'p', qte: 1 }], paiements: [] }, A)).code, 403)
})
await ok('habilitation inconnue ou droit réservé au titulaire refusés', async () => {
  assert.equal((await api('POST', `/api/utilisateurs/${awa.id}/habilitations`, { perms: ['utilisateurs'] }, T)).code, 400)
  assert.equal((await api('POST', `/api/utilisateurs/${awa.id}/habilitations`, { perms: ['*'] }, T)).code, 400)
  assert.equal((await api('POST', `/api/utilisateurs/${awa.id}/habilitations`, { perms: ['vente'] }, M)).code, 403)
})
await ok('retour aux droits du rôle, et changement de rôle', async () => {
  const r = await api('POST', `/api/utilisateurs/${awa.id}/habilitations`, { defaut: true }, T)
  assert.equal(r.personnalise, false); assert.ok(r.perms.includes('vente'))
  const r2 = await api('POST', `/api/utilisateurs/${awa.id}/habilitations`, { role: 'pharmacien', defaut: true }, T)
  assert.equal(r2.role, 'pharmacien'); assert.ok(r2.perms.includes('marges'))
  await api('POST', `/api/utilisateurs/${awa.id}/habilitations`, { role: 'vendeur', defaut: true }, T)
})

// Toutes les fonctions en ligne : le travail complet passe par le web
const prod = (await api('POST', '/api/produits', { code: '1', nom: 'Paracétamol', prix: 600, prix_achat: 380, seuil: 5 }, T)).id
const four = (await api('POST', '/api/fournisseurs', { nom: 'Grossiste', delai_jours: 2 }, T)).id
await ok('réception et vente complètes en ligne, par des comptes différents', async () => {
  assert.equal((await api('POST', '/api/receptions', { fournisseur_id: four, lignes: [{ produit_id: prod, numero: 'L1', peremption: dans(12), qte: 50, prix_achat: 380 }] }, M)).code, 200)
  assert.equal((await api('POST', '/api/caisse/ouvrir', { fond: 5000 }, A)).code, 200)
  const v = await api('POST', '/api/ventes', { id: 'w-1', lignes: [{ produit_id: prod, qte: 3 }], paiements: [{ mode: 'wave', montant: 1800 }] }, A)
  assert.equal(v.code, 200); assert.equal(v.paiement_statut, 'a_confirmer')
  assert.equal((await api('GET', '/api/catalogue', null, A)).produits[0].stock, 47)
})
await ok('catalogue sans prix d\'achat pour la vendeuse', async () => assert.equal(JSON.stringify(await api('GET', '/api/catalogue', null, A)).includes('prix_achat'), false))

// Mots de passe
await ok('changement de son propre mot de passe', async () => {
  assert.equal((await api('POST', '/api/moi/mdp', { ancien: 'faux', nouveau: 'nouveaumdp1' }, A)).code, 401)
  assert.equal((await api('POST', '/api/moi/mdp', { ancien: 'motdepasse1', nouveau: 'court' }, A)).code, 400)
  assert.equal((await api('POST', '/api/moi/mdp', { ancien: 'motdepasse1', nouveau: 'nouveaumdp1' }, A)).code, 200)
  assert.equal((await api('POST', '/api/login', { email: 'awa@pharma.ci', mdp: 'motdepasse1' })).code, 401)
  assert.equal((await api('POST', '/api/login', { email: 'awa@pharma.ci', mdp: 'nouveaumdp1' })).code, 200)
})
await ok('réinitialisation par le titulaire : les anciennes sessions sont coupées', async () => {
  const S1 = (await api('POST', '/api/login', { email: 'awa@pharma.ci', mdp: 'nouveaumdp1' })).token
  assert.equal((await api('POST', `/api/utilisateurs/${awa.id}/mdp`, { mdp: 'motdepasse-reset' }, T)).code, 200)
  assert.equal((await api('GET', '/api/me', null, S1)).code, 401)
  assert.equal((await api('POST', '/api/login', { email: 'awa@pharma.ci', mdp: 'motdepasse-reset' })).code, 200)
  assert.equal((await api('POST', `/api/utilisateurs/${awa.id}/mdp`, { mdp: 'motdepasse-reset' }, M)).code, 403)
})
await ok('employé désactivé : connexion refusée', async () => {
  await api('POST', `/api/utilisateurs/${moussa.id}/desactiver`, null, T)
  assert.equal((await api('POST', '/api/login', { email: 'moussa@pharma.ci', mdp: 'motdepasse2', code: code(moussa.totp_secret) })).code, 401)
  assert.equal((await api('GET', '/api/me', null, M)).code, 401)
})
await ok('anti force brute par adresse : blocage après 25 échecs', async () => {
  let dernier
  for (let i = 0; i < 27; i++) dernier = await api('POST', '/api/login', { email: `inconnu${i}@x.ci`, mdp: 'xxxxxxxxxx' }, null, { 'x-forwarded-for': '41.66.9.9' })
  assert.equal(dernier.code, 429)
  assert.equal((await api('POST', '/api/login', { email: 'awa@pharma.ci', mdp: 'motdepasse-reset' }, null, { 'x-forwarded-for': '41.66.1.1' })).code, 200)
})
await ok('sauvegarde automatique téléchargeable depuis le web', async () => {
  const s = await api('POST', '/api/sauvegardes/maintenant', null, T)
  const r = await fetch(`${B}/api/sauvegardes/telecharger?nom=${s.nom}`, { headers: { authorization: 'Bearer ' + T } })
  const buf = Buffer.from(await r.arrayBuffer())
  assert.equal(r.status, 200); assert.equal(buf.subarray(0, 15).toString(), 'SQLite format 3')
  assert.equal((await fetch(`${B}/api/sauvegardes/telecharger?nom=../etc/passwd`, { headers: { authorization: 'Bearer ' + T } })).status, 404)
})
await ok('les journaux gardent les changements de droits', async () => assert.ok((await api('GET', '/api/audit', null, T)).some((a) => a.action === 'habilitations')))

console.log(`\n${n} vérifications réussies (mode en ligne)`)
srv.close()
setTimeout(() => process.exit(0), 100)
