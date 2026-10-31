import assert from 'node:assert/strict'
import fs from 'node:fs'
import { creerServeur } from '../server/server.js'
import { hotp } from '../server/lib.js'

const DB = '/tmp/lgo-test-local.db', CLOUD = '/tmp/lgo-test-cloud.db'
for (const f of [DB, CLOUD]) for (const s of ['', '-wal', '-shm']) fs.rmSync(f + s, { force: true })

const local = creerServeur({ fichier: DB, mode: 'local' })
const nuage = creerServeur({ fichier: CLOUD, mode: 'cloud', cleSync: 'cle-test-sync' })
await new Promise((r) => local.listen(0, '127.0.0.1', r))
await new Promise((r) => nuage.listen(0, '127.0.0.1', r))
const L = `http://127.0.0.1:${local.address().port}`, C = `http://127.0.0.1:${nuage.address().port}`

const api = async (base, m, p, body, token, extra = {}) => {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json()
  return Array.isArray(j) ? j : { code: r.status, ...j }
}
let n = 0
const ok = (nom, fn) => fn().then(() => console.log('  ok', ++n, nom))

// Installation, titulaire (mot de passe + TOTP)
const inst = await api(L, 'POST', '/api/installation', { officine: 'Pharmacie Test', nom: 'Dr Test', email: 'dr@test.ci', mdp: 'mot-de-passe-solide' })
assert.ok(inst.totp_secret)
await ok('réinstallation refusée', async () => assert.equal((await api(L, 'POST', '/api/installation', { officine: 'x', nom: 'x', email: 'x@x.ci', mdp: 'mot-de-passe-solide' })).code, 409))
await ok('connexion sans code TOTP refusée', async () => assert.equal((await api(L, 'POST', '/api/login', { email: 'dr@test.ci', mdp: 'mot-de-passe-solide' })).code, 401))
const lg = await api(L, 'POST', '/api/login', { email: 'dr@test.ci', mdp: 'mot-de-passe-solide', code: hotp(inst.totp_secret, Math.floor(Date.now() / 30000)) })
assert.ok(lg.token)
const T = lg.token
await ok('connexion titulaire avec TOTP', async () => assert.equal(lg.user.role, 'titulaire'))

// Catalogue, lots, équipe
const prod = await api(L, 'POST', '/api/produits', { nom: 'Paracétamol 500', prix: 500, seuil: 10 }, T)
const prod2 = await api(L, 'POST', '/api/produits', { nom: 'Amoxicilline 500', prix: 2200, seuil: 5 }, T)
const dans = (m) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10) }
await api(L, 'POST', '/api/reception', { produit_id: prod.id, numero: 'LOT-TARD', peremption: dans(12), qte: 10 }, T)
await api(L, 'POST', '/api/reception', { produit_id: prod.id, numero: 'LOT-TOT', peremption: dans(3), qte: 5 }, T)
await api(L, 'POST', '/api/reception', { produit_id: prod.id, numero: 'LOT-PERIME', peremption: '2020-01-31', qte: 50 }, T)
await api(L, 'POST', '/api/reception', { produit_id: prod2.id, numero: 'A1', peremption: dans(10), qte: 3 }, T)
await api(L, 'POST', '/api/utilisateurs', { nom: 'Awa', pin: '1234' }, T)
const eq = await api(L, 'GET', '/api/equipe')
const awa = eq[0] ?? (await fetch(L + '/api/equipe').then((r) => r.json()))[0]
const pin = await api(L, 'POST', '/api/pin', { user_id: awa.id, pin: '1234' })
const V = pin.token
await ok('PIN vendeuse depuis le réseau local', async () => assert.ok(V))
await ok('PIN depuis internet (x-forwarded-for) refusé', async () => assert.equal((await api(L, 'POST', '/api/pin', { user_id: awa.id, pin: '1234' }, null, { 'x-forwarded-for': '41.66.1.1' })).code, 403))
await ok('vendeuse ne peut pas créer de compte', async () => assert.equal((await api(L, 'POST', '/api/utilisateurs', { nom: 'X', pin: '1111' }, V)).code, 403))
await ok('vendeuse ne voit pas les rapports', async () => assert.equal((await api(L, 'GET', '/api/rapport', null, V)).code, 403))

// Vente FEFO : le lot périmé est ignoré, le lot le plus proche de la péremption part en premier
const v1 = await api(L, 'POST', '/api/ventes', { id: 'v-0001', mode: 'especes', lignes: [{ produit_id: prod.id, qte: 7 }] }, V)
await ok('vente créée avec total calculé par le serveur', async () => { assert.equal(v1.total, 3500); assert.match(v1.numero, /^V-\d{8}-0001$/) })
const st = await api(L, 'GET', '/api/stock', null, T)
const lots = Object.fromEntries(st.find((p) => p.id === prod.id).lots.map((l) => [l.numero, l.qte]))
await ok('FEFO : LOT-TOT vidé puis LOT-TARD entamé, périmé intact', async () => { assert.equal(lots['LOT-TOT'], undefined); assert.equal(lots['LOT-TARD'], 8); assert.equal(lots['LOT-PERIME'], 50) })
await ok('rejouer la même vente ne la double pas', async () => { const r = await api(L, 'POST', '/api/ventes', { id: 'v-0001', mode: 'especes', lignes: [{ produit_id: prod.id, qte: 7 }] }, V); assert.equal(r.deja, true); assert.equal((await api(L, 'GET', '/api/rapport', null, T)).nb_ventes, 1) })
await ok('stock insuffisant refusé en ligne', async () => assert.equal((await api(L, 'POST', '/api/ventes', { id: 'v-0002', mode: 'especes', lignes: [{ produit_id: prod2.id, qte: 99 }] }, V)).code, 409))
await ok('vente hors ligne acceptée avec stock à régulariser', async () => {
  const r = await api(L, 'POST', '/api/ventes', { id: 'v-0003', mode: 'wave', hors_ligne: true, created_at: new Date(Date.now() - 600000).toISOString(), lignes: [{ produit_id: prod2.id, qte: 5 }] }, V)
  assert.equal(r.code, 200); assert.equal(r.paiement_statut, 'a_confirmer'); assert.equal(r.a_regulariser.length, 1)
})
await ok('bon de santé : part patient après prise en charge', async () => {
  const o = await api(L, 'POST', '/api/organismes', { nom: 'MUGEFCI', taux: 80 }, T)
  const r = await api(L, 'POST', '/api/ventes', { id: 'v-0004', mode: 'bon_sante', organisme_id: o.id, lignes: [{ produit_id: prod.id, qte: 2 }] }, V)
  assert.equal(r.total, 1000); assert.equal(r.part_patient, 200)
})
await ok('bon de santé sans organisme refusé', async () => assert.equal((await api(L, 'POST', '/api/ventes', { id: 'v-0005', mode: 'bon_sante', lignes: [{ produit_id: prod.id, qte: 1 }] }, V)).code, 400))
const rap = await api(L, 'GET', '/api/rapport', null, T)
await ok('rapport du jour', async () => { assert.equal(rap.nb_ventes, 3); assert.equal(rap.chiffre_affaires, 3500 + 11000 + 1000); assert.equal(rap.hors_ligne, 1) })
await ok('alertes : périmés et à régulariser', async () => { const a = await api(L, 'GET', '/api/alertes', null, T); assert.equal(a.perimes.length, 1); assert.ok(a.a_regulariser >= 1) })
await ok('annulation remet le stock', async () => {
  const avant = (await api(L, 'GET', '/api/stock', null, T)).find((p) => p.id === prod.id).stock
  await api(L, 'POST', '/api/ventes/v-0004/annuler', null, T)
  assert.equal((await api(L, 'GET', '/api/stock', null, T)).find((p) => p.id === prod.id).stock, avant + 2)
  assert.equal((await api(L, 'POST', '/api/ventes/v-0004/annuler', null, T)).code, 409)
})
await ok('PIN : blocage après 5 essais', async () => {
  for (let i = 0; i < 5; i++) await api(L, 'POST', '/api/pin', { user_id: awa.id, pin: '0000' })
  assert.equal((await api(L, 'POST', '/api/pin', { user_id: awa.id, pin: '1234' })).code, 429)
})
await ok('journal d\'audit alimenté', async () => assert.ok((await api(L, 'GET', '/api/audit', null, T)).some((a) => a.action === 'vente')))

// Synchronisation vers le cloud : le titulaire consulte à distance
process.env.CLOUD_URL = C; process.env.SYNC_KEY = 'cle-test-sync'
await ok('cloud refuse une mauvaise clé', async () => assert.equal((await api(C, 'POST', '/api/sync', {}, 'mauvaise')).code, 401))
const sync = await api(L, 'POST', '/api/sync/maintenant', null, T)
await ok('synchronisation poussée', async () => assert.equal(sync.ok, true))
const instC = await api(C, 'POST', '/api/installation', { officine: 'Pharmacie Test', nom: 'Dr Test', email: 'dr@test.ci', mdp: 'mot-de-passe-cloud-1' })
const lgC = await api(C, 'POST', '/api/login', { email: 'dr@test.ci', mdp: 'mot-de-passe-cloud-1', code: hotp(instC.totp_secret, Math.floor(Date.now() / 30000)) })
const rapC = await api(C, 'GET', '/api/rapport', null, lgC.token)
await ok('le cloud affiche le même chiffre d\'affaires (ventes annulées exclues)', async () => assert.equal(rapC.chiffre_affaires, 3500 + 11000))
await ok('le cloud ne permet ni vente ni PIN', async () => {
  assert.equal((await api(C, 'POST', '/api/ventes', { id: 'x', mode: 'especes', lignes: [] }, lgC.token)).code, 403)
  assert.equal((await api(C, 'POST', '/api/pin', { user_id: awa.id, pin: '1234' })).code, 403)
})
await ok('le cloud ne contient aucun secret de l\'officine', async () => assert.equal((await api(C, 'GET', '/api/utilisateurs', null, lgC.token)).length, 1))

await ok('cloud vidé (hébergement temporaire) : tout est renvoyé automatiquement', async () => {
  for (const t of ['lignes_vente', 'ventes', 'lots', 'produits']) await api(C, 'POST', '/api/sync', { produits: [], lots: [], ventes: [] }, 'cle-test-sync')
  nuage.close()
  for (const sfx of ['', '-wal', '-shm']) fs.rmSync(CLOUD + sfx, { force: true })
  const nuage2 = creerServeur({ fichier: CLOUD, mode: 'cloud', cleSync: 'cle-test-sync' })
  await new Promise((r) => nuage2.listen(0, '127.0.0.1', r))
  process.env.CLOUD_URL = `http://127.0.0.1:${nuage2.address().port}`
  const r = await api(L, 'POST', '/api/sync/maintenant', null, T)
  assert.equal(r.ok, true); assert.ok(r.ventes >= 3)
  const i = await api(`http://127.0.0.1:${nuage2.address().port}`, 'POST', '/api/installation', { officine: 'P', nom: 'D', email: 'd@t.ci', mdp: 'mot-de-passe-cloud-1' })
  const l2 = await api(`http://127.0.0.1:${nuage2.address().port}`, 'POST', '/api/login', { email: 'd@t.ci', mdp: 'mot-de-passe-cloud-1', code: hotp(i.totp_secret, Math.floor(Date.now() / 30000)) })
  assert.equal((await api(`http://127.0.0.1:${nuage2.address().port}`, 'GET', '/api/rapport', null, l2.token)).chiffre_affaires, 14500)
  nuage2.close()
})
console.log(`\n${n} vérifications réussies`)
local.close()
setTimeout(() => process.exit(0), 100)
