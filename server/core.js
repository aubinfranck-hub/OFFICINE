import crypto from 'node:crypto'
import { ouvrirBase, maintenant, uuid, sha256, hacher, verifier, Erreur } from './lib.js'

export const MODES_MOBILE = ['wave', 'orange', 'mtn', 'moov']
export const MODES_PAIEMENT = ['especes', 'cheque', 'carte', 'credit', ...MODES_MOBILE]
export const SESSION_MS = 12 * 3600 * 1000

// Droits par rôle. Le titulaire a tous les droits ; « utilisateurs », « parametres » et « audit » lui sont réservés.
export const ROLES = {
  titulaire: { label: 'Titulaire', perms: '*' },
  pharmacien: { label: 'Pharmacien adjoint', perms: ['vente', 'remise', 'annuler', 'stupefiant', 'produits', 'stock', 'achats', 'caisse', 'clients', 'stats', 'marges', 'tierspayant', 'inventaire', 'confirmer'] },
  preparateur: { label: 'Préparateur', perms: ['vente', 'remise', 'stupefiant', 'stock', 'achats', 'caisse', 'clients', 'inventaire'] },
  vendeur: { label: 'Vendeur(se)', perms: ['vente', 'caisse', 'clients'] }
}
export const peut = (u, p) => !!u && (ROLES[u.role]?.perms === '*' || ROLES[u.role]?.perms?.includes(p))
export const permsDe = (u) => (ROLES[u.role].perms === '*' ? ['*'] : ROLES[u.role].perms)

export function creerContexte({ fichier, mode, cleSync }) {
  const db = ouvrirBase(fichier)
  const cloud = mode === 'cloud'
  const routes = []
  const get = (sql, ...p) => db.prepare(sql).get(...p)
  const all = (sql, ...p) => db.prepare(sql).all(...p)
  const run = (sql, ...p) => db.prepare(sql).run(...p)
  let profondeur = 0
  const tx = (fn) => {
    if (profondeur > 0) return fn()
    db.exec('BEGIN IMMEDIATE')
    profondeur++
    try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e } finally { profondeur-- }
  }
  const journal = (u, action, detail, ip) =>
    run('INSERT INTO audit (user_id,user_nom,action,detail,ip,created_at) VALUES (?,?,?,?,?,?)', u?.id ?? null, u?.nom ?? null, action, detail ?? null, ip ?? null, maintenant())

  const exiger = (u, perm) => {
    if (!u) throw new Erreur(401, 'Connexion requise')
    if (perm && !peut(u, perm)) throw new Erreur(403, 'Accès refusé')
    return u
  }
  const exigerLocal = () => { if (cloud) throw new Erreur(403, 'Action disponible uniquement sur le serveur de l\'officine') }

  const jour = (q, nom = 'date') => (/^\d{4}-\d{2}-\d{2}$/.test(q.get(nom) || '') ? q.get(nom) : maintenant().slice(0, 10))
  const entier = (v, nom, { min = 0, max = 1e9 } = {}) => {
    const n = Number(v)
    if (!Number.isInteger(n) || n < min || n > max) throw new Erreur(400, `${nom} invalide`)
    return n
  }
  const texte = (v, nom, { requis = false, max = 200 } = {}) => {
    const s = v == null ? '' : String(v).trim()
    if (requis && !s) throw new Erreur(400, `${nom} requis`)
    if (s.length > max) throw new Erreur(400, `${nom} trop long`)
    return s || null
  }
  const param = (cle) => { try { return JSON.parse(get('SELECT v FROM meta WHERE k=?', cle)?.v ?? 'null') } catch { return null } }
  const poser = (cle, val) => run('INSERT OR REPLACE INTO meta (k,v) VALUES (?,?)', cle, JSON.stringify(val))

  const ctx = {
    db, fichier, get, all, run, tx, journal, exiger, exigerLocal, jour, entier, texte, param, poser,
    mode, cloud, cleSync, routes, uuid, maintenant, sha256, hacher, verifier, Erreur, peut,
    route: (m, re, fn) => routes.push([m, new RegExp(`^${re}$`), fn])
  }
  return ctx
}
