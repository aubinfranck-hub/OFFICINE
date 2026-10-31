import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { creerServeur } from '../server/server.js'
import { hotp } from '../server/lib.js'
import { V1 } from '../server/schema.js'

const DB = '/tmp/lgo-test-local.db', CLOUD = '/tmp/lgo-test-cloud.db', ANCIENNE = '/tmp/lgo-test-v1.db'
const nettoyer = (f) => { for (const s of ['', '-wal', '-shm']) fs.rmSync(f + s, { force: true }) }
;[DB, CLOUD, ANCIENNE].forEach(nettoyer)

// ───────── Migration d'une ancienne base (v1) vers v2 ─────────
{
  const v1 = new DatabaseSync(ANCIENNE)
  v1.exec(V1)
  v1.exec(`INSERT INTO users (id,nom,role,email,mdp_hash,totp_secret,created_at) VALUES ('u1','Ancien Titulaire','titulaire','ancien@test.ci','x','ABC','2026-01-01');
    INSERT INTO produits (id,nom,prix) VALUES ('p1','Paracétamol',500);
    INSERT INTO ventes (id,numero,user_id,user_nom,total,mode,part_patient,created_at) VALUES ('v1','V-1','u1','Ancien',1000,'wave',1000,'2026-10-01T10:00:00.000Z');
    INSERT INTO lignes_vente (vente_id,produit_id,nom,qte,prix) VALUES ('v1','p1','Paracétamol',2,500);`)
  v1.close()
}
let n = 0
const ok = async (nom, fn) => { await fn(); console.log('  ok', ++n, nom) }

const ancien = creerServeur({ fichier: ANCIENNE, mode: 'local' })
await new Promise((r) => ancien.listen(0, '127.0.0.1', r))
const A = `http://127.0.0.1:${ancien.address().port}`
await ok('migration v1 → v2 : titulaire, ventes et paiement conservés', async () => {
  const etat = await (await fetch(A + '/api/etat')).json()
  assert.equal(etat.installe, true); assert.equal(etat.version, 2)
  ancien.close()
  const d = new DatabaseSync(ANCIENNE)
  assert.equal(d.prepare("SELECT COUNT(*) c FROM paiements WHERE vente_id='v1' AND mode='wave' AND montant=1000").get().c, 1)
  assert.equal(d.prepare("SELECT role FROM users WHERE id='u1'").get().role, 'titulaire')
  d.exec("INSERT INTO users (id,nom,role,created_at) VALUES ('u2','Prep','preparateur','2026-01-01')")
  d.close()
})

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
const code = (secret) => hotp(secret, Math.floor(Date.now() / 30000))
const dans = (mois) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + mois); return d.toISOString().slice(0, 10) }

// ───────── Installation, connexions, droits ─────────
const inst = await api(L, 'POST', '/api/installation', { officine: 'Pharmacie Test', nom: 'Dr Test', email: 'dr@test.ci', mdp: 'mot-de-passe-solide' })
await ok('réinstallation refusée', async () => assert.equal((await api(L, 'POST', '/api/installation', { officine: 'x', nom: 'x', email: 'x@x.ci', mdp: 'mot-de-passe-solide' })).code, 409))
await ok('connexion sans code TOTP refusée', async () => assert.equal((await api(L, 'POST', '/api/login', { email: 'dr@test.ci', mdp: 'mot-de-passe-solide' })).code, 401))
const lg = await api(L, 'POST', '/api/login', { email: 'dr@test.ci', mdp: 'mot-de-passe-solide', code: code(inst.totp_secret) })
const T = lg.token
await ok('titulaire connecté avec tous les droits', async () => assert.deepEqual(lg.user.perms, ['*']))
const mk = async (nom, role, pin) => (await api(L, 'POST', '/api/utilisateurs', { nom, role, pin }, T)).id
await mk('Dr Adjoint', 'pharmacien', '1111'); await mk('Moussa', 'preparateur', '2222'); await mk('Awa', 'vendeur', '3333')
const equipe = await api(L, 'GET', '/api/equipe')
const pin = async (nom, p) => (await api(L, 'POST', '/api/pin', { user_id: equipe.find((u) => u.nom === nom).id, pin: p })).token
const PH = await pin('Dr Adjoint', '1111'), PR = await pin('Moussa', '2222'), V = await pin('Awa', '3333')
await ok('PIN de plusieurs rôles depuis le réseau local', async () => assert.ok(PH && PR && V))
await ok('PIN depuis internet refusé', async () => assert.equal((await api(L, 'POST', '/api/pin', { user_id: equipe[0].id, pin: '1111' }, null, { 'x-forwarded-for': '41.66.1.1' })).code, 403))
await ok('vendeuse : pas de rapports, pas de gestion produits, pas d\'équipe', async () => {
  assert.equal((await api(L, 'GET', '/api/stats', null, V)).code, 403)
  assert.equal((await api(L, 'POST', '/api/produits', { nom: 'X', prix: 1 }, V)).code, 403)
  assert.equal((await api(L, 'GET', '/api/utilisateurs', null, V)).code, 403)
})
await ok('préparateur : peut recevoir une commande mais pas voir la marge', async () => {
  assert.equal((await api(L, 'GET', '/api/fournisseurs', null, PR)).code === 403, false)
  assert.equal((await api(L, 'GET', '/api/stats', null, PR)).code, 403)
})
await ok('pharmacien adjoint : stats oui, utilisateurs non', async () => {
  assert.equal((await api(L, 'GET', '/api/stats', null, PH)).code, 200)
  assert.equal((await api(L, 'GET', '/api/utilisateurs', null, PH)).code, 403)
})

// ───────── Produits, import, substituts ─────────
const prod = (o) => api(L, 'POST', '/api/produits', { prix: 500, seuil: 5, ...o }, T)
const para = (await prod({ code: '111', nom: 'Doliprane 500', dci: 'paracétamol', dosage: '500 mg', famille: 'Antalgiques', prix: 600, prix_achat: 400, seuil: 10, stock_max: 50 })).id
const gen = (await prod({ code: '112', nom: 'Paracétamol générique', dci: 'Paracétamol', dosage: '500 mg', famille: 'Antalgiques', prix: 400, prix_achat: 200, generique: 1 })).id
const amox = (await prod({ code: '113', nom: 'Amoxicilline 500', dci: 'amoxicilline', famille: 'Antibiotiques', prix: 2200, prix_achat: 1300, ordonnance: 1 })).id
const trama = (await prod({ code: '114', nom: 'Tramadol 50', dci: 'tramadol', famille: 'Psychotropes', prix: 2400, prix_achat: 1500, stupefiant: 1 })).id
await ok('code-barres en double refusé', async () => assert.equal((await prod({ code: '111', nom: 'Doublon' })).code, 409))
await ok('import de produits (créations, mises à jour, erreurs signalées)', async () => {
  const r = await api(L, 'POST', '/api/produits/import', { lignes: [{ code: '200', nom: 'Vitamine C', prix: 1800, prix_achat: 950, famille: 'Vitamines' }, { code: '111', nom: 'Doliprane 500', prix: 650, prix_achat: 400, dci: 'paracétamol', dosage: '500 mg', famille: 'Antalgiques', seuil: 10, stock_max: 50 }, { nom: 'Sans prix' }] }, T)
  assert.equal(r.crees, 1); assert.equal(r.modifies, 1); assert.equal(r.erreurs.length, 1)
  await prod({ id: para, code: '111', nom: 'Doliprane 500', dci: 'paracétamol', dosage: '500 mg', famille: 'Antalgiques', prix: 600, prix_achat: 400, seuil: 10, stock_max: 50 })
})
await ok('substituts : mêmes DCI, insensible à la casse', async () => {
  const f = await api(L, 'GET', `/api/produits/${para}`, null, T)
  assert.equal(f.substituts.length, 1); assert.equal(f.substituts[0].id, gen); assert.equal(f.prix_achat, 400)
})
await ok('le prix d\'achat est caché aux vendeuses', async () => assert.equal((await api(L, 'GET', `/api/produits/${para}`, null, V)).prix_achat, undefined))

// ───────── Achats : fournisseur, suggestion, commande, réception ─────────
const four = (await api(L, 'POST', '/api/fournisseurs', { nom: 'Grossiste A', telephone: '0102', delai_jours: 2 }, T)).id
await ok('suggestion de commande pour un produit en rupture', async () => {
  const s = await api(L, 'GET', '/api/commandes/suggestions', null, T)
  const l = s.find((x) => x.produit_id === para)
  assert.ok(l && l.urgent && l.qte >= 50)
})
const cmd = await api(L, 'POST', '/api/commandes', { fournisseur_id: four, lignes: [{ produit_id: para, qte: 40 }, { produit_id: amox, qte: 20 }] }, T)
await ok('commande envoyée, total estimé au prix d\'achat', async () => assert.equal(cmd.total_estime, 40 * 400 + 20 * 1300))
await ok('une commande en cours n\'est plus re-suggérée en double', async () => {
  const l = (await api(L, 'GET', '/api/commandes/suggestions', null, T)).find((x) => x.produit_id === para)
  assert.ok(!l || l.en_commande === 40)
})
const rec = await api(L, 'POST', '/api/receptions', { fournisseur_id: four, commande_id: cmd.id, num_bl: 'BL-77', lignes: [
  { produit_id: para, numero: 'LOT-TARD', peremption: dans(12), qte: 20, prix_achat: 410 }, { produit_id: para, numero: 'LOT-TOT', peremption: dans(3), qte: 10, prix_achat: 400 },
  { produit_id: para, numero: 'LOT-PERIME', peremption: '2020-01', qte: 50, prix_achat: 300 }, { produit_id: gen, numero: 'G1', peremption: dans(9), qte: 30, prix_achat: 200 },
  { produit_id: amox, numero: 'A1', peremption: dans(10), qte: 20, prix_achat: 1300, prix_vente: 2300 }, { produit_id: trama, numero: 'TR1', peremption: dans(8), qte: 10, prix_achat: 1500 }] }, T)
await ok('réception : total, commande soldée, prix de vente mis à jour', async () => {
  assert.equal(rec.total, 20 * 410 + 10 * 400 + 50 * 300 + 30 * 200 + 20 * 1300 + 10 * 1500)
  assert.equal((await api(L, 'GET', `/api/commandes/${cmd.id}`, null, T)).statut, 'recue')
  assert.equal((await api(L, 'GET', `/api/produits/${amox}`, null, T)).prix, 2300)
})
await ok('dette fournisseur puis paiement partiel', async () => {
  assert.equal((await api(L, 'GET', '/api/fournisseurs', null, T))[0].dette, rec.total)
  const p = await api(L, 'POST', `/api/receptions/${rec.id}/payer`, { montant: 50000, mode: 'especes' }, T)
  assert.equal(p.reste, rec.total - 50000)
  assert.equal((await api(L, 'POST', `/api/receptions/${rec.id}/payer`, { montant: 99999999 }, T)).code, 409)
})
await ok('registre des stupéfiants : entrée à la réception', async () => {
  const r = await api(L, 'GET', '/api/registre', null, T)
  assert.equal(r.lignes[0].type, 'entree'); assert.equal(r.lignes[0].solde, 10)
})

// ───────── Caisse et comptoir ─────────
await ok('ouverture de caisse (vendeuse) puis double ouverture refusée', async () => {
  assert.ok((await api(L, 'POST', '/api/caisse/ouvrir', { fond: 10000 }, V)).id)
  assert.equal((await api(L, 'POST', '/api/caisse/ouvrir', { fond: 0 }, V)).code, 409)
})
const vente = (o) => api(L, 'POST', '/api/ventes', o, V)
let n1
await ok('vente FEFO : lot proche d\'abord, périmé ignoré, paiement espèces', async () => {
  n1 = await vente({ id: 'v-1', lignes: [{ produit_id: para, qte: 13 }], paiements: [{ mode: 'especes', montant: 13 * 600 }] })
  assert.equal(n1.total, 7800)
  const lots = Object.fromEntries((await api(L, 'GET', `/api/produits/${para}`, null, T)).lots.map((l) => [l.numero, l.qte]))
  assert.equal(lots['LOT-TOT'], undefined); assert.equal(lots['LOT-TARD'], 17); assert.equal(lots['LOT-PERIME'], 50)
})
await ok('rejouer la même vente ne la double pas', async () => assert.equal((await vente({ id: 'v-1', lignes: [{ produit_id: para, qte: 13 }], paiements: [{ mode: 'especes', montant: 7800 }] })).deja, true))
await ok('paiements qui ne couvrent pas le montant : refusé', async () => assert.equal((await vente({ id: 'v-2', lignes: [{ produit_id: para, qte: 1 }], paiements: [{ mode: 'especes', montant: 500 }] })).code, 400))
await ok('stock insuffisant refusé en ligne', async () => assert.equal((await vente({ id: 'v-3', lignes: [{ produit_id: amox, qte: 99 }], paiements: [{ mode: 'especes', montant: 1 }] })).code, 409))
await ok('remise refusée à une vendeuse, acceptée au préparateur', async () => {
  assert.equal((await vente({ id: 'v-4', remise: 100, lignes: [{ produit_id: para, qte: 1 }], paiements: [{ mode: 'especes', montant: 500 }] })).code, 403)
  const r = await api(L, 'POST', '/api/ventes', { id: 'v-4b', remise: 100, lignes: [{ produit_id: para, qte: 1 }], paiements: [{ mode: 'especes', montant: 500 }] }, PR)
  assert.equal(r.part_patient, 500)
})
await ok('paiement mixte espèces + Wave : Wave « à confirmer »', async () => {
  const r = await vente({ id: 'v-5', lignes: [{ produit_id: para, qte: 5 }], paiements: [{ mode: 'especes', montant: 1000 }, { mode: 'wave', montant: 2000 }] })
  assert.equal(r.paiement_statut, 'a_confirmer')
  const l = (await api(L, 'GET', `/api/ventes?q=${r.numero}`, null, T))[0]
  const w = l.paiements.find((p) => p.mode === 'wave')
  assert.equal(w.statut, 'a_confirmer')
  assert.equal((await api(L, 'POST', `/api/paiements/${w.id}/confirmer`, null, V)).code, 403)
  await api(L, 'POST', `/api/paiements/${w.id}/confirmer`, null, PH)
  assert.equal((await api(L, 'GET', `/api/ventes/${r.id}`, null, T)).paiement_statut, 'confirme')
})
const cli = (await api(L, 'POST', '/api/clients', { nom: 'Kouassi Ama', telephone: '0707' }, V)).id
await ok('vente à crédit : exige un client, augmente sa dette', async () => {
  assert.equal((await vente({ id: 'v-6', lignes: [{ produit_id: para, qte: 2 }], paiements: [{ mode: 'credit', montant: 1200 }] })).code, 400)
  await vente({ id: 'v-6b', client_id: cli, lignes: [{ produit_id: para, qte: 2 }], paiements: [{ mode: 'credit', montant: 1200 }] })
  assert.equal((await api(L, 'GET', `/api/clients/${cli}`, null, V)).solde, 1200)
})
await ok('règlement partiel de la dette, trop-perçu refusé', async () => {
  assert.equal((await api(L, 'POST', `/api/clients/${cli}/reglement`, { montant: 700, mode: 'especes' }, V)).solde, 500)
  assert.equal((await api(L, 'POST', `/api/clients/${cli}/reglement`, { montant: 9999 }, V)).code, 409)
})
const org = (await api(L, 'POST', '/api/organismes', { nom: 'MUGEFCI', taux: 80 }, T)).id
await ok('bon de santé : part patient/organisme, n° adhérent conservé', async () => {
  const r = await vente({ id: 'v-7', organisme_id: org, num_adherent: 'MG-1', client_id: cli, lignes: [{ produit_id: amox, qte: 2 }], paiements: [{ mode: 'especes', montant: 920 }] })
  assert.equal(r.total, 4600); assert.equal(r.part_organisme, 3680); assert.equal(r.part_patient, 920)
})
await ok('stupéfiant : patient, prescripteur et ordonnance obligatoires', async () => {
  assert.equal((await vente({ id: 'v-8', lignes: [{ produit_id: trama, qte: 1 }], paiements: [{ mode: 'especes', montant: 2400 }] })).code, 400)
  const r = await vente({ id: 'v-8b', patient_nom: 'Yao Marie', prescripteur: 'Dr Konan', num_ordonnance: 'ORD-55', lignes: [{ produit_id: trama, qte: 2 }], paiements: [{ mode: 'especes', montant: 4800 }] })
  assert.equal(r.code, 200)
  const reg = await api(L, 'GET', '/api/registre', null, T)
  assert.equal(reg.lignes[0].type, 'sortie'); assert.equal(reg.lignes[0].solde, 8); assert.equal(reg.lignes[0].prescripteur, 'Dr Konan')
})
await ok('vente hors ligne : acceptée, stock à régulariser signalé', async () => {
  const r = await vente({ id: 'v-9', hors_ligne: true, created_at: new Date(Date.now() - 600000).toISOString(), lignes: [{ produit_id: gen, qte: 40 }], paiements: [{ mode: 'especes', montant: 16000 }] })
  assert.equal(r.code, 200); assert.equal(r.a_regulariser.length, 1)
  assert.ok((await api(L, 'GET', '/api/alertes', null, T)).a_regulariser >= 1)
})
await ok('retour partiel : stock remis, remboursement proportionnel à la remise', async () => {
  const v = (await api(L, 'GET', '/api/ventes/v-4b', null, PR))
  const avant = (await api(L, 'GET', `/api/produits/${para}`, null, T)).stock
  const r = await api(L, 'POST', '/api/ventes/v-4b/retour', { lignes: [{ ligne_id: v.lignes[0].id, qte: 1 }], mode: 'especes' }, PH)
  assert.equal(r.rembourse, 500)
  assert.equal((await api(L, 'GET', `/api/produits/${para}`, null, T)).stock, avant + 1)
  assert.equal((await api(L, 'POST', '/api/ventes/v-4b/retour', { lignes: [{ ligne_id: v.lignes[0].id, qte: 1 }] }, PH)).code, 409)
  assert.equal((await api(L, 'POST', '/api/ventes/v-4b/annuler', null, PH)).code, 409)
})
await ok('annulation d\'une vente : stock et dette client remis', async () => {
  await vente({ id: 'v-10', client_id: cli, lignes: [{ produit_id: para, qte: 1 }], paiements: [{ mode: 'credit', montant: 600 }] })
  const avant = (await api(L, 'GET', `/api/clients/${cli}`, null, T)).solde
  assert.equal((await api(L, 'POST', '/api/ventes/v-10/annuler', null, V)).code, 403)
  await api(L, 'POST', '/api/ventes/v-10/annuler', null, PH)
  assert.equal((await api(L, 'GET', `/api/clients/${cli}`, null, T)).solde, avant - 600)
})
await ok('clôture de caisse : espèces attendues et écart', async () => {
  const cur = (await api(L, 'GET', '/api/caisse', null, V)).courante
  assert.equal(cur.fond_initial, 10000)
  // fond 10 000 + ventes espèces (7 800 + 1 000 + 920 + 4 800 + 16 000) + règlement client 700 - sortie 500
  const attendu = 10000 + 7800 + 1000 + 920 + 4800 + 16000 + 700 - 500
  await api(L, 'POST', '/api/caisse/mouvement', { type: 'sortie', montant: 500, motif: 'Achat sacs' }, V)
  const f = await api(L, 'POST', '/api/caisse/fermer', { especes_comptees: attendu - 3 }, V)
  assert.equal(f.especes_attendues, attendu); assert.equal(f.ecart, -3); assert.equal(f.statut, 'fermee')
  assert.equal((await api(L, 'POST', '/api/caisse/fermer', { especes_comptees: 0 }, V)).code, 409)
})

// ───────── Tiers payant, inventaire, statistiques ─────────
await ok('bordereau de tiers payant : total organisme, ventes verrouillées, paiement', async () => {
  const tp = await api(L, 'GET', '/api/tiers-payant', null, T)
  assert.equal(tp.a_facturer[0].montant, 3680)
  const b = await api(L, 'POST', '/api/bordereaux', { organisme_id: org }, PH)
  assert.equal(b.total, 3680); assert.equal(b.nb_ventes, 1)
  assert.equal((await api(L, 'POST', '/api/bordereaux', { organisme_id: org }, PH)).code, 409)
  assert.equal((await api(L, 'POST', '/api/ventes/v-7/annuler', null, PH)).code, 409)
  await api(L, 'POST', `/api/bordereaux/${b.id}/payer`, null, PH)
  assert.equal((await api(L, 'GET', '/api/tiers-payant', null, T)).encaisse_30j, 3680)
})
await ok('inventaire : comptage, écart appliqué à la clôture', async () => {
  const inv = await api(L, 'POST', '/api/inventaires', { nom: 'Test' }, PR)
  assert.equal((await api(L, 'POST', '/api/inventaires', {}, PR)).code, 409)
  const d = await api(L, 'GET', `/api/inventaires/${inv.id}`, null, PR)
  const li = d.lignes.find((x) => x.lot_numero === 'LOT-TARD')
  await api(L, 'POST', `/api/inventaires/${inv.id}/compter`, { lot_id: li.lot_id, qte: li.qte_theorique - 2 }, PR)
  const avant = (await api(L, 'GET', `/api/produits/${para}`, null, T)).stock
  const c = await api(L, 'POST', `/api/inventaires/${inv.id}/cloturer`, null, PR)
  assert.equal(c.ecarts, 1); assert.equal(c.valeur, -820)
  assert.equal((await api(L, 'GET', `/api/produits/${para}`, null, T)).stock, avant - 2)
})
await ok('perte de stock (casse) : stock et valeur', async () => {
  const f = await api(L, 'GET', `/api/produits/${amox}`, null, T)
  const r = await api(L, 'POST', '/api/pertes', { lot_id: f.lots[0].id, qte: 1, motif: 'casse' }, PR)
  assert.equal(r.valeur, 1300)
})
const aujourdhui = new Date().toISOString().slice(0, 10)
const st = await api(L, 'GET', `/api/stats?du=${aujourdhui}&au=${aujourdhui}`, null, T)
await ok('statistiques : CA, marge, panier moyen, ABC, modes, créances', async () => {
  assert.ok(st.ca > 0 && st.nb_ventes > 5 && st.panier_moyen > 0)
  assert.ok(st.marge > 0 && st.taux_marge > 0 && st.taux_marge < 100)
  assert.equal(st.serie.length, 1); assert.ok(st.top_produits.length > 0)
  assert.ok(st.abc.A >= 1); assert.ok(st.par_mode.some((m) => m.mode === 'wave'))
  assert.equal(st.creances_clients, 500); assert.equal(st.dettes_fournisseurs, rec.total - 50000)
  assert.equal(st.valeur_stock.achat > 0, true)
})
await ok('le pharmacien adjoint voit la marge, le titulaire aussi', async () => assert.ok((await api(L, 'GET', `/api/stats?du=${aujourdhui}&au=${aujourdhui}`, null, PH)).marge !== null))
await ok('paramètres de l\'officine modifiables (nom corrigé)', async () => {
  await api(L, 'POST', '/api/parametres', { officine: 'Pharmacie Centrale', adresse: 'Cocody', telephone: '27 00', message_ticket: 'Merci' }, T)
  assert.equal((await (await fetch(L + '/api/etat')).json()).officine, 'Pharmacie Centrale')
  assert.equal((await api(L, 'POST', '/api/parametres', { officine: 'X' }, PH)).code, 403)
})
await ok('PIN : blocage après 5 essais', async () => {
  for (let i = 0; i < 5; i++) await api(L, 'POST', '/api/pin', { user_id: equipe.find((u) => u.nom === 'Awa').id, pin: '0000' })
  assert.equal((await api(L, 'POST', '/api/pin', { user_id: equipe.find((u) => u.nom === 'Awa').id, pin: '3333' })).code, 429)
})

// ───────── Synchronisation cloud (incrémentale, sans secret) ─────────
process.env.CLOUD_URL = C; process.env.SYNC_KEY = 'cle-test-sync'
await ok('cloud refuse une mauvaise clé', async () => assert.equal((await api(C, 'POST', '/api/sync', { sonde: true }, 'mauvaise')).code, 401))
const s1 = await local.pousser()
await ok('première synchronisation complète', async () => assert.ok(s1.ok && s1.lignes > 50))
const instC = await api(C, 'POST', '/api/installation', { officine: 'Pharmacie Test', nom: 'Dr Test', email: 'dr@test.ci', mdp: 'mot-de-passe-cloud-1' })
const TC = (await api(C, 'POST', '/api/login', { email: 'dr@test.ci', mdp: 'mot-de-passe-cloud-1', code: code(instC.totp_secret) })).token
await ok('le cloud affiche les mêmes chiffres que l\'officine', async () => {
  const sc = await api(C, 'GET', `/api/stats?du=${aujourdhui}&au=${aujourdhui}`, null, TC)
  assert.equal(sc.ca, st.ca); assert.equal(sc.marge, st.marge); assert.equal(sc.creances_clients, 500)
  assert.equal((await api(C, 'GET', '/api/registre', null, TC)).lignes.length, 2)
})
await ok('synchronisation incrémentale : seule la nouvelle vente est envoyée', async () => {
  await api(L, 'POST', '/api/caisse/ouvrir', { fond: 0 }, PR)
  const v11 = await api(L, 'POST', '/api/ventes', { id: 'v-11', lignes: [{ produit_id: para, qte: 1 }], paiements: [{ mode: 'especes', montant: 600 }] }, PR)
  assert.equal(v11.code, 200, JSON.stringify(v11))
  const s2 = await local.pousser()
  assert.ok(s2.lignes > 0 && s2.lignes < 15, `lignes envoyées : ${s2.lignes}`)
  assert.equal((await api(C, 'GET', `/api/stats?du=${aujourdhui}&au=${aujourdhui}`, null, TC)).ca, st.ca + 600)
  assert.equal((await local.pousser()).lignes, 0)
})
await ok('le cloud est en lecture seule et sans PIN', async () => {
  assert.equal((await api(C, 'POST', '/api/ventes', { id: 'x', lignes: [] }, TC)).code, 403)
  assert.equal((await api(C, 'POST', '/api/pin', { user_id: equipe[0].id, pin: '1111' })).code, 403)
  assert.equal((await api(C, 'GET', '/api/utilisateurs', null, TC)).length, 1)
})
await ok('cloud vidé (hébergement temporaire) : tout est renvoyé automatiquement', async () => {
  nuage.close(); nettoyer(CLOUD)
  const nuage2 = creerServeur({ fichier: CLOUD, mode: 'cloud', cleSync: 'cle-test-sync' })
  await new Promise((r) => nuage2.listen(0, '127.0.0.1', r))
  const C2 = `http://127.0.0.1:${nuage2.address().port}`
  process.env.CLOUD_URL = C2
  const s = await local.pousser()
  assert.ok(s.lignes > 50)
  const i = await api(C2, 'POST', '/api/installation', { officine: 'P', nom: 'D', email: 'd@t.ci', mdp: 'mot-de-passe-cloud-1' })
  const l2 = await api(C2, 'POST', '/api/login', { email: 'd@t.ci', mdp: 'mot-de-passe-cloud-1', code: code(i.totp_secret) })
  assert.equal((await api(C2, 'GET', `/api/stats?du=${aujourdhui}&au=${aujourdhui}`, null, l2.token)).ca, st.ca + 600)
  nuage2.close()
})

console.log(`\n${n} vérifications réussies`)
local.close()
setTimeout(() => process.exit(0), 100)
