import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { creerContexte } from './core.js'
import { maintenant, uuid, hacher, Erreur } from './lib.js'
import { routesAuth } from './routes-auth.js'
import { routesComptoir } from './routes-comptoir.js'
import { routesStock } from './routes-stock.js'
import { routesAchats } from './routes-achats.js'
import { routesPilotage } from './routes-pilotage.js'
import { sync } from './sync.js'
import { routesOutils } from './routes-outils.js'
import { routesConseil, semerConseils } from './routes-conseil.js'
import { semer } from './seed.js'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(ICI, '..', 'public')
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json'
}
const ENTETES = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' }

// MODE=local : serveur de l'officine (hors ligne, comptoir). MODE=cloud : copie en lecture pour le titulaire à distance.
export function creerServeur({ fichier = process.env.DB || 'lgo.db', mode = process.env.MODE || 'local', cleSync = process.env.SYNC_KEY || '' } = {}) {
  const ctx = creerContexte({ fichier, mode, cleSync })
  const { db, get, run, routes } = ctx

  // Cloud : le compte du titulaire est créé à partir des variables d'environnement (il survit à un redéploiement)
  if ((mode === 'cloud' || mode === 'online') && process.env.INIT_EMAIL && process.env.INIT_MDP && process.env.INIT_TOTP && !get("SELECT 1 x FROM users WHERE role='titulaire'")) {
    run('INSERT INTO users (id,nom,role,email,mdp_hash,totp_secret,created_at) VALUES (?,?,?,?,?,?,?)', uuid(), process.env.INIT_NOM || 'Titulaire', 'titulaire', process.env.INIT_EMAIL.toLowerCase(), hacher(process.env.INIT_MDP), process.env.INIT_TOTP, maintenant())
    run("INSERT OR REPLACE INTO meta (k,v) VALUES ('officine',?)", process.env.INIT_OFFICINE || 'Officine')
  }

  // Démonstration publique : jeu de données fictif créé au démarrage (DEMO=1, mode en ligne uniquement)
  if (mode === 'online' && process.env.DEMO === '1' && !get("SELECT 1 x FROM users WHERE role='titulaire'")) semer(db, { enLigne: true, secretTotp: process.env.INIT_TOTP || undefined })

  // Démonstration déjà installée avant l'arrivée du conseil : on ajoute les fiches de démo une seule fois
  if (mode === 'online' && process.env.DEMO === '1' && !get('SELECT 1 x FROM conseils LIMIT 1')) semerConseils(db)

  const { utilisateurDe } = routesAuth(ctx)
  routesComptoir(ctx)
  routesStock(ctx)
  routesAchats(ctx)
  routesPilotage(ctx)
  routesConseil(ctx)
  const outils = routesOutils(ctx)
  const synchro = sync(ctx)

  const serveur = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const envoyer = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...ENTETES })
      res.end(JSON.stringify(obj))
    }
    try {
      if (url.pathname === '/api/sante') return envoyer(200, { ok: true })
      if (url.pathname.startsWith('/api/')) {
        for (const [m, re, fn] of routes) {
          const mt = m === req.method && re.exec(url.pathname)
          if (!mt) continue
          let body = {}
          if (req.method === 'POST') {
            const morceaux = []
            let taille = 0
            for await (const c of req) { taille += c.length; if (taille > 12_000_000) throw new Erreur(413, 'Requête trop volumineuse'); morceaux.push(c) }
            try { body = morceaux.length ? JSON.parse(Buffer.concat(morceaux).toString()) : {} } catch { throw new Erreur(400, 'JSON invalide') }
          }
          const rep = await fn({ req, body, q: url.searchParams, params: mt.slice(1), user: utilisateurDe(req) })
          if (rep && rep.__fichier) {
            res.writeHead(200, { 'content-type': rep.type, 'content-disposition': `attachment; filename="${rep.nom}"`, 'cache-control': 'no-store', ...ENTETES })
            return res.end(rep.contenu)
          }
          return envoyer(200, rep)
        }
        throw new Erreur(404, 'Route inconnue')
      }
      const f = url.pathname === '/' ? '/index.html' : url.pathname
      const chemin = path.normalize(path.join(PUBLIC, f))
      if (!chemin.startsWith(PUBLIC) || !fs.existsSync(chemin) || fs.statSync(chemin).isDirectory()) { res.writeHead(404, ENTETES); return res.end('Introuvable') }
      res.writeHead(200, { 'content-type': TYPES[path.extname(chemin)] || 'application/octet-stream', 'cache-control': 'no-cache', ...ENTETES })
      fs.createReadStream(chemin).pipe(res)
    } catch (e) {
      if (e instanceof Erreur) return envoyer(e.code, { erreur: e.message })
      console.error(e)
      envoyer(500, { erreur: 'Erreur interne' })
    }
  })
  serveur.on('listening', () => { synchro.demarrer(); outils.demarrer() })
  serveur.on('close', () => { synchro.arreter(); outils.arreter(); db.close() })
  serveur.pousser = synchro.pousser
  return serveur
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000)
  creerServeur().listen(port, '0.0.0.0', () => console.log(`LGO ${process.env.MODE || 'local'} — http://0.0.0.0:${port}`))
}
