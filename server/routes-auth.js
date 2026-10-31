import crypto from 'node:crypto'
import { nouveauSecretTotp, totpValide } from './lib.js'
import { ROLES, SESSION_MS, permsDe } from './core.js'

export const reseauLocal = (req) => {
  if (req.headers['x-forwarded-for']) return false
  const a = (req.socket.remoteAddress || '').replace('::ffff:', '')
  return a === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)
}
export const ipDe = (req) => req.headers['x-forwarded-for'] || req.socket.remoteAddress

export function routesAuth(ctx) {
  const { get, all, run, route, journal, exiger, exigerLocal, Erreur, cloud, mode, sha256, hacher, verifier, uuid, maintenant, texte, entier, param, poser } = ctx

  const ouvrirSession = (userId) => {
    const token = crypto.randomBytes(32).toString('base64url')
    run('INSERT INTO sessions (token_hash,user_id,expire) VALUES (?,?,?)', sha256(token), userId, Date.now() + SESSION_MS)
    run('DELETE FROM sessions WHERE expire < ?', Date.now())
    return token
  }
  const utilisateurDe = (req) => {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '')
    if (!t) return null
    return get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expire>? AND u.actif=1', sha256(t), Date.now()) || null
  }
  const tentative = (u, ok) => {
    if (ok) { run('UPDATE users SET echecs=0, bloque_jusqua=0 WHERE id=?', u.id); return }
    const n = u.echecs + 1
    run('UPDATE users SET echecs=?, bloque_jusqua=? WHERE id=?', n >= 5 ? 0 : n, n >= 5 ? Date.now() + 5 * 60000 : 0, u.id)
  }
  const verifierBlocage = (u) => { if (u.bloque_jusqua > Date.now()) throw new Erreur(429, 'Compte bloqué 5 minutes après trop d\'essais') }
  const publicUser = (u) => ({ id: u.id, nom: u.nom, role: u.role, role_label: ROLES[u.role]?.label, perms: permsDe(u) })

  route('GET', '/api/etat', () => ({
    installe: !!get("SELECT 1 x FROM users WHERE role='titulaire'"), mode,
    officine: get("SELECT v FROM meta WHERE k='officine'")?.v ?? null,
    derniere_sync: get("SELECT v FROM meta WHERE k='derniere_sync'")?.v ?? null,
    version: 2
  }))

  route('POST', '/api/installation', ({ body, req }) => {
    if (get("SELECT 1 x FROM users WHERE role='titulaire'")) throw new Erreur(409, 'Déjà installé')
    const officine = texte(body.officine, 'Nom de l\'officine', { requis: true })
    const nom = texte(body.nom, 'Nom', { requis: true })
    const email = texte(body.email, 'Email', { requis: true }).toLowerCase()
    if (typeof body.mdp !== 'string' || body.mdp.length < 10) throw new Erreur(400, 'Mot de passe de 10 caractères minimum')
    const secret = nouveauSecretTotp()
    const id = uuid()
    run('INSERT INTO users (id,nom,role,email,mdp_hash,totp_secret,created_at) VALUES (?,?,?,?,?,?,?)', id, nom, 'titulaire', email, hacher(body.mdp), secret, maintenant())
    run("INSERT OR REPLACE INTO meta (k,v) VALUES ('officine',?)", officine)
    journal({ id, nom }, 'installation', officine, ipDe(req))
    return { totp_secret: secret, otpauth: `otpauth://totp/LGO:${encodeURIComponent(email)}?secret=${secret}&issuer=LGO` }
  })

  // Titulaire : mot de passe + code de l'application d'authentification (jamais de SMS)
  route('POST', '/api/login', ({ body, req }) => {
    const u = get("SELECT * FROM users WHERE email=? AND role='titulaire' AND actif=1", String(body.email || '').trim().toLowerCase())
    if (!u) throw new Erreur(401, 'Identifiants incorrects')
    verifierBlocage(u)
    const ok = verifier(String(body.mdp || ''), u.mdp_hash) && totpValide(u.totp_secret, body.code || '')
    tentative(u, ok)
    if (!ok) { journal(u, 'connexion_refusee', null, ipDe(req)); throw new Erreur(401, 'Identifiants incorrects') }
    journal(u, 'connexion', cloud ? 'distance' : 'local', ipDe(req))
    return { token: ouvrirSession(u.id), user: publicUser(u) }
  })

  // Équipe : PIN, uniquement depuis le réseau de l'officine
  route('GET', '/api/equipe', ({ req }) => {
    exigerLocal()
    if (!reseauLocal(req)) throw new Erreur(403, 'Réseau de l\'officine requis')
    return all("SELECT id,nom,role FROM users WHERE role<>'titulaire' AND actif=1 ORDER BY nom").map((u) => ({ ...u, role_label: ROLES[u.role]?.label }))
  })
  route('POST', '/api/pin', ({ body, req }) => {
    exigerLocal()
    if (!reseauLocal(req)) throw new Erreur(403, 'Connexion par PIN réservée au réseau de l\'officine')
    const u = get("SELECT * FROM users WHERE id=? AND role<>'titulaire' AND actif=1", String(body.user_id || ''))
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

  // Équipe : gestion (titulaire seul)
  route('GET', '/api/utilisateurs', ({ user }) => {
    exiger(user, 'utilisateurs')
    return all('SELECT id,nom,role,actif,created_at FROM users ORDER BY actif DESC, role, nom').map((u) => ({ ...u, role_label: ROLES[u.role]?.label }))
  })
  route('POST', '/api/utilisateurs', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'utilisateurs')
    const nom = texte(body.nom, 'Nom', { requis: true, max: 60 })
    if (!ROLES[body.role] || body.role === 'titulaire') throw new Erreur(400, 'Rôle invalide')
    if (!/^\d{4,6}$/.test(String(body.pin))) throw new Erreur(400, 'PIN de 4 à 6 chiffres requis')
    const id = uuid()
    run('INSERT INTO users (id,nom,role,pin_hash,created_at) VALUES (?,?,?,?,?)', id, nom, body.role, hacher(String(body.pin)), maintenant())
    journal(user, 'utilisateur_cree', `${nom} (${body.role})`, ipDe(req))
    return { id }
  })
  route('POST', '/api/utilisateurs/([^/]+)/pin', ({ user, body, params, req }) => {
    exigerLocal(); exiger(user, 'utilisateurs')
    if (!/^\d{4,6}$/.test(String(body.pin))) throw new Erreur(400, 'PIN de 4 à 6 chiffres requis')
    const r = run("UPDATE users SET pin_hash=?, echecs=0, bloque_jusqua=0 WHERE id=? AND role<>'titulaire'", hacher(String(body.pin)), params[0])
    if (!r.changes) throw new Erreur(404, 'Utilisateur introuvable')
    run('DELETE FROM sessions WHERE user_id=?', params[0])
    journal(user, 'pin_change', params[0], ipDe(req))
    return { ok: true }
  })
  route('POST', '/api/utilisateurs/([^/]+)/desactiver', ({ user, params, req }) => {
    exigerLocal(); exiger(user, 'utilisateurs')
    run("UPDATE users SET actif=0 WHERE id=? AND role<>'titulaire'", params[0])
    run('DELETE FROM sessions WHERE user_id=?', params[0])
    journal(user, 'utilisateur_desactive', params[0], ipDe(req))
    return { ok: true }
  })
  route('POST', '/api/utilisateurs/([^/]+)/reactiver', ({ user, params, req }) => {
    exigerLocal(); exiger(user, 'utilisateurs')
    run("UPDATE users SET actif=1 WHERE id=? AND role<>'titulaire'", params[0])
    journal(user, 'utilisateur_reactive', params[0], ipDe(req))
    return { ok: true }
  })

  // Paramètres de l'officine (nom, adresse, ticket…)
  route('GET', '/api/parametres', ({ user }) => {
    exiger(user)
    return { officine: get("SELECT v FROM meta WHERE k='officine'")?.v ?? '', adresse: '', telephone: '', message_ticket: 'Merci de votre confiance. Prompt rétablissement !', ...(param('parametres') || {}) }
  })
  route('POST', '/api/parametres', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'parametres')
    const p = {
      adresse: texte(body.adresse, 'Adresse', { max: 160 }) || '', telephone: texte(body.telephone, 'Téléphone', { max: 40 }) || '',
      message_ticket: texte(body.message_ticket, 'Message du ticket', { max: 200 }) || ''
    }
    poser('parametres', p)
    if (body.officine) run("INSERT OR REPLACE INTO meta (k,v) VALUES ('officine',?)", texte(body.officine, 'Nom de l\'officine', { requis: true, max: 80 }))
    journal(user, 'parametres', null, ipDe(req))
    return { ok: true }
  })
  route('GET', '/api/audit', ({ user }) => { exiger(user, 'audit'); return all('SELECT * FROM audit ORDER BY id DESC LIMIT 300') })

  return { utilisateurDe }
}
