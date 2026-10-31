import { peut } from './core.js'
import { ipDe } from './routes-auth.js'

export function routesPilotage(ctx) {
  const { get, all, run, tx, route, journal, exiger, exigerLocal, Erreur, uuid, maintenant, jour } = ctx

  // ───────── Organismes (assurances, mutuelles, bons de santé) : configurés par le pharmacien ─────────
  route('GET', '/api/organismes', ({ user }) => { exiger(user, 'vente'); return all('SELECT id,nom,taux,actif FROM organismes ORDER BY actif DESC, nom') })
  route('POST', '/api/organismes', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'tierspayant')
    const nom = ctx.texte(body.nom, 'Nom', { requis: true, max: 80 })
    const taux = ctx.entier(body.taux, 'Taux de prise en charge', { max: 100 })
    const actif = body.actif === 0 || body.actif === false ? 0 : 1
    if (body.id) {
      if (!run('UPDATE organismes SET nom=?,taux=?,actif=? WHERE id=?', nom, taux, actif, String(body.id)).changes) throw new Erreur(404, 'Organisme introuvable')
      return { id: body.id }
    }
    const id = uuid()
    run('INSERT INTO organismes (id,nom,taux,actif) VALUES (?,?,?,?)', id, nom, taux, actif)
    journal(user, 'organisme', `${nom} ${taux}%`, ipDe(req))
    return { id }
  })

  // ───────── Tiers payant : bordereaux de facturation par organisme ─────────
  route('GET', '/api/tiers-payant', ({ user }) => {
    exiger(user, 'tierspayant')
    return {
      a_facturer: all(`SELECT o.id organisme_id, o.nom, o.taux, COUNT(v.id) nb_ventes, COALESCE(SUM(v.part_organisme),0) montant, MIN(substr(v.created_at,1,10)) depuis
        FROM organismes o JOIN ventes v ON v.organisme_id=o.id AND v.statut='valide' AND v.bordereau_id IS NULL GROUP BY o.id HAVING nb_ventes>0 ORDER BY montant DESC`),
      impayes: all("SELECT * FROM bordereaux WHERE statut='emis' ORDER BY created_at"),
      encaisse_30j: get("SELECT COALESCE(SUM(total),0) m FROM bordereaux WHERE statut='paye' AND paye_le>=date('now','-30 day')").m
    }
  })
  route('GET', '/api/tiers-payant/ventes', ({ user, q }) => {
    exiger(user, 'tierspayant')
    return all(`SELECT numero,created_at,client_nom,num_adherent,num_ordonnance,total,remise,part_organisme,type FROM ventes
      WHERE statut='valide' AND organisme_id=? AND bordereau_id IS NULL AND substr(created_at,1,10) BETWEEN ? AND ? ORDER BY created_at`, q.get('organisme_id') ?? '', jour(q, 'du'), jour(q, 'au'))
  })
  route('POST', '/api/bordereaux', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'tierspayant')
    return tx(() => {
      const o = get('SELECT * FROM organismes WHERE id=?', String(body.organisme_id ?? ''))
      if (!o) throw new Erreur(400, 'Organisme requis')
      const du = /^\d{4}-\d{2}-\d{2}$/.test(body.du || '') ? body.du : '2000-01-01'
      const au = /^\d{4}-\d{2}-\d{2}$/.test(body.au || '') ? body.au : maintenant().slice(0, 10)
      const vs = all("SELECT id,part_organisme FROM ventes WHERE statut='valide' AND organisme_id=? AND bordereau_id IS NULL AND substr(created_at,1,10) BETWEEN ? AND ?", o.id, du, au)
      if (!vs.length) throw new Erreur(409, 'Aucune vente à facturer sur cette période')
      const id = uuid()
      const total = vs.reduce((s, v) => s + v.part_organisme, 0)
      const n = get('SELECT COUNT(*) c FROM bordereaux').c + 1
      const numero = `BRD-${maintenant().slice(0, 4)}-${String(n).padStart(4, '0')}`
      run('INSERT INTO bordereaux (id,numero,organisme_id,organisme_nom,du,au,nb_ventes,total,created_at) VALUES (?,?,?,?,?,?,?,?,?)', id, numero, o.id, o.nom, du, au, vs.length, total, maintenant())
      for (const v of vs) run('UPDATE ventes SET bordereau_id=? WHERE id=?', id, v.id)
      journal(user, 'bordereau', `${numero} ${o.nom} ${total}F`, ipDe(req))
      return { id, numero, total, nb_ventes: vs.length }
    })
  })
  route('GET', '/api/bordereaux', ({ user }) => { exiger(user, 'tierspayant'); return all('SELECT * FROM bordereaux ORDER BY created_at DESC LIMIT 100') })
  route('GET', '/api/bordereaux/([^/]+)', ({ user, params }) => {
    exiger(user, 'tierspayant')
    const b = get('SELECT * FROM bordereaux WHERE id=?', params[0])
    if (!b) throw new Erreur(404, 'Bordereau introuvable')
    b.ventes = all('SELECT numero,created_at,client_nom,num_adherent,num_ordonnance,total,remise,part_organisme,type FROM ventes WHERE bordereau_id=? ORDER BY created_at', b.id)
    return b
  })
  route('POST', '/api/bordereaux/([^/]+)/payer', ({ user, params, req }) => {
    exigerLocal(); exiger(user, 'tierspayant')
    const r = run("UPDATE bordereaux SET statut='paye', paye_le=? WHERE id=? AND statut='emis'", maintenant(), params[0])
    if (!r.changes) throw new Erreur(409, 'Bordereau déjà réglé ou introuvable')
    journal(user, 'bordereau_paye', params[0], ipDe(req))
    return { ok: true }
  })

  // ───────── Statistiques et tableau de bord ─────────
  route('GET', '/api/stats', ({ user, q }) => {
    exiger(user, 'stats')
    const marges = peut(user, 'marges')
    const du = jour(q, 'du'), au = jour(q, 'au')
    const V = "v.statut='valide' AND substr(v.created_at,1,10) BETWEEN ? AND ?"
    const t = get(`SELECT COALESCE(SUM(v.total-v.remise),0) ca, COUNT(CASE WHEN v.type='vente' THEN 1 END) nb,
      COALESCE(SUM(CASE WHEN v.type='vente' THEN v.remise ELSE 0 END),0) remises, COALESCE(SUM(v.part_organisme),0) part_organismes,
      COALESCE(SUM(v.credit),0) credits, COUNT(CASE WHEN v.hors_ligne=1 THEN 1 END) hors_ligne FROM ventes v WHERE ${V}`, du, au)
    const cout = get(`SELECT COALESCE(SUM(l.qte*l.pa),0) c FROM lignes_vente l JOIN ventes v ON v.id=l.vente_id WHERE ${V}`, du, au).c
    const jours = new Map()
    const debut = new Date(du + 'T00:00:00Z'), fin = new Date(au + 'T00:00:00Z')
    if ((fin - debut) / 86400000 > 120) throw new Erreur(400, 'Période de 120 jours maximum')
    for (let d = new Date(debut); d <= fin; d.setUTCDate(d.getUTCDate() + 1)) jours.set(d.toISOString().slice(0, 10), { jour: d.toISOString().slice(0, 10), ca: 0, nb: 0, marge: 0 })
    for (const r of all(`SELECT substr(v.created_at,1,10) j, SUM(v.total-v.remise) ca, COUNT(CASE WHEN v.type='vente' THEN 1 END) nb FROM ventes v WHERE ${V} GROUP BY j`, du, au)) Object.assign(jours.get(r.j) ?? {}, { ca: r.ca, nb: r.nb })
    for (const r of all(`SELECT substr(v.created_at,1,10) j, SUM(l.qte*l.pa) c FROM lignes_vente l JOIN ventes v ON v.id=l.vente_id WHERE ${V} GROUP BY j`, du, au)) {
      const j = jours.get(r.j); if (j) j.marge = j.ca - r.c
    }
    const produits = all(`SELECT l.produit_id id, l.nom, SUM(l.qte) qte, SUM(l.qte*l.prix) ca, SUM(l.qte*(l.prix-l.pa)) marge
      FROM lignes_vente l JOIN ventes v ON v.id=l.vente_id WHERE ${V} GROUP BY l.produit_id HAVING qte>0 ORDER BY ca DESC`, du, au)
    const caTotal = produits.reduce((s, p) => s + p.ca, 0) || 1
    let cumul = 0
    const abc = { A: 0, B: 0, C: 0 }
    for (const p of produits) { cumul += p.ca; p.classe = cumul - p.ca < 0.8 * caTotal ? 'A' : cumul - p.ca < 0.95 * caTotal ? 'B' : 'C'; abc[p.classe]++ }
    const sansMarge = (r) => (marges ? r : { ...r, marge: undefined })
    const stockVal = get(`SELECT COALESCE(SUM(l.qte*CASE WHEN l.prix_achat>0 THEN l.prix_achat ELSE p.prix_achat END),0) achat, COALESCE(SUM(l.qte*p.prix),0) vente
      FROM lots l JOIN produits p ON p.id=l.produit_id WHERE l.qte>0`)
    return {
      du, au, ca: t.ca, nb_ventes: t.nb, panier_moyen: t.nb ? Math.round(t.ca / t.nb) : 0, remises: t.remises, part_organismes: t.part_organismes, credits: t.credits, hors_ligne: t.hors_ligne,
      marge: marges ? t.ca - cout : null, taux_marge: marges && t.ca > 0 ? Math.round(((t.ca - cout) / t.ca) * 1000) / 10 : null,
      serie: [...jours.values()].map((j) => (marges ? j : { ...j, marge: undefined })),
      par_mode: all(`SELECT p.mode, SUM(p.montant) montant, SUM(CASE WHEN p.statut='a_confirmer' THEN p.montant ELSE 0 END) a_confirmer FROM paiements p JOIN ventes v ON v.id=p.vente_id WHERE ${V} GROUP BY p.mode ORDER BY montant DESC`, du, au),
      par_vendeur: all(`SELECT v.user_nom, COUNT(CASE WHEN v.type='vente' THEN 1 END) nb, SUM(v.total-v.remise) ca FROM ventes v WHERE ${V} GROUP BY v.user_id ORDER BY ca DESC`, du, au),
      par_famille: all(`SELECT COALESCE(p.famille,'Sans famille') famille, SUM(l.qte*l.prix) ca FROM lignes_vente l JOIN ventes v ON v.id=l.vente_id JOIN produits p ON p.id=l.produit_id WHERE ${V} GROUP BY 1 ORDER BY ca DESC LIMIT 10`, du, au),
      top_produits: produits.slice(0, 15).map(sansMarge), abc,
      dormants: all(`SELECT p.id,p.nom, COALESCE(SUM(l.qte),0) stock, COALESCE(SUM(l.qte*p.prix_achat),0) valeur FROM produits p JOIN lots l ON l.produit_id=p.id AND l.qte>0
        WHERE p.actif=1 AND NOT EXISTS (SELECT 1 FROM lignes_vente x JOIN ventes v ON v.id=x.vente_id WHERE x.produit_id=p.id AND v.statut='valide' AND v.created_at>=date('now','-90 day'))
        GROUP BY p.id ORDER BY valeur DESC LIMIT 15`).map((r) => (marges ? r : { ...r, valeur: undefined })),
      valeur_stock: marges ? stockVal : { vente: stockVal.vente },
      creances_clients: get('SELECT COALESCE(SUM(solde),0) m, COUNT(CASE WHEN solde>0 THEN 1 END) nb FROM clients').m,
      creances_organismes: get("SELECT COALESCE(SUM(part_organisme),0) m FROM ventes WHERE statut='valide' AND organisme_id IS NOT NULL AND bordereau_id IS NULL").m + get("SELECT COALESCE(SUM(total),0) m FROM bordereaux WHERE statut='emis'").m,
      dettes_fournisseurs: get('SELECT COALESCE(SUM(total-paye),0) m FROM receptions').m
    }
  })
}
