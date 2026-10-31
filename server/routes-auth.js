import crypto from 'node:crypto'
import { nouveauSecretTotp, totpValide } from './lib.js'
import { ROLES, SESSION_MS, permsDe, HABILITATIONS, CODES_HABILITATIONS, droitsDuRole } from './core.js'

export const reseauLocal = (req) => {
  if (req.headers['x-forwarded-for']) return false
  const a = (req.socket.remoteAddress || '').replace('::ffff:', '')
  return a === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)
}
export const ipDe = (req) => req.headers['x-forwarded-for'] || req.socket.remoteAddress

export function routesAuth(ctx) {
  const { get, all, run, route, journal, exiger, exigerLocal, Erreur, cloud, enLigne, mode, sha256, hacher, verifier, uuid, maintenant, texte, entier, param, poser } = ctx

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
  // Anti force brute par adresse : 25 échecs en 10 minutes bloquent les tentatives suivantes de cette adresse
  const echecsIp = new Map()
  const verifierIp = (req) => { const e = echecsIp.get(ipDe(req)); if (e && e.n >= 25 && Date.now() - e.t < 600000) throw new Erreur(429, 'Trop de tentatives depuis cette adresse : réessaie dans quelques minutes') }
  const noterEchecIp = (req) => { const k = ipDe(req), e = echecsIp.get(k); echecsIp.set(k, !e || Date.now() - e.t > 600000 ? { n: 1, t: Date.now() } : { n: e.n + 1, t: e.t }) }
  const publicUser = (u) => ({ id: u.id, nom: u.nom, role: u.role, role_label: ROLES[u.role]?.label, perms: permsDe(u) })

  route('GET', '/api/etat', () => ({
    installe: !!get("SELECT 1 x FROM users WHERE role='titulaire'"), mode,
    officine: get("SELECT v FROM meta WHERE k='officine'")?.v ?? null,
    derniere_sync: get("SELECT v FROM meta WHERE k='derniere_sync'")?.v ?? null,
    version: 3
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
  // Mode en ligne : tout le monde se connecte avec identifiant + mot de passe (+ code si la double sécurité est activée).
  // Autres modes : seul le titulaire, avec mot de passe + code.
  route('POST', '/api/login', ({ body, req }) => {
    verifierIp(req)
    const ident = String(body.email || '').trim().toLowerCase()
    const u = enLigne ? get('SELECT * FROM users WHERE email=? AND actif=1', ident) : get("SELECT * FROM users WHERE email=? AND role='titulaire' AND actif=1", ident)
    if (!u) { noterEchecIp(req); throw new Erreur(401, 'Identifiants incorrects') }
    verifierBlocage(u)
    const ok = verifier(String(body.mdp || ''), u.mdp_hash) && (!u.totp_secret || totpValide(u.totp_secret, body.code || ''))
    tentative(u, ok)
    if (!ok) { noterEchecIp(req); journal(u, 'connexion_refusee', null, ipDe(req)); throw new Erreur(401, 'Identifiants incorrects') }
    journal(u, 'connexion', enLigne ? 'en ligne' : cloud ? 'distance' : 'local', ipDe(req))
    return { token: ouvrirSession(u.id), user: publicUser(u) }
  })

  // Équipe : PIN, uniquement depuis le réseau de l'officine
  route('GET', '/api/equipe', ({ req }) => {
    exigerLocal()
    if (enLigne) throw new Erreur(403, 'En ligne, la connexion se fait avec identifiant et mot de passe')
    if (!reseauLocal(req)) throw new Erreur(403, 'Réseau de l\'officine requis')
    return all("SELECT id,nom,role FROM users WHERE role<>'titulaire' AND actif=1 ORDER BY nom").map((u) => ({ ...u, role_label: ROLES[u.role]?.label }))
  })
  route('POST', '/api/pin', ({ body, req }) => {
    exigerLocal()
    if (enLigne) throw new Erreur(403, 'En ligne, la connexion se fait avec identifiant et mot de passe')
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

  // ───────── Équipe : comptes, rôles et habilitations (titulaire seul) ─────────
  const formatUser = (u) => ({ id: u.id, nom: u.nom, role: u.role, role_label: ROLES[u.role]?.label, actif: u.actif, identifiant: u.email, double_securite: !!u.totp_secret, personnalise: !!u.perms, perms: permsDe(u), created_at: u.created_at })
  route('GET', '/api/utilisateurs', ({ user }) => {
    exiger(user, 'utilisateurs')
    return all('SELECT * FROM users ORDER BY actif DESC, role, nom').map(formatUser)
  })
  route('GET', '/api/habilitations', ({ user }) => {
    exiger(user, 'utilisateurs')
    return { catalogue: HABILITATIONS.map(([code, libelle, groupe]) => ({ code, libelle, groupe })), roles: Object.fromEntries(Object.keys(ROLES).filter((r) => r !== 'titulaire').map((r) => [r, { label: ROLES[r].label, droits: droitsDuRole(r) }])) }
  })
  route('POST', '/api/utilisateurs', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'utilisateurs')
    const nom = texte(body.nom, 'Nom', { requis: true, max: 60 })
    if (!ROLES[body.role] || body.role === 'titulaire') throw new Erreur(400, 'Rôle invalide')
    const pin = body.pin == null || body.pin === '' ? null : String(body.pin)
    if (pin && !/^\d{4,6}$/.test(pin)) throw new Erreur(400, 'PIN de 4 à 6 chiffres requis')
    if (!pin && !enLigne) throw new Erreur(400, 'PIN de 4 à 6 chiffres requis')
    let ident = null, mdp = null, secret = null
    if (enLigne || body.identifiant) {
      ident = texte(body.identifiant, 'Identifiant', { requis: true, max: 80 }).toLowerCase()
      if (get('SELECT 1 x FROM users WHERE email=?', ident)) throw new Erreur(409, 'Cet identifiant existe déjà')
      if (typeof body.mdp !== 'string' || body.mdp.length < 8) throw new Erreur(400, 'Mot de passe de 8 caractères minimum')
      mdp = hacher(body.mdp)
      if (body.double_securite) secret = nouveauSecretTotp()
    }
    const id = uuid()
    run('INSERT INTO users (id,nom,role,email,mdp_hash,pin_hash,totp_secret,created_at) VALUES (?,?,?,?,?,?,?,?)', id, nom, body.role, ident, mdp, pin ? hacher(pin) : null, secret, maintenant())
    journal(user, 'utilisateur_cree', `${nom} (${body.role})`, ipDe(req))
    return { id, totp_secret: secret, otpauth: secret ? `otpauth://totp/LGO:${encodeURIComponent(ident)}?secret=${secret}&issuer=LGO` : null }
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
  route('POST', '/api/utilisateurs/([^/]+)/mdp', ({ user, body, params, req }) => {
    exigerLocal(); exiger(user, 'utilisateurs')
    if (typeof body.mdp !== 'string' || body.mdp.length < 8) throw new Erreur(400, 'Mot de passe de 8 caractères minimum')
    const r = run("UPDATE users SET mdp_hash=?, echecs=0, bloque_jusqua=0 WHERE id=? AND role<>'titulaire' AND email IS NOT NULL", hacher(body.mdp), params[0])
    if (!r.changes) throw new Erreur(404, 'Cet employé n\'a pas d\'identifiant en ligne')
    run('DELETE FROM sessions WHERE user_id=?', params[0])
    journal(user, 'mdp_change', params[0], ipDe(req))
    return { ok: true }
  })
  // Habilitations : droits personnalisés pour un employé (ou retour aux droits de son rôle)
  route('POST', '/api/utilisateurs/([^/]+)/habilitations', ({ user, body, params, req }) => {
    exigerLocal(); exiger(user, 'utilisateurs')
    const u = get("SELECT * FROM users WHERE id=? AND role<>'titulaire'", params[0])
    if (!u) throw new Erreur(404, 'Utilisateur introuvable')
    if (body.role !== undefined) {
      if (!ROLES[body.role] || body.role === 'titulaire') throw new Erreur(400, 'Rôle invalide')
      run('UPDATE users SET role=? WHERE id=?', body.role, u.id)
    }
    if (body.defaut === true) run('UPDATE users SET perms=NULL WHERE id=?', u.id)
    else if (Array.isArray(body.perms)) {
      if (body.perms.some((c) => !CODES_HABILITATIONS.includes(c))) throw new Erreur(400, 'Habilitation inconnue')
      run('UPDATE users SET perms=? WHERE id=?', JSON.stringify([...new Set(body.perms)]), u.id)
    }
    journal(user, 'habilitations', `${u.nom} : ${body.defaut ? 'droits du rôle' : (body.perms ?? []).join(',')}`, ipDe(req))
    return formatUser(get('SELECT * FROM users WHERE id=?', u.id))
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
  // Chacun peut changer son propre mot de passe
  route('POST', '/api/moi/mdp', ({ user, body, req }) => {
    exiger(user)
    const u = get('SELECT * FROM users WHERE id=?', user.id)
    if (!u.mdp_hash) throw new Erreur(409, 'Ce compte n\'a pas de mot de passe (connexion par PIN)')
    if (!verifier(String(body.ancien || ''), u.mdp_hash)) throw new Erreur(401, 'Ancien mot de passe incorrect')
    if (typeof body.nouveau !== 'string' || body.nouveau.length < (u.role === 'titulaire' ? 10 : 8)) throw new Erreur(400, `Mot de passe de ${u.role === 'titulaire' ? 10 : 8} caractères minimum`)
    run('UPDATE users SET mdp_hash=? WHERE id=?', hacher(body.nouveau), u.id)
    journal(u, 'mdp_change', 'lui-même', ipDe(req))
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
