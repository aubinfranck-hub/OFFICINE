import crypto from 'node:crypto'

// Tables envoyées au cloud. « cur » = colonne qui sert de curseur (horodatage « maj » ou numéro croissant).
// Aucun secret n'est envoyé : ni mots de passe, ni PIN, ni clé d'authentification, ni utilisateurs.
export const SYNC = [
  { t: 'produits', cur: 'maj' }, { t: 'lots', cur: 'maj' }, { t: 'organismes', cur: 'maj' }, { t: 'clients', cur: 'maj' },
  { t: 'fournisseurs', cur: 'maj' }, { t: 'bordereaux', cur: 'maj' },
  { t: 'commandes', cur: 'maj', enfants: [['lignes_commande', 'commande_id']] },
  { t: 'receptions', cur: 'maj', enfants: [['lignes_reception', 'reception_id'], ['paiements_fournisseur', 'reception_id']] },
  { t: 'ventes', cur: 'maj', enfants: [['lignes_vente', 'vente_id'], ['paiements', 'vente_id']] },
  { t: 'caisse_sessions', cur: 'maj', enfants: [['mouvements_caisse', 'session_id']] },
  { t: 'reglements_client', cur: 'id' }, { t: 'registre_stupefiants', cur: 'id' }, { t: 'audit', cur: 'id' }
]
const LOT = 400

export function sync(ctx) {
  const { get, all, run, tx, route, exiger, Erreur, cloud, cleSync, sha256, maintenant } = ctx

  const colonnes = (t) => all(`PRAGMA table_info(${t})`).map((c) => c.name)
  const curseur = (t) => get('SELECT v FROM meta WHERE k=?', `sync_${t}`)?.v ?? ''
  const poserCurseur = (t, v) => run('INSERT OR REPLACE INTO meta (k,v) VALUES (?,?)', `sync_${t}`, String(v))
  const comparable = (cur, v) => (cur === 'id' ? Number(v) || 0 : String(v ?? ''))

  // ───────── Côté cloud : réception ─────────
  function recevoir(tables) {
    tx(() => {
      for (const def of SYNC) {
        const bloc = tables?.[def.t]
        if (!bloc) continue
        const cols = colonnes(def.t)
        const ecrire = (nom, ccols, ligne) => {
          const k = Object.keys(ligne).filter((c) => ccols.includes(c))
          run(`INSERT OR REPLACE INTO ${nom} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, ...k.map((c) => ligne[c]))
        }
        for (const ligne of bloc.rows ?? []) ecrire(def.t, cols, ligne)
        for (const [enfant, fk] of def.enfants ?? []) {
          const ecols = colonnes(enfant)
          for (const ligne of bloc.rows ?? []) run(`DELETE FROM ${enfant} WHERE ${fk}=?`, ligne.id)
          for (const ligne of bloc.enfants?.[enfant] ?? []) ecrire(enfant, ecols, ligne)
        }
      }
      run("INSERT OR REPLACE INTO meta (k,v) VALUES ('derniere_sync',?)", maintenant())
    })
  }
  route('POST', '/api/sync', ({ req, body }) => {
    if (!cloud) throw new Erreur(404, 'Introuvable')
    const t = (req.headers.authorization || '').replace(/^Bearer /, '')
    const a = Buffer.from(sha256(t)), b = Buffer.from(sha256(cleSync))
    if (!cleSync || !crypto.timingSafeEqual(a, b)) throw new Erreur(401, 'Clé de synchronisation invalide')
    if (body.sonde) return { ok: true, max: Object.fromEntries(SYNC.map((d) => [d.t, get(`SELECT MAX(${d.cur}) m FROM ${d.t}`).m ?? null])) }
    recevoir(body.tables)
    return { ok: true }
  })

  // ───────── Côté officine : envoi des changements ─────────
  function lireLot(def) {
    const cur = curseur(def.t)
    const dep = def.cur === 'id' ? Number(cur) || 0 : cur
    let rows = all(`SELECT * FROM ${def.t} WHERE ${def.cur} > ? ORDER BY ${def.cur} LIMIT ${LOT}`, dep)
    if (def.cur === 'maj' && rows.length === LOT) {
      const dernier = rows[rows.length - 1].maj
      const memes = all(`SELECT * FROM ${def.t} WHERE maj = ?`, dernier)
      const ids = new Set(rows.map((r) => r.id))
      rows = rows.concat(memes.filter((r) => !ids.has(r.id)))
    }
    if (!rows.length) return null
    const enfants = {}
    for (const [enfant, fk] of def.enfants ?? []) {
      enfants[enfant] = []
      for (let i = 0; i < rows.length; i += 200) {
        const ids = rows.slice(i, i + 200).map((r) => r.id)
        enfants[enfant].push(...all(`SELECT * FROM ${enfant} WHERE ${fk} IN (${ids.map(() => '?').join(',')})`, ...ids))
      }
    }
    return { rows, enfants, dernier: rows[rows.length - 1][def.cur], plein: rows.length >= LOT }
  }

  async function pousser() {
    const url = process.env.CLOUD_URL
    if (!url || cloud) return { ok: false, raison: 'non configuré' }
    const cible = url.replace(/\/$/, '') + '/api/sync'
    const entetes = { 'content-type': 'application/json', authorization: `Bearer ${process.env.SYNC_KEY}` }
    const appeler = async (corps) => {
      const r = await fetch(cible, { method: 'POST', headers: entetes, body: JSON.stringify(corps), signal: AbortSignal.timeout(90000) })
      if (!r.ok) throw new Error(`Synchronisation refusée (${r.status})`)
      return r.json()
    }
    // Si le cloud a perdu ses données (hébergement gratuit à disque temporaire), on renvoie tout.
    const { max } = await appeler({ sonde: true })
    for (const def of SYNC) {
      const loc = curseur(def.t)
      if (loc !== '' && loc !== '0' && (max[def.t] == null || comparable(def.cur, max[def.t]) < comparable(def.cur, loc))) poserCurseur(def.t, def.cur === 'id' ? 0 : '')
    }
    let envoyes = 0
    for (let tour = 0; tour < 60; tour++) {
      const tables = {}, avancer = []
      let rien = true
      for (const def of SYNC) {
        const lot = lireLot(def)
        if (!lot) continue
        rien = false
        tables[def.t] = { rows: lot.rows, enfants: lot.enfants }
        avancer.push([def.t, lot.dernier])
        envoyes += lot.rows.length
      }
      if (rien) break
      await appeler({ tables })
      for (const [t, v] of avancer) poserCurseur(t, v)
    }
    run("INSERT OR REPLACE INTO meta (k,v) VALUES ('derniere_sync',?)", maintenant())
    return { ok: true, lignes: envoyes }
  }
  route('POST', '/api/sync/maintenant', async ({ user }) => { exiger(user, 'parametres'); return pousser() })

  let minuteur = null, enCours = false
  return {
    demarrer() {
      if (!process.env.CLOUD_URL || cloud || minuteur) return
      minuteur = setInterval(() => { if (enCours) return; enCours = true; pousser().catch(() => {}).finally(() => { enCours = false }) }, 15000)
      minuteur.unref()
    },
    arreter() { clearInterval(minuteur); minuteur = null },
    pousser
  }
}
