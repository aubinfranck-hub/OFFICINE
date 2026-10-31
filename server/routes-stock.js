import { peut } from './core.js'
import { ipDe } from './routes-auth.js'
import { normaliserPeremption } from './lib.js'

export function routesStock(ctx) {
  const { get, all, run, tx, route, journal, exiger, exigerLocal, Erreur, uuid, maintenant, texte, entier, jour } = ctx

  const STOCK = `COALESCE((SELECT SUM(qte) FROM lots l WHERE l.produit_id=p.id),0)`
  const bool = (v) => (v === true || v === 1 || v === '1' || v === 'oui' || v === 'true' ? 1 : 0)
  const colonnesVisibles = (u) => (peut(u, 'marges') ? ', p.prix_achat' : '')

  function validerProduit(b) {
    const prix = entier(b.prix, 'Prix de vente')
    const prixAchat = entier(b.prix_achat ?? 0, 'Prix d\'achat')
    const f = {
      code: texte(b.code, 'Code', { max: 40 }), nom: texte(b.nom, 'Nom', { requis: true, max: 160 }), dci: texte(b.dci, 'DCI', { max: 160 }),
      dosage: texte(b.dosage, 'Dosage', { max: 60 }), forme: texte(b.forme, 'Forme', { max: 60 }), famille: texte(b.famille, 'Famille', { max: 60 }),
      labo: texte(b.labo, 'Laboratoire', { max: 80 }), emplacement: texte(b.emplacement, 'Emplacement', { max: 40 }),
      prix, prix_achat: prixAchat, seuil: entier(b.seuil ?? 0, 'Stock minimum'), stock_max: entier(b.stock_max ?? 0, 'Stock maximum'),
      ordonnance: bool(b.ordonnance), stupefiant: bool(b.stupefiant), generique: bool(b.generique), remboursable: b.remboursable === undefined || b.remboursable === '' ? 1 : bool(b.remboursable),
      fournisseur_id: b.fournisseur_id ? String(b.fournisseur_id) : null
    }
    if (f.stupefiant) f.ordonnance = 1
    return f
  }
  const CHAMPS = ['code', 'nom', 'dci', 'dosage', 'forme', 'famille', 'labo', 'emplacement', 'prix', 'prix_achat', 'seuil', 'stock_max', 'ordonnance', 'stupefiant', 'generique', 'remboursable', 'fournisseur_id']

  function enregistrerProduit(f, id) {
    if (f.code) {
      const doublon = get('SELECT id FROM produits WHERE code=? AND actif=1', f.code)
      if (doublon && doublon.id !== id) throw new Erreur(409, `Le code ${f.code} existe déjà`)
    }
    if (id) {
      const r = run(`UPDATE produits SET ${CHAMPS.map((c) => `${c}=?`).join(',')} WHERE id=?`, ...CHAMPS.map((c) => f[c]), id)
      if (!r.changes) throw new Erreur(404, 'Produit introuvable')
      return id
    }
    const nid = uuid()
    run(`INSERT INTO produits (id,${CHAMPS.join(',')}) VALUES (?,${CHAMPS.map(() => '?').join(',')})`, nid, ...CHAMPS.map((c) => f[c]))
    return nid
  }

  route('GET', '/api/produits', ({ user, q }) => {
    exiger(user, 'vente')
    const rech = q.get('q') ? `%${q.get('q')}%` : null
    const filtre = { rupture: `AND ${STOCK} <= 0`, bas: `AND ${STOCK} > 0 AND ${STOCK} <= p.seuil`, stup: 'AND p.stupefiant=1', ordonnance: 'AND p.ordonnance=1', inactif: '' }[q.get('filtre')] ?? ''
    const actif = q.get('filtre') === 'inactif' ? 0 : 1
    const fam = q.get('famille') ? 'AND p.famille=?' : ''
    const args = [actif, ...(rech ? [rech, rech, rech] : []), ...(q.get('famille') ? [q.get('famille')] : [])]
    return all(`SELECT p.id,p.code,p.nom,p.dci,p.dosage,p.forme,p.famille,p.labo,p.prix,p.seuil,p.stock_max,p.emplacement,p.ordonnance,p.stupefiant,p.generique,p.remboursable,p.actif,p.fournisseur_id${colonnesVisibles(user)},
      ${STOCK} stock FROM produits p WHERE p.actif=? ${rech ? 'AND (p.nom LIKE ? OR p.dci LIKE ? OR p.code LIKE ?)' : ''} ${fam} ${filtre} ORDER BY p.nom LIMIT 200`, ...args)
  })
  route('GET', '/api/familles', ({ user }) => { exiger(user, 'vente'); return all("SELECT DISTINCT famille FROM produits WHERE famille IS NOT NULL AND famille<>'' ORDER BY famille").map((r) => r.famille) })

  route('GET', '/api/produits/([^/]+)', ({ user, params }) => {
    exiger(user, 'vente')
    const p = get(`SELECT p.*, ${STOCK} stock FROM produits p WHERE p.id=?`, params[0])
    if (!p) throw new Erreur(404, 'Produit introuvable')
    if (!peut(user, 'marges')) delete p.prix_achat
    p.lots = all('SELECT id,numero,peremption,qte,prix_achat FROM lots WHERE produit_id=? AND qte>0 ORDER BY peremption', p.id)
    if (!peut(user, 'marges')) p.lots.forEach((l) => delete l.prix_achat)
    p.mouvements = all('SELECT m.type,m.qte,m.ref,m.created_at,l.numero lot FROM mouvements m LEFT JOIN lots l ON l.id=m.lot_id WHERE m.produit_id=? ORDER BY m.id DESC LIMIT 30', p.id)
    p.vendu_30j = get("SELECT COALESCE(SUM(l.qte),0) q FROM lignes_vente l JOIN ventes v ON v.id=l.vente_id WHERE l.produit_id=? AND v.statut='valide' AND v.created_at>=date('now','-30 day')", p.id).q
    p.substituts = p.dci ? all(`SELECT p2.id,p2.nom,p2.dosage,p2.prix,p2.generique,${STOCK.replaceAll('p.id', 'p2.id')} stock FROM produits p2 WHERE p2.actif=1 AND p2.id<>? AND lower(p2.dci)=lower(?) ORDER BY p2.prix LIMIT 12`, p.id, p.dci) : []
    return p
  })
  route('POST', '/api/produits', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'produits')
    const f = validerProduit(body)
    const id = enregistrerProduit(f, body.id ? String(body.id) : null)
    if (body.actif === 0 || body.actif === false) run('UPDATE produits SET actif=0 WHERE id=?', id)
    else if (body.id) run('UPDATE produits SET actif=1 WHERE id=?', id)
    journal(user, body.id ? 'produit_modifie' : 'produit_cree', `${f.nom} ${f.prix}F`, ipDe(req))
    return { id }
  })
  route('POST', '/api/produits/import', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'produits')
    if (!Array.isArray(body.lignes) || body.lignes.length > 10000) throw new Erreur(400, 'Fichier invalide (10 000 lignes maximum)')
    const bilan = { crees: 0, modifies: 0, erreurs: [] }
    tx(() => {
      body.lignes.forEach((l, i) => {
        try {
          const f = validerProduit(l)
          const existant = (f.code && get('SELECT id FROM produits WHERE code=?', f.code)) || get('SELECT id FROM produits WHERE lower(nom)=lower(?) AND COALESCE(dosage,\'\')=COALESCE(?,\'\')', f.nom, f.dosage)
          enregistrerProduit(f, existant?.id ?? null)
          existant ? bilan.modifies++ : bilan.crees++
        } catch (e) {
          if (!(e instanceof Erreur)) throw e
          if (bilan.erreurs.length < 30) bilan.erreurs.push(`Ligne ${i + 1} : ${e.message}`)
        }
      })
    })
    journal(user, 'import_produits', `${bilan.crees} créés, ${bilan.modifies} modifiés`, ipDe(req))
    return bilan
  })

  // ───────── Stock, pertes, ajustements ─────────
  route('GET', '/api/alertes', ({ user }) => {
    exiger(user, 'stock')
    const auj = maintenant().slice(0, 10)
    const dans90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
    const prods = all(`SELECT p.id,p.nom,p.seuil,p.stock_max,${STOCK} stock FROM produits p WHERE p.actif=1`)
    return {
      ruptures: prods.filter((p) => p.stock <= 0 && p.seuil > 0).map((p) => ({ ...p, a_commander: Math.max(p.stock_max, p.seuil * 2) })),
      stock_bas: prods.filter((p) => p.stock > 0 && p.stock <= p.seuil).map((p) => ({ ...p, a_commander: Math.max(p.stock_max, p.seuil * 2) - p.stock })),
      peremption_proche: all('SELECT l.id,p.nom,l.numero,l.peremption,l.qte FROM lots l JOIN produits p ON p.id=l.produit_id WHERE l.qte>0 AND l.peremption>=? AND l.peremption<=? ORDER BY l.peremption', auj, dans90),
      perimes: all('SELECT l.id,p.nom,l.numero,l.peremption,l.qte FROM lots l JOIN produits p ON p.id=l.produit_id WHERE l.qte>0 AND l.peremption<? ORDER BY l.peremption', auj),
      a_regulariser: get("SELECT COUNT(*) c FROM mouvements WHERE type='vente_sans_stock'").c
    }
  })
  route('GET', '/api/mouvements', ({ user, q }) => {
    exiger(user, 'stock')
    return all(`SELECT m.id,m.type,m.qte,m.ref,m.created_at,p.nom produit,l.numero lot FROM mouvements m JOIN produits p ON p.id=m.produit_id LEFT JOIN lots l ON l.id=m.lot_id
      ${q.get('produit_id') ? 'WHERE m.produit_id=?' : ''} ORDER BY m.id DESC LIMIT 200`, ...(q.get('produit_id') ? [q.get('produit_id')] : []))
  })
  route('POST', '/api/ajustement', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'stock')
    const delta = entier(body.delta, 'Variation', { min: -100000, max: 100000 })
    if (!delta) throw new Erreur(400, 'Variation nulle')
    const motif = texte(body.motif, 'Motif', { requis: true, max: 120 })
    return tx(() => {
      const lot = get('SELECT * FROM lots WHERE id=?', String(body.lot_id ?? ''))
      if (!lot) throw new Erreur(404, 'Lot introuvable')
      if (lot.qte + delta < 0) throw new Erreur(409, 'Le stock ne peut pas devenir négatif')
      run('UPDATE lots SET qte=qte+? WHERE id=?', delta, lot.id)
      run('INSERT INTO mouvements (produit_id,lot_id,type,qte,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?)', lot.produit_id, lot.id, 'ajustement', delta, motif, user.id, maintenant())
      journal(user, 'ajustement_stock', `${lot.numero} ${delta} (${motif})`, ipDe(req))
      return { ok: true }
    })
  })
  route('POST', '/api/pertes', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'stock')
    const qte = entier(body.qte, 'Quantité', { min: 1 })
    const motif = ['casse', 'perime', 'vol', 'autre'].includes(body.motif) ? body.motif : 'autre'
    return tx(() => {
      const lot = get('SELECT * FROM lots WHERE id=?', String(body.lot_id ?? ''))
      if (!lot) throw new Erreur(404, 'Lot introuvable')
      if (qte > lot.qte) throw new Erreur(409, 'Quantité supérieure au stock du lot')
      run('UPDATE lots SET qte=qte-? WHERE id=?', qte, lot.id)
      run('INSERT INTO mouvements (produit_id,lot_id,type,qte,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?)', lot.produit_id, lot.id, 'perte', -qte, motif, user.id, maintenant())
      const prod = get('SELECT * FROM produits WHERE id=?', lot.produit_id)
      if (prod.stupefiant) run('INSERT INTO registre_stupefiants (created_at,produit_id,produit_nom,type,qte,solde,ref,user_nom) VALUES (?,?,?,?,?,?,?,?)', maintenant(), prod.id, prod.nom, 'sortie', qte, get('SELECT COALESCE(SUM(qte),0) s FROM lots WHERE produit_id=?', prod.id).s, `Perte (${motif})`, user.nom)
      journal(user, 'perte_stock', `${prod.nom} lot ${lot.numero} x${qte} (${motif})`, ipDe(req))
      return { ok: true, valeur: qte * (lot.prix_achat || prod.prix_achat) }
    })
  })

  // ───────── Registre des stupéfiants ─────────
  route('GET', '/api/registre', ({ user, q }) => {
    exiger(user, 'stupefiant')
    return {
      produits: all(`SELECT p.id,p.nom,${STOCK} stock FROM produits p WHERE p.stupefiant=1 AND p.actif=1 ORDER BY p.nom`),
      lignes: all(`SELECT * FROM registre_stupefiants WHERE substr(created_at,1,10) BETWEEN ? AND ? ${q.get('produit_id') ? 'AND produit_id=?' : ''} ORDER BY id DESC LIMIT 500`, jour(q, 'du'), jour(q, 'au'), ...(q.get('produit_id') ? [q.get('produit_id')] : []))
    }
  })

  // ───────── Inventaire tournant ou complet ─────────
  route('GET', '/api/inventaires', ({ user }) => {
    exiger(user, 'inventaire')
    return all(`SELECT i.*, (SELECT COUNT(*) FROM lignes_inventaire WHERE inventaire_id=i.id) nb_lignes,
      (SELECT COUNT(*) FROM lignes_inventaire WHERE inventaire_id=i.id AND qte_comptee IS NOT NULL) nb_comptees FROM inventaires i ORDER BY ouvert_le DESC LIMIT 30`)
  })
  route('POST', '/api/inventaires', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'inventaire')
    if (get("SELECT 1 x FROM inventaires WHERE statut='ouvert'")) throw new Erreur(409, 'Un inventaire est déjà ouvert : termine-le d\'abord')
    return tx(() => {
      const id = uuid()
      const fam = texte(body.famille, 'Famille', { max: 60 })
      run('INSERT INTO inventaires (id,nom,ouvert_le,user_nom) VALUES (?,?,?,?)', id, texte(body.nom, 'Nom', { max: 80 }) || `Inventaire du ${maintenant().slice(0, 10)}`, maintenant(), user.nom)
      run(`INSERT INTO lignes_inventaire (inventaire_id,lot_id,produit_id,produit_nom,lot_numero,qte_theorique)
        SELECT ?, l.id, p.id, p.nom, l.numero, l.qte FROM lots l JOIN produits p ON p.id=l.produit_id WHERE l.qte>0 AND p.actif=1 ${fam ? 'AND p.famille=?' : ''}`, id, ...(fam ? [fam] : []))
      journal(user, 'inventaire_ouvert', id, ipDe(req))
      return { id }
    })
  })
  route('GET', '/api/inventaires/([^/]+)', ({ user, params, q }) => {
    exiger(user, 'inventaire')
    const inv = get('SELECT * FROM inventaires WHERE id=?', params[0])
    if (!inv) throw new Erreur(404, 'Inventaire introuvable')
    const rech = q.get('q') ? `%${q.get('q')}%` : null
    inv.lignes = all(`SELECT li.*, l.peremption FROM lignes_inventaire li JOIN lots l ON l.id=li.lot_id WHERE li.inventaire_id=? ${rech ? 'AND li.produit_nom LIKE ?' : ''} ${q.get('ecarts') === '1' ? 'AND li.qte_comptee IS NOT NULL AND li.qte_comptee<>li.qte_theorique' : ''} ORDER BY li.produit_nom, l.peremption LIMIT 400`, params[0], ...(rech ? [rech] : []))
    inv.nb_lignes = get('SELECT COUNT(*) c FROM lignes_inventaire WHERE inventaire_id=?', params[0]).c
    inv.nb_comptees = get('SELECT COUNT(*) c FROM lignes_inventaire WHERE inventaire_id=? AND qte_comptee IS NOT NULL', params[0]).c
    return inv
  })
  route('POST', '/api/inventaires/([^/]+)/compter', ({ user, params, body }) => {
    exigerLocal(); exiger(user, 'inventaire')
    const inv = get("SELECT * FROM inventaires WHERE id=? AND statut='ouvert'", params[0])
    if (!inv) throw new Erreur(409, 'Inventaire fermé ou introuvable')
    const items = Array.isArray(body.comptages) ? body.comptages : [body]
    tx(() => {
      for (const c of items) {
        const qte = c.qte === null || c.qte === '' ? null : entier(c.qte, 'Quantité comptée', { max: 1e6 })
        const r = run('UPDATE lignes_inventaire SET qte_comptee=? WHERE inventaire_id=? AND lot_id=?', qte, params[0], String(c.lot_id ?? ''))
        if (!r.changes) throw new Erreur(404, 'Lot absent de cet inventaire')
      }
    })
    return { ok: true }
  })
  route('POST', '/api/inventaires/([^/]+)/cloturer', ({ user, params, req }) => {
    exigerLocal(); exiger(user, 'inventaire')
    return tx(() => {
      const inv = get("SELECT * FROM inventaires WHERE id=? AND statut='ouvert'", params[0])
      if (!inv) throw new Erreur(409, 'Inventaire fermé ou introuvable')
      let ecarts = 0, valeur = 0
      const lignes = all('SELECT * FROM lignes_inventaire WHERE inventaire_id=? AND qte_comptee IS NOT NULL AND qte_comptee<>qte_theorique', params[0])
      for (const li of lignes) {
        const lot = get('SELECT l.*, p.prix_achat pa FROM lots l JOIN produits p ON p.id=l.produit_id WHERE l.id=?', li.lot_id)
        if (!lot) continue
        const delta = Math.max(li.qte_comptee - li.qte_theorique, -lot.qte)
        if (!delta) continue
        run('UPDATE lots SET qte=qte+? WHERE id=?', delta, lot.id)
        run('INSERT INTO mouvements (produit_id,lot_id,type,qte,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?)', lot.produit_id, lot.id, 'inventaire', delta, inv.nom, user.id, maintenant())
        ecarts++
        valeur += delta * (lot.prix_achat || lot.pa)
      }
      run("UPDATE inventaires SET statut='clos', clos_le=? WHERE id=?", maintenant(), params[0])
      journal(user, 'inventaire_clos', `${inv.nom} : ${ecarts} écarts, valeur ${valeur}F`, ipDe(req))
      return { ecarts, valeur, comptees: get('SELECT COUNT(*) c FROM lignes_inventaire WHERE inventaire_id=? AND qte_comptee IS NOT NULL', params[0]).c }
    })
  })
}
