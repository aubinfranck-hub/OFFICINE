import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ouvrirBase, maintenant, uuid, sha256, hacher, verifier, nouveauSecretTotp, totpValide,
  normaliserPeremption, Erreur
} from './lib.js'
import crypto from 'node:crypto'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(ICI, '..', 'public')
const MODES_MOBILE = ['wave', 'orange', 'mtn', 'moov']
const MODES = ['especes', ...MODES_MOBILE, 'bon_sante']
const SESSION_MS = 12 * 3600 * 1000

// MODE=local : serveur de l'officine (hors ligne, caisse). MODE=cloud : copie en lecture pour le titulaire à distance.
export function creerServeur({ fichier = process.env.DB || 'lgo.db', mode = process.env.MODE || 'local', cleSync = process.env.SYNC_KEY || '' } = {}) {
  const db = ouvrirBase(fichier)
  const cloud = mode === 'cloud'

  const get = (sql, ...p) => db.prepare(sql).get(...p)
  const all = (sql, ...p) => db.prepare(sql).all(...p)
  const run = (sql, ...p) => db.prepare(sql).run(...p)
  const tx = (fn) => {
    db.exec('BEGIN IMMEDIATE')
    try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
  }
  const journal = (u, action, detail, ip) =>
    run('INSERT INTO audit (user_id,user_nom,action,detail,ip,created_at) VALUES (?,?,?,?,?,?)', u?.id ?? null, u?.nom ?? null, action, detail ?? null, ip ?? null, maintenant())

  const reseauLocal = (req) => {
    if (req.headers['x-forwarded-for']) return false
    const a = (req.socket.remoteAddress || '').replace('::ffff:', '')
    return a === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)
  }
  const ipDe = (req) => req.headers['x-forwarded-for'] || req.socket.remoteAddress

  function ouvrirSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url')
    run('INSERT INTO sessions (token_hash,user_id,expire) VALUES (?,?,?)', sha256(token), userId, Date.now() + SESSION_MS)
    return token
  }
  function utilisateur(req) {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '')
    if (!t) return null
    return get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expire>? AND u.actif=1', sha256(t), Date.now()) || null
  }
  const exiger = (u, ...roles) => {
    if (!u) throw new Erreur(401, 'Connexion requise')
    if (roles.length && !roles.includes(u.role)) throw new Erreur(403, 'Accès refusé')
    return u
  }
  const exigerLocal = () => { if (cloud) throw new Erreur(403, 'Action disponible uniquement sur le serveur de l\'officine') }
  const publicUser = (u) => ({ id: u.id, nom: u.nom, role: u.role })

  function tentative(u, ok) {
    if (ok) { run('UPDATE users SET echecs=0, bloque_jusqua=0 WHERE id=?', u.id); return }
    const n = u.echecs + 1
    run('UPDATE users SET echecs=?, bloque_jusqua=? WHERE id=?', n >= 5 ? 0 : n, n >= 5 ? Date.now() + 5 * 60000 : 0, u.id)
  }
  const verifierBlocage = (u) => { if (u.bloque_jusqua > Date.now()) throw new Erreur(429, 'Compte bloqué 5 minutes après trop d\'essais') }

  const stockProduit = `COALESCE((SELECT SUM(qte) FROM lots l WHERE l.produit_id=p.id),0)`

  // ───────── Ventes : sélection FEFO (premier périmé, premier sorti) ─────────
  function creerVente(p, user, { horsLigne = false } = {}) {
    if (!p || typeof p.id !== 'string' || !Array.isArray(p.lignes) || !p.lignes.length) throw new Erreur(400, 'Vente invalide')
    if (!MODES.includes(p.mode)) throw new Erreur(400, 'Mode de paiement inconnu')
    const deja = get('SELECT id,numero,total,part_patient,paiement_statut FROM ventes WHERE id=?', p.id)
    if (deja) return { ...deja, deja: true }
    return tx(() => {
      const quand = horsLigne && p.created_at && !isNaN(Date.parse(p.created_at)) && Date.parse(p.created_at) <= Date.now() + 60000 ? new Date(p.created_at).toISOString() : maintenant()
      const jour = quand.slice(0, 10)
      const aujourdhui = jour
      let org = null
      if (p.mode === 'bon_sante') {
        org = get('SELECT * FROM organismes WHERE id=? AND actif=1', String(p.organisme_id ?? ''))
        if (!org) throw new Erreur(400, 'Organisme du bon de santé requis')
      }
      const lignes = []
      const manques = []
      let total = 0
      for (const l of p.lignes) {
        const qte = Number(l?.qte)
        if (!Number.isInteger(qte) || qte <= 0) throw new Erreur(400, 'Quantité invalide')
        const prod = get('SELECT * FROM produits WHERE id=? AND actif=1', String(l?.produit_id ?? ''))
        if (!prod) throw new Erreur(400, 'Produit inconnu')
        let reste = qte
        const lots = all('SELECT * FROM lots WHERE produit_id=? AND qte>0 AND peremption>=? ORDER BY peremption, numero', prod.id, aujourdhui)
        for (const lot of lots) {
          if (reste === 0) break
          const prend = Math.min(reste, lot.qte)
          lignes.push({ produit_id: prod.id, lot_id: lot.id, nom: prod.nom, qte: prend, prix: prod.prix })
          reste -= prend
        }
        if (reste > 0) {
          if (!horsLigne) throw new Erreur(409, `Stock insuffisant : ${prod.nom} (manque ${reste})`)
          lignes.push({ produit_id: prod.id, lot_id: null, nom: prod.nom, qte: reste, prix: prod.prix })
          manques.push(`${prod.nom} x${reste}`)
        }
        total += qte * prod.prix
      }
      const taux = org ? org.taux : 0
      const part = total - Math.round((total * taux) / 100)
      const n = get(`SELECT COUNT(*) c FROM ventes WHERE substr(created_at,1,10)=?`, jour).c + 1
      const numero = `V-${jour.replaceAll('-', '')}-${String(n).padStart(4, '0')}`
      const statut = MODES_MOBILE.includes(p.mode) ? 'a_confirmer' : 'confirme'
      run('INSERT INTO ventes (id,numero,user_id,user_nom,total,mode,organisme,taux_prise_charge,part_patient,paiement_statut,hors_ligne,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        p.id, numero, user.id, user.nom, total, p.mode, org?.nom ?? null, taux, part, statut, horsLigne ? 1 : 0, quand)
      for (const l of lignes) {
        run('INSERT INTO lignes_vente (vente_id,produit_id,lot_id,nom,qte,prix) VALUES (?,?,?,?,?,?)', p.id, l.produit_id, l.lot_id, l.nom, l.qte, l.prix)
        if (l.lot_id) run('UPDATE lots SET qte=qte-? WHERE id=?', l.qte, l.lot_id)
        run('INSERT INTO mouvements (produit_id,lot_id,type,qte,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?)', l.produit_id, l.lot_id, l.lot_id ? 'vente' : 'vente_sans_stock', -l.qte, numero, user.id, quand)
      }
      if (manques.length) journal(user, 'stock_a_regulariser', `${numero} : ${manques.join(', ')}`)
      return { id: p.id, numero, total, part_patient: part, paiement_statut: statut, a_regulariser: manques }
    })
  }

  function annulerVente(id, user) {
    return tx(() => {
      const v = get('SELECT * FROM ventes WHERE id=?', id)
      if (!v) throw new Erreur(404, 'Vente introuvable')
      if (v.statut !== 'valide') throw new Erreur(409, 'Vente déjà annulée')
      for (const l of all('SELECT * FROM lignes_vente WHERE vente_id=?', id)) {
        if (l.lot_id) run('UPDATE lots SET qte=qte+? WHERE id=?', l.qte, l.lot_id)
        run('INSERT INTO mouvements (produit_id,lot_id,type,qte,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?)', l.produit_id, l.lot_id, 'annulation', l.qte, v.numero, user.id, maintenant())
      }
      run("UPDATE ventes SET statut='annulee', synced=0 WHERE id=?", id)
      journal(user, 'vente_annulee', v.numero)
      return { ok: true }
    })
  }

  // ───────── Rapports et alertes ─────────
  function rapport(date) {
    const base = `FROM ventes WHERE substr(created_at,1,10)=? AND statut='valide'`
    const t = get(`SELECT COUNT(*) nb, COALESCE(SUM(total),0) ca, COALESCE(SUM(part_patient),0) encaisse ${base}`, date)
    return {
      date, nb_ventes: t.nb, chiffre_affaires: t.ca, part_patients: t.encaisse, part_organismes: t.ca - t.encaisse,
      par_mode: all(`SELECT mode, COUNT(*) nb, SUM(part_patient) montant, SUM(CASE WHEN paiement_statut='a_confirmer' THEN part_patient ELSE 0 END) a_confirmer ${base} GROUP BY mode ORDER BY montant DESC`, date),
      par_vendeur: all(`SELECT user_nom, COUNT(*) nb, SUM(total) ca ${base} GROUP BY user_id ORDER BY ca DESC`, date),
      top_produits: all(`SELECT l.nom, SUM(l.qte) qte, SUM(l.qte*l.prix) ca FROM lignes_vente l JOIN ventes v ON v.id=l.vente_id WHERE substr(v.created_at,1,10)=? AND v.statut='valide' GROUP BY l.produit_id ORDER BY qte DESC LIMIT 5`, date),
      hors_ligne: get(`SELECT COUNT(*) c ${base} AND hors_ligne=1`, date).c
    }
  }
  function alertes() {
    const auj = maintenant().slice(0, 10)
    const dans90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
    const prods = all(`SELECT p.id,p.nom,p.seuil,${stockProduit} stock FROM produits p WHERE p.actif=1`)
    return {
      ruptures: prods.filter((p) => p.stock <= 0 && p.seuil > 0).map((p) => ({ ...p, a_commander: p.seuil * 2 })),
      stock_bas: prods.filter((p) => p.stock > 0 && p.stock <= p.seuil).map((p) => ({ ...p, a_commander: p.seuil * 2 - p.stock })),
      peremption_proche: all(`SELECT l.id,p.nom,l.numero,l.peremption,l.qte FROM lots l JOIN produits p ON p.id=l.produit_id WHERE l.qte>0 AND l.peremption>=? AND l.peremption<=? ORDER BY l.peremption`, auj, dans90),
      perimes: all(`SELECT l.id,p.nom,l.numero,l.peremption,l.qte FROM lots l JOIN produits p ON p.id=l.produit_id WHERE l.qte>0 AND l.peremption<? ORDER BY l.peremption`, auj),
      a_regulariser: get(`SELECT COUNT(*) c FROM mouvements WHERE type='vente_sans_stock'`).c
    }
  }

  // ───────── Synchronisation vers le cloud (sans aucun secret) ─────────
  function lotSync() {
    const ventes = all('SELECT * FROM ventes WHERE synced=0 ORDER BY created_at LIMIT 200')
    for (const v of ventes) v.lignes = all('SELECT produit_id,lot_id,nom,qte,prix FROM lignes_vente WHERE vente_id=?', v.id)
    return {
      ventes,
      produits: all('SELECT * FROM produits'),
      lots: all('SELECT * FROM lots'),
      organismes: all('SELECT * FROM organismes')
    }
  }
  function recevoirSync(l) {
    tx(() => {
      for (const p of l.produits ?? []) run('INSERT OR REPLACE INTO produits (id,code,nom,dci,forme,prix,seuil,actif) VALUES (?,?,?,?,?,?,?,?)', p.id, p.code, p.nom, p.dci, p.forme, p.prix, p.seuil, p.actif)
      for (const o of l.organismes ?? []) run('INSERT OR REPLACE INTO organismes (id,nom,taux,actif) VALUES (?,?,?,?)', o.id, o.nom, o.taux, o.actif)
      run('DELETE FROM lots')
      for (const x of l.lots ?? []) run('INSERT INTO lots (id,produit_id,numero,peremption,qte) VALUES (?,?,?,?,?)', x.id, x.produit_id, x.numero, x.peremption, x.qte)
      for (const v of l.ventes ?? []) {
        run('INSERT OR REPLACE INTO ventes (id,numero,user_id,user_nom,total,mode,organisme,taux_prise_charge,part_patient,paiement_statut,statut,hors_ligne,created_at,synced) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)',
          v.id, v.numero, v.user_id, v.user_nom, v.total, v.mode, v.organisme, v.taux_prise_charge, v.part_patient, v.paiement_statut, v.statut, v.hors_ligne, v.created_at)
        run('DELETE FROM lignes_vente WHERE vente_id=?', v.id)
        for (const li of v.lignes ?? []) run('INSERT INTO lignes_vente (vente_id,produit_id,lot_id,nom,qte,prix) VALUES (?,?,?,?,?,?)', v.id, li.produit_id, li.lot_id, li.nom, li.qte, li.prix)
      }
      run("INSERT OR REPLACE INTO meta (k,v) VALUES ('derniere_sync',?)", maintenant())
    })
  }
  let minuteurSync = null
  async function pousser() {
    const url = process.env.CLOUD_URL
    if (!url || cloud) return { ok: false, raison: 'non configuré' }
    const cible = url.replace(/\/$/, '') + '/api/sync'
    const entetesSync = { 'content-type': 'application/json', authorization: `Bearer ${process.env.SYNC_KEY}` }
    const sonde = await fetch(cible, { method: 'POST', headers: entetesSync, body: JSON.stringify({ sonde: true }), signal: AbortSignal.timeout(60000) })
    if (!sonde.ok) throw new Error('Sonde refusée ' + sonde.status)
    if ((await sonde.json()).nb_ventes < get('SELECT COUNT(*) c FROM ventes').c) run('UPDATE ventes SET synced=0')
    const lot = lotSync()
    const r = await fetch(cible, {
      method: 'POST', headers: entetesSync,
      body: JSON.stringify(lot), signal: AbortSignal.timeout(60000)
    })
    if (!r.ok) throw new Error('Sync refusée ' + r.status)
    for (const v of lot.ventes) run('UPDATE ventes SET synced=1 WHERE id=?', v.id)
    run("INSERT OR REPLACE INTO meta (k,v) VALUES ('derniere_sync',?)", maintenant())
    return { ok: true, ventes: lot.ventes.length, reste: get('SELECT COUNT(*) c FROM ventes WHERE synced=0').c }
  }
  const demarrerSync = () => {
    if (process.env.CLOUD_URL && !cloud && !minuteurSync) {
      minuteurSync = setInterval(() => pousser().catch(() => {}), 15000)
      minuteurSync.unref()
    }
  }

  // ───────── Routes ─────────
  if (cloud && process.env.INIT_EMAIL && process.env.INIT_MDP && process.env.INIT_TOTP && !get("SELECT 1 x FROM users WHERE role='titulaire'")) {
    run('INSERT INTO users (id,nom,role,email,mdp_hash,totp_secret,created_at) VALUES (?,?,?,?,?,?,?)', uuid(), process.env.INIT_NOM || 'Titulaire', 'titulaire', process.env.INIT_EMAIL.toLowerCase(), hacher(process.env.INIT_MDP), process.env.INIT_TOTP, maintenant())
    run("INSERT OR REPLACE INTO meta (k,v) VALUES ('officine',?)", process.env.INIT_OFFICINE || 'Officine')
  }
  const routes = []
  const route = (m, re, fn) => routes.push([m, new RegExp(`^${re}$`), fn])
  const jour = (q) => (/^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '') ? q.get('date') : maintenant().slice(0, 10))

  route('GET', '/api/etat', () => ({
    installe: !!get("SELECT 1 x FROM users WHERE role='titulaire'"), mode,
    officine: get("SELECT v FROM meta WHERE k='officine'")?.v ?? null,
    derniere_sync: get("SELECT v FROM meta WHERE k='derniere_sync'")?.v ?? null
  }))

  route('POST', '/api/installation', ({ body, req }) => {
    if (get("SELECT 1 x FROM users WHERE role='titulaire'")) throw new Erreur(409, 'Déjà installé')
    const { officine, nom, email, mdp } = body
    if (!officine || !nom || !email || typeof mdp !== 'string' || mdp.length < 10) throw new Erreur(400, 'Nom, email et mot de passe (10 caractères minimum) requis')
    const secret = nouveauSecretTotp()
    const id = uuid()
    run('INSERT INTO users (id,nom,role,email,mdp_hash,totp_secret,created_at) VALUES (?,?,?,?,?,?,?)', id, nom, 'titulaire', email.toLowerCase(), hacher(mdp), secret, maintenant())
    run("INSERT OR REPLACE INTO meta (k,v) VALUES ('officine',?)", officine)
    journal({ id, nom }, 'installation', officine, ipDe(req))
    return { totp_secret: secret, otpauth: `otpauth://totp/LGO:${encodeURIComponent(email)}?secret=${secret}&issuer=LGO` }
  })

  // Titulaire : mot de passe + code de l'application d'authentification (jamais de SMS)
  route('POST', '/api/login', ({ body, req }) => {
    const u = get("SELECT * FROM users WHERE email=? AND role='titulaire' AND actif=1", String(body.email || '').toLowerCase())
    if (!u) throw new Erreur(401, 'Identifiants incorrects')
    verifierBlocage(u)
    const ok = verifier(String(body.mdp || ''), u.mdp_hash) && totpValide(u.totp_secret, body.code || '')
    tentative(u, ok)
    if (!ok) { journal(u, 'connexion_refusee', null, ipDe(req)); throw new Erreur(401, 'Identifiants incorrects') }
    journal(u, 'connexion', cloud ? 'distance' : 'local', ipDe(req))
    return { token: ouvrirSession(u.id), user: publicUser(u) }
  })

  // Vendeuses : PIN, uniquement depuis le réseau de l'officine
  route('GET', '/api/equipe', ({ req }) => {
    exigerLocal()
    if (!reseauLocal(req)) throw new Erreur(403, 'Réseau de l\'officine requis')
    return all("SELECT id,nom FROM users WHERE role='vendeur' AND actif=1 ORDER BY nom")
  })
  route('POST', '/api/pin', ({ body, req }) => {
    exigerLocal()
    if (!reseauLocal(req)) throw new Erreur(403, 'Connexion par PIN réservée au réseau de l\'officine')
    const u = get("SELECT * FROM users WHERE id=? AND role='vendeur' AND actif=1", String(body.user_id || ''))
    if (!u) throw new Erreur(401, 'PIN incorrect')
    verifierBlocage(u)
    const ok = /^\d{4,6}$/.test(String(body.pin)) && verifier(String(body.pin), u.pin_hash)
    tentative(u, ok)
    if (!ok) { journal(u, 'pin_refuse', null, ipDe(req)); throw new Erreur(401, 'PIN incorrect') }
    journal(u, 'connexion', 'pin', ipDe(req))
    return { token: ouvrirSession(u.id), user: publicUser(u) }
  })
  route('POST', '/api/logout', ({ req }) => {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '')
    if (t) run('DELETE FROM sessions WHERE token_hash=?', sha256(t))
    return { ok: true }
  })
  route('GET', '/api/me', ({ user }) => publicUser(exiger(user)))

  // Catalogue (mis en cache sur la tablette pour vendre hors ligne)
  route('GET', '/api/catalogue', ({ user }) => {
    exiger(user)
    return {
      produits: all(`SELECT p.id,p.code,p.nom,p.dci,p.forme,p.prix,p.seuil,${stockProduit} stock FROM produits p WHERE p.actif=1 ORDER BY p.nom`),
      organismes: all('SELECT id,nom,taux FROM organismes WHERE actif=1 ORDER BY nom'),
      genere_le: maintenant()
    }
  })
  route('POST', '/api/produits', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'titulaire')
    const prix = Number(body.prix), seuil = Number(body.seuil ?? 0)
    if (!body.nom || !Number.isInteger(prix) || prix < 0 || !Number.isInteger(seuil) || seuil < 0) throw new Erreur(400, 'Nom, prix (entier en F CFA) et seuil requis')
    const id = body.id || uuid()
    const existe = get('SELECT 1 x FROM produits WHERE id=?', id)
    if (existe) run('UPDATE produits SET code=?,nom=?,dci=?,forme=?,prix=?,seuil=?,actif=? WHERE id=?', body.code ?? null, body.nom, body.dci ?? null, body.forme ?? null, prix, seuil, body.actif === 0 ? 0 : 1, id)
    else run('INSERT INTO produits (id,code,nom,dci,forme,prix,seuil) VALUES (?,?,?,?,?,?,?)', id, body.code ?? null, body.nom, body.dci ?? null, body.forme ?? null, prix, seuil)
    journal(user, existe ? 'produit_modifie' : 'produit_cree', `${body.nom} ${prix}F`, ipDe(req))
    return { id }
  })
  route('POST', '/api/reception', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'titulaire')
    const qte = Number(body.qte)
    if (!Number.isInteger(qte) || qte <= 0 || !body.numero) throw new Erreur(400, 'Produit, n° de lot et quantité requis')
    if (!get('SELECT 1 x FROM produits WHERE id=?', String(body.produit_id ?? ''))) throw new Erreur(400, 'Produit inconnu')
    const per = normaliserPeremption(String(body.peremption || ''))
    return tx(() => {
      const lot = get('SELECT * FROM lots WHERE produit_id=? AND numero=?', String(body.produit_id), String(body.numero))
      let id = lot?.id
      if (lot) run('UPDATE lots SET qte=qte+?, peremption=? WHERE id=?', qte, per, id)
      else { id = uuid(); run('INSERT INTO lots (id,produit_id,numero,peremption,qte) VALUES (?,?,?,?,?)', id, body.produit_id, body.numero, per, qte) }
      run('INSERT INTO mouvements (produit_id,lot_id,type,qte,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?)', body.produit_id, id, 'reception', qte, body.numero, user.id, maintenant())
      journal(user, 'reception', `${body.numero} x${qte}`, ipDe(req))
      return { lot_id: id }
    })
  })
  route('POST', '/api/ajustement', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'titulaire')
    const delta = Number(body.delta)
    if (!Number.isInteger(delta) || delta === 0 || !body.motif) throw new Erreur(400, 'Variation et motif requis')
    return tx(() => {
      const lot = get('SELECT * FROM lots WHERE id=?', String(body.lot_id ?? ''))
      if (!lot) throw new Erreur(404, 'Lot introuvable')
      if (lot.qte + delta < 0) throw new Erreur(409, 'Le stock ne peut pas devenir négatif')
      run('UPDATE lots SET qte=qte+? WHERE id=?', delta, lot.id)
      run('INSERT INTO mouvements (produit_id,lot_id,type,qte,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?)', lot.produit_id, lot.id, 'ajustement', delta, body.motif, user.id, maintenant())
      journal(user, 'ajustement_stock', `${lot.numero} ${delta} (${body.motif})`, ipDe(req))
      return { ok: true }
    })
  })

  route('POST', '/api/ventes', ({ user, body, req }) => {
    exigerLocal(); exiger(user)
    const r = creerVente(body, user, { horsLigne: body.hors_ligne === true })
    if (!r.deja) journal(user, 'vente', `${r.numero} ${r.total}F`, ipDe(req))
    return r
  })
  route('GET', '/api/ventes', ({ user, q }) => {
    exiger(user)
    const d = jour(q)
    const vs = user.role === 'titulaire'
      ? all("SELECT * FROM ventes WHERE substr(created_at,1,10)=? ORDER BY created_at DESC", d)
      : all("SELECT * FROM ventes WHERE substr(created_at,1,10)=? AND user_id=? ORDER BY created_at DESC", d, user.id)
    for (const v of vs) v.lignes = all('SELECT nom,qte,prix FROM lignes_vente WHERE vente_id=?', v.id)
    return vs
  })
  route('POST', '/api/ventes/([^/]+)/confirmer', ({ user, params, req }) => {
    exigerLocal(); exiger(user, 'titulaire')
    const r = run("UPDATE ventes SET paiement_statut='confirme', synced=0 WHERE id=? AND statut='valide'", params[0])
    if (!r.changes) throw new Erreur(404, 'Vente introuvable')
    journal(user, 'paiement_confirme', params[0], ipDe(req))
    return { ok: true }
  })
  route('POST', '/api/ventes/([^/]+)/annuler', ({ user, params }) => {
    exigerLocal(); exiger(user, 'titulaire')
    return annulerVente(params[0], user)
  })

  route('GET', '/api/rapport', ({ user, q }) => rapport(jour(exiger(user, 'titulaire') && q)))
  route('GET', '/api/alertes', ({ user }) => { exiger(user, 'titulaire'); return alertes() })
  route('GET', '/api/stock', ({ user }) => {
    exiger(user, 'titulaire')
    const produits = all(`SELECT p.id,p.code,p.nom,p.prix,p.seuil,${stockProduit} stock FROM produits p WHERE p.actif=1 ORDER BY p.nom`)
    const lots = all('SELECT id,produit_id,numero,peremption,qte FROM lots WHERE qte>0 ORDER BY peremption')
    return produits.map((p) => ({ ...p, lots: lots.filter((l) => l.produit_id === p.id) }))
  })
  route('GET', '/api/organismes', ({ user }) => { exiger(user); return all('SELECT id,nom,taux,actif FROM organismes ORDER BY nom') })
  route('POST', '/api/organismes', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'titulaire')
    const taux = Number(body.taux)
    if (!body.nom || !Number.isInteger(taux) || taux < 0 || taux > 100) throw new Erreur(400, 'Nom et taux (0 à 100) requis')
    const id = body.id || uuid()
    run('INSERT OR REPLACE INTO organismes (id,nom,taux,actif) VALUES (?,?,?,?)', id, body.nom, taux, body.actif === 0 ? 0 : 1)
    journal(user, 'organisme', `${body.nom} ${taux}%`, ipDe(req))
    return { id }
  })
  route('GET', '/api/utilisateurs', ({ user }) => { exiger(user, 'titulaire'); return all('SELECT id,nom,role,actif FROM users ORDER BY role DESC, nom') })
  route('POST', '/api/utilisateurs', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'titulaire')
    if (!body.nom || !/^\d{4,6}$/.test(String(body.pin))) throw new Erreur(400, 'Nom et PIN de 4 à 6 chiffres requis')
    const id = uuid()
    run('INSERT INTO users (id,nom,role,pin_hash,created_at) VALUES (?,?,?,?,?)', id, body.nom, 'vendeur', hacher(String(body.pin)), maintenant())
    journal(user, 'utilisateur_cree', body.nom, ipDe(req))
    return { id }
  })
  route('POST', '/api/utilisateurs/([^/]+)/desactiver', ({ user, params, req }) => {
    exigerLocal(); exiger(user, 'titulaire')
    run("UPDATE users SET actif=0 WHERE id=? AND role='vendeur'", params[0])
    run('DELETE FROM sessions WHERE user_id=?', params[0])
    journal(user, 'utilisateur_desactive', params[0], ipDe(req))
    return { ok: true }
  })
  route('GET', '/api/audit', ({ user }) => { exiger(user, 'titulaire'); return all('SELECT * FROM audit ORDER BY id DESC LIMIT 200') })

  route('POST', '/api/sync', ({ req, body }) => {
    if (!cloud) throw new Erreur(404, 'Introuvable')
    const t = (req.headers.authorization || '').replace(/^Bearer /, '')
    const a = Buffer.from(sha256(t)), b = Buffer.from(sha256(cleSync))
    if (!cleSync || !crypto.timingSafeEqual(a, b)) throw new Erreur(401, 'Clé de synchronisation invalide')
    if (body.sonde) return { ok: true, nb_ventes: get('SELECT COUNT(*) c FROM ventes').c }
    recevoirSync(body)
    return { ok: true }
  })
  route('POST', '/api/sync/maintenant', async ({ user }) => { exiger(user, 'titulaire'); return pousser() })

  // ───────── Serveur HTTP ─────────
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }
  const entetes = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' }

  const serveur = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const envoyer = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...entetes })
      res.end(JSON.stringify(obj))
    }
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const [m, re, fn] of routes) {
          const mt = m === req.method && re.exec(url.pathname)
          if (!mt) continue
          let body = {}
          if (req.method === 'POST') {
            const morceaux = []
            let taille = 0
            for await (const c of req) { taille += c.length; if (taille > 8_000_000) throw new Erreur(413, 'Requête trop volumineuse'); morceaux.push(c) }
            try { body = morceaux.length ? JSON.parse(Buffer.concat(morceaux).toString()) : {} } catch { throw new Erreur(400, 'JSON invalide') }
          }
          const rep = await fn({ req, body, q: url.searchParams, params: mt.slice(1), user: utilisateur(req) })
          return envoyer(200, rep)
        }
        throw new Erreur(404, 'Route inconnue')
      }
      let f = url.pathname === '/' ? '/index.html' : url.pathname
      const chemin = path.normalize(path.join(PUBLIC, f))
      if (!chemin.startsWith(PUBLIC) || !fs.existsSync(chemin) || fs.statSync(chemin).isDirectory()) { res.writeHead(404, entetes); return res.end('Introuvable') }
      res.writeHead(200, { 'content-type': TYPES[path.extname(chemin)] || 'application/octet-stream', 'cache-control': f === '/sw.js' ? 'no-cache' : 'no-cache', ...entetes })
      fs.createReadStream(chemin).pipe(res)
    } catch (e) {
      if (e instanceof Erreur) return envoyer(e.code, { erreur: e.message })
      console.error(e)
      envoyer(500, { erreur: 'Erreur interne' })
    }
  })
  serveur.on('listening', demarrerSync)
  serveur.on('close', () => { clearInterval(minuteurSync); minuteurSync = null; db.close() })
  return serveur
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000)
  creerServeur().listen(port, '0.0.0.0', () => console.log(`LGO ${process.env.MODE || 'local'} — http://0.0.0.0:${port}`))
}
