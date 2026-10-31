import { normaliserPeremption } from './lib.js'
import { ipDe } from './routes-auth.js'

export function routesAchats(ctx) {
  const { get, all, run, tx, route, journal, exiger, exigerLocal, Erreur, uuid, maintenant, texte, entier } = ctx

  const STOCK = `COALESCE((SELECT SUM(qte) FROM lots l WHERE l.produit_id=p.id),0)`
  const numeroJour = (table, prefixe) => {
    const j = maintenant().slice(0, 10)
    const n = ctx.get(`SELECT COUNT(*) c FROM ${table} WHERE substr(created_at,1,10)=?`, j).c + 1
    return `${prefixe}-${j.replaceAll('-', '')}-${String(n).padStart(3, '0')}`
  }

  // ───────── Fournisseurs (grossistes-répartiteurs, laboratoires) ─────────
  route('GET', '/api/fournisseurs', ({ user }) => {
    exiger(user, 'achats')
    return all(`SELECT f.*, COALESCE((SELECT SUM(total-paye) FROM receptions r WHERE r.fournisseur_id=f.id),0) dette FROM fournisseurs f WHERE f.actif=1 ORDER BY f.nom`)
  })
  route('POST', '/api/fournisseurs', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'achats')
    const f = [texte(body.nom, 'Nom', { requis: true, max: 100 }), texte(body.telephone, 'Téléphone', { max: 40 }), texte(body.email, 'Email', { max: 100 }), entier(body.delai_jours ?? 0, 'Délai', { max: 90 })]
    if (body.id) {
      if (!run('UPDATE fournisseurs SET nom=?,telephone=?,email=?,delai_jours=? WHERE id=?', ...f, String(body.id)).changes) throw new Erreur(404, 'Fournisseur introuvable')
      return { id: body.id }
    }
    const id = uuid()
    run('INSERT INTO fournisseurs (id,nom,telephone,email,delai_jours) VALUES (?,?,?,?,?)', id, ...f)
    journal(user, 'fournisseur_cree', f[0], ipDe(req))
    return { id }
  })

  // ───────── Commandes : suggestions automatiques selon le stock et les ventes ─────────
  route('GET', '/api/commandes/suggestions', ({ user }) => {
    exiger(user, 'achats')
    const lignes = all(`SELECT p.id produit_id, p.nom, p.seuil, p.stock_max, p.prix_achat, p.fournisseur_id, ${STOCK} stock,
      COALESCE((SELECT SUM(lc.qte_commandee-lc.qte_recue) FROM lignes_commande lc JOIN commandes c ON c.id=lc.commande_id WHERE lc.produit_id=p.id AND c.statut IN ('envoyee','recue_partielle')),0) en_commande,
      COALESCE((SELECT SUM(l.qte) FROM lignes_vente l JOIN ventes v ON v.id=l.vente_id WHERE l.produit_id=p.id AND v.statut='valide' AND v.created_at>=date('now','-30 day')),0) vendu_30j
      FROM produits p WHERE p.actif=1`)
    return lignes.map((l) => {
      const cible = Math.max(l.stock_max, l.seuil * 2, Math.ceil(l.vendu_30j / 2))
      const qte = cible - l.stock - l.en_commande
      const urgent = l.stock <= 0 && (l.seuil > 0 || l.vendu_30j > 0)
      const bas = (l.seuil > 0 && l.stock <= l.seuil) || (l.vendu_30j > 0 && l.stock < l.vendu_30j / 6)
      return { ...l, qte, urgent, retenu: (urgent || bas) && qte > 0 }
    }).filter((l) => l.retenu).sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.nom.localeCompare(b.nom))
  })
  route('GET', '/api/commandes', ({ user, q }) => {
    exiger(user, 'achats')
    return all(`SELECT c.*, f.nom fournisseur_nom, (SELECT COUNT(*) FROM lignes_commande WHERE commande_id=c.id) nb_lignes
      FROM commandes c JOIN fournisseurs f ON f.id=c.fournisseur_id ${q.get('statut') ? 'WHERE c.statut=?' : ''} ORDER BY c.created_at DESC LIMIT 100`, ...(q.get('statut') ? [q.get('statut')] : []))
  })
  route('GET', '/api/commandes/([^/]+)', ({ user, params }) => {
    exiger(user, 'achats')
    const c = get('SELECT c.*, f.nom fournisseur_nom, f.telephone fournisseur_tel FROM commandes c JOIN fournisseurs f ON f.id=c.fournisseur_id WHERE c.id=?', params[0])
    if (!c) throw new Erreur(404, 'Commande introuvable')
    c.lignes = all('SELECT * FROM lignes_commande WHERE commande_id=? ORDER BY nom', c.id)
    return c
  })
  route('POST', '/api/commandes', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'achats')
    if (!Array.isArray(body.lignes) || !body.lignes.length) throw new Erreur(400, 'Commande vide')
    return tx(() => {
      const f = get('SELECT * FROM fournisseurs WHERE id=? AND actif=1', String(body.fournisseur_id ?? ''))
      if (!f) throw new Erreur(400, 'Fournisseur requis')
      const id = uuid()
      const numero = numeroJour('commandes', 'C')
      let total = 0
      run('INSERT INTO commandes (id,numero,fournisseur_id,statut,note,user_id,created_at) VALUES (?,?,?,?,?,?,?)', id, numero, f.id, 'envoyee', texte(body.note, 'Note', { max: 200 }), user.id, maintenant())
      for (const l of body.lignes) {
        const p = get('SELECT * FROM produits WHERE id=?', String(l?.produit_id ?? ''))
        if (!p) throw new Erreur(400, 'Produit inconnu dans la commande')
        const qte = entier(l.qte, 'Quantité', { min: 1, max: 100000 })
        const pa = l.prix_achat != null ? entier(l.prix_achat, 'Prix d\'achat') : p.prix_achat
        run('INSERT INTO lignes_commande (commande_id,produit_id,nom,qte_commandee,prix_achat) VALUES (?,?,?,?,?)', id, p.id, p.nom, qte, pa)
        total += qte * pa
      }
      run('UPDATE commandes SET total_estime=? WHERE id=?', total, id)
      journal(user, 'commande_creee', `${numero} ${f.nom} ${total}F`, ipDe(req))
      return { id, numero, total_estime: total }
    })
  })
  route('POST', '/api/commandes/([^/]+)/annuler', ({ user, params }) => {
    exigerLocal(); exiger(user, 'achats')
    const r = run("UPDATE commandes SET statut='annulee' WHERE id=? AND statut='envoyee'", params[0])
    if (!r.changes) throw new Erreur(409, 'Seule une commande envoyée sans réception peut être annulée')
    return { ok: true }
  })

  // ───────── Réception d'une livraison (bon de livraison) → lots, prix d'achat, dette fournisseur ─────────
  route('POST', '/api/receptions', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'achats')
    if (!Array.isArray(body.lignes) || !body.lignes.length) throw new Erreur(400, 'Aucune ligne reçue')
    return tx(() => {
      const f = get('SELECT * FROM fournisseurs WHERE id=? AND actif=1', String(body.fournisseur_id ?? ''))
      if (!f) throw new Erreur(400, 'Fournisseur requis')
      const cmd = body.commande_id ? get('SELECT * FROM commandes WHERE id=?', String(body.commande_id)) : null
      const quand = maintenant()
      const id = uuid()
      const numero = numeroJour('receptions', 'BL')
      const echeance = /^\d{4}-\d{2}-\d{2}$/.test(body.echeance || '') ? body.echeance : new Date(Date.now() + f.delai_jours * 86400000).toISOString().slice(0, 10)
      run('INSERT INTO receptions (id,numero,fournisseur_id,commande_id,num_bl,echeance,user_id,user_nom,created_at) VALUES (?,?,?,?,?,?,?,?,?)', id, numero, f.id, cmd?.id ?? null, texte(body.num_bl, 'N° BL', { max: 60 }), echeance, user.id, user.nom, quand)
      let total = 0
      for (const l of body.lignes) {
        const p = get('SELECT * FROM produits WHERE id=?', String(l?.produit_id ?? ''))
        if (!p) throw new Erreur(400, 'Produit inconnu')
        const qte = entier(l.qte, `Quantité (${p.nom})`, { min: 1, max: 1000000 })
        const pa = entier(l.prix_achat ?? p.prix_achat, `Prix d'achat (${p.nom})`)
        const numeroLot = texte(l.numero, `N° de lot (${p.nom})`, { requis: true, max: 40 })
        const per = normaliserPeremption(String(l.peremption || ''))
        let lot = get('SELECT * FROM lots WHERE produit_id=? AND numero=?', p.id, numeroLot)
        if (lot) run('UPDATE lots SET qte=qte+?, peremption=?, prix_achat=? WHERE id=?', qte, per, pa, lot.id)
        else { lot = { id: uuid() }; run('INSERT INTO lots (id,produit_id,numero,peremption,qte,prix_achat) VALUES (?,?,?,?,?,?)', lot.id, p.id, numeroLot, per, qte, pa) }
        run('UPDATE produits SET prix_achat=? WHERE id=?', pa, p.id)
        if (l.prix_vente != null && l.prix_vente !== '') run('UPDATE produits SET prix=? WHERE id=?', entier(l.prix_vente, 'Prix de vente'), p.id)
        run('INSERT INTO lignes_reception (reception_id,produit_id,nom,lot_numero,peremption,qte,prix_achat) VALUES (?,?,?,?,?,?,?)', id, p.id, p.nom, numeroLot, per, qte, pa)
        run('INSERT INTO mouvements (produit_id,lot_id,type,qte,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?)', p.id, lot.id, 'reception', qte, numero, user.id, quand)
        if (p.stupefiant) run('INSERT INTO registre_stupefiants (created_at,produit_id,produit_nom,type,qte,solde,ref,user_nom) VALUES (?,?,?,?,?,?,?,?)', quand, p.id, p.nom, 'entree', qte, get('SELECT COALESCE(SUM(qte),0) s FROM lots WHERE produit_id=?', p.id).s, `${numero} / ${f.nom}`, user.nom)
        if (cmd) run('UPDATE lignes_commande SET qte_recue=qte_recue+? WHERE commande_id=? AND produit_id=?', qte, cmd.id, p.id)
        total += qte * pa
      }
      run('UPDATE receptions SET total=? WHERE id=?', total, id)
      if (cmd) {
        const reste = get('SELECT COUNT(*) c FROM lignes_commande WHERE commande_id=? AND qte_recue<qte_commandee', cmd.id).c
        run('UPDATE commandes SET statut=? WHERE id=?', reste ? 'recue_partielle' : 'recue', cmd.id)
      }
      journal(user, 'reception', `${numero} ${f.nom} ${total}F`, ipDe(req))
      return { id, numero, total }
    })
  })
  route('GET', '/api/receptions', ({ user, q }) => {
    exiger(user, 'achats')
    return all(`SELECT r.*, f.nom fournisseur_nom, r.total-r.paye reste FROM receptions r JOIN fournisseurs f ON f.id=r.fournisseur_id
      WHERE 1=1 ${q.get('impayes') === '1' ? 'AND r.total>r.paye' : ''} ${q.get('fournisseur_id') ? 'AND r.fournisseur_id=?' : ''} ORDER BY r.created_at DESC LIMIT 150`, ...(q.get('fournisseur_id') ? [q.get('fournisseur_id')] : []))
  })
  route('GET', '/api/receptions/([^/]+)', ({ user, params }) => {
    exiger(user, 'achats')
    const r = get('SELECT r.*, f.nom fournisseur_nom FROM receptions r JOIN fournisseurs f ON f.id=r.fournisseur_id WHERE r.id=?', params[0])
    if (!r) throw new Erreur(404, 'Réception introuvable')
    r.lignes = all('SELECT * FROM lignes_reception WHERE reception_id=?', r.id)
    r.paiements = all('SELECT montant,mode,created_at FROM paiements_fournisseur WHERE reception_id=? ORDER BY id', r.id)
    return r
  })
  route('POST', '/api/receptions/([^/]+)/payer', ({ user, body, params, req }) => {
    exigerLocal(); exiger(user, 'achats')
    return tx(() => {
      const r = get('SELECT * FROM receptions WHERE id=?', params[0])
      if (!r) throw new Erreur(404, 'Réception introuvable')
      const montant = entier(body.montant, 'Montant', { min: 1 })
      if (montant > r.total - r.paye) throw new Erreur(409, `Reste à payer : ${r.total - r.paye} F`)
      run('UPDATE receptions SET paye=paye+? WHERE id=?', montant, r.id)
      run('INSERT INTO paiements_fournisseur (reception_id,montant,mode,user_id,created_at) VALUES (?,?,?,?,?)', r.id, montant, texte(body.mode, 'Mode', { max: 30 }) || 'especes', user.id, maintenant())
      journal(user, 'paiement_fournisseur', `${r.numero} ${montant}F`, ipDe(req))
      return { reste: r.total - r.paye - montant }
    })
  })
}
