import fs from 'node:fs'
import path from 'node:path'
import { peut } from './core.js'

// Exports CSV lisibles par Excel (séparateur « ; », UTF-8 avec BOM) et sauvegardes de la base.
const cellule = (v) => {
  if (v == null) return ''
  const s = String(v)
  return /[;"\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
export const csv = (colonnes, lignes) =>
  '﻿' + [colonnes.map((c) => c[0]).join(';'), ...lignes.map((l) => colonnes.map((c) => cellule(typeof c[1] === 'function' ? c[1](l) : l[c[1]])).join(';'))].join('\r\n') + '\r\n'

export function routesOutils(ctx) {
  const { all, db, fichier, route, exiger, exigerLocal, journal, jour, maintenant, cloud } = ctx
  const fichierCsv = (nom, contenu) => ({ __fichier: true, type: 'text/csv; charset=utf-8', nom, contenu })
  const oui = (v) => (v ? 'oui' : 'non')

  route('GET', '/api/export/ventes', ({ user, q }) => {
    exiger(user, 'stats')
    const marges = peut(user, 'marges')
    const du = jour(q, 'du'), au = jour(q, 'au')
    const lignes = all(`SELECT v.created_at, v.numero, v.type, v.statut, v.user_nom, v.client_nom, v.organisme, v.num_adherent, v.remise, v.part_organisme, v.total vente_total,
        l.nom produit, l.qte, l.prix, l.pa, (SELECT group_concat(p.mode || ' ' || p.montant, ' + ') FROM paiements p WHERE p.vente_id=v.id) paiements
      FROM lignes_vente l JOIN ventes v ON v.id=l.vente_id WHERE substr(v.created_at,1,10) BETWEEN ? AND ? ORDER BY v.created_at, v.numero`, du, au)
    const cols = [['Date', (l) => l.created_at.slice(0, 10)], ['Heure', (l) => l.created_at.slice(11, 16)], ['N°', 'numero'], ['Type', 'type'], ['Statut', 'statut'], ['Vendeur', 'user_nom'], ['Client', 'client_nom'],
      ['Produit', 'produit'], ['Quantité', 'qte'], ['Prix unitaire', 'prix'], ['Total ligne', (l) => l.qte * l.prix], ['Remise de la vente', 'remise'], ['Organisme', 'organisme'], ['N° adhérent', 'num_adherent'], ['Part organisme (vente)', 'part_organisme'], ['Paiements', 'paiements']]
    if (marges) cols.push(['Prix d\'achat', 'pa'], ['Marge ligne', (l) => l.qte * (l.prix - l.pa)])
    return fichierCsv(`ventes-${du}-${au}.csv`, csv(cols, lignes))
  })
  route('GET', '/api/export/stock', ({ user }) => {
    exiger(user, 'stock')
    const marges = peut(user, 'marges')
    const lignes = all(`SELECT p.nom, p.code, p.famille, p.emplacement, p.prix, p.prix_achat pa_produit, l.numero lot, l.peremption, l.qte, l.prix_achat pa_lot
      FROM lots l JOIN produits p ON p.id=l.produit_id WHERE l.qte>0 ORDER BY p.nom, l.peremption`)
    const cols = [['Produit', 'nom'], ['Code', 'code'], ['Famille', 'famille'], ['Emplacement', 'emplacement'], ['Lot', 'lot'], ['Péremption', 'peremption'], ['Quantité', 'qte'], ['Prix de vente', 'prix'], ['Valeur au prix de vente', (l) => l.qte * l.prix]]
    if (marges) cols.push(['Prix d\'achat', (l) => l.pa_lot || l.pa_produit], ['Valeur au prix d\'achat', (l) => l.qte * (l.pa_lot || l.pa_produit)])
    return fichierCsv(`stock-${maintenant().slice(0, 10)}.csv`, csv(cols, lignes))
  })
  // Même colonnes que l'import : on peut exporter, corriger dans Excel, puis réimporter
  route('GET', '/api/export/produits', ({ user }) => {
    exiger(user, 'produits')
    const lignes = all('SELECT * FROM produits WHERE actif=1 ORDER BY nom')
    const cols = [['code', 'code'], ['nom', 'nom'], ['dci', 'dci'], ['dosage', 'dosage'], ['forme', 'forme'], ['famille', 'famille'], ['labo', 'labo'], ['prix', 'prix'], ['prix_achat', 'prix_achat'], ['seuil', 'seuil'], ['stock_max', 'stock_max'],
      ['emplacement', 'emplacement'], ['ordonnance', (l) => oui(l.ordonnance)], ['stupefiant', (l) => oui(l.stupefiant)], ['generique', (l) => oui(l.generique)], ['remboursable', (l) => oui(l.remboursable)]]
    return fichierCsv(`catalogue-${maintenant().slice(0, 10)}.csv`, csv(cols, lignes))
  })

  // ───────── Sauvegardes de la base ─────────
  const dossier = fichier && fichier !== ':memory:' ? path.join(path.dirname(path.resolve(fichier)), 'sauvegardes') : null
  const GARDER = 14
  function sauvegarder(suffixe = '') {
    if (!dossier || cloud) return null
    fs.mkdirSync(dossier, { recursive: true })
    const nom = `lgo-${maintenant().slice(0, 10)}${suffixe}.db`
    const cible = path.join(dossier, nom)
    if (fs.existsSync(cible)) return null
    db.exec(`VACUUM INTO '${cible.replaceAll("'", "''")}'`)
    const vieux = fs.readdirSync(dossier).filter((f) => /^lgo-.*\.db$/.test(f)).sort().reverse().slice(GARDER)
    for (const f of vieux) fs.rmSync(path.join(dossier, f), { force: true })
    return nom
  }
  const liste = () => (dossier && fs.existsSync(dossier) ? fs.readdirSync(dossier).filter((f) => /^lgo-.*\.db$/.test(f)).sort().reverse().map((f) => ({ nom: f, taille: fs.statSync(path.join(dossier, f)).size, date: fs.statSync(path.join(dossier, f)).mtime.toISOString() })) : [])
  route('GET', '/api/sauvegardes', ({ user }) => { exiger(user, 'parametres'); return { dossier, gardees: GARDER, fichiers: liste() } })
  // Télécharger une sauvegarde (pour la garder ailleurs que sur le serveur)
  route('GET', '/api/sauvegardes/telecharger', ({ user, q }) => {
    exiger(user, 'parametres')
    const nom = q.get('nom') || ''
    if (!dossier || !/^lgo-[\w-]+\.db$/.test(nom) || !fs.existsSync(path.join(dossier, nom))) throw new ctx.Erreur(404, 'Sauvegarde introuvable')
    journal(user, 'sauvegarde_telechargee', nom)
    return { __fichier: true, type: 'application/octet-stream', nom, contenu: fs.readFileSync(path.join(dossier, nom)) }
  })
  route('POST', '/api/sauvegardes/maintenant', ({ user }) => {
    exigerLocal(); exiger(user, 'parametres')
    const nom = sauvegarder(`-${maintenant().slice(11, 16).replace(':', 'h')}`)
    journal(user, 'sauvegarde', nom)
    return { nom }
  })
  let minuteur = null
  return {
    sauvegarder,
    demarrer() {
      if (minuteur || !dossier || cloud) return
      setTimeout(() => { try { sauvegarder() } catch (e) { console.error('Sauvegarde impossible :', e.message) } }, 8000).unref()
      minuteur = setInterval(() => { try { sauvegarder() } catch (e) { console.error('Sauvegarde impossible :', e.message) } }, 3600 * 1000)
      minuteur.unref()
    },
    arreter() { clearInterval(minuteur); minuteur = null }
  }
}
