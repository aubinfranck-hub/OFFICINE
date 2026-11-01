// Conseil au comptoir : le pharmacien rédige des fiches (symptôme, âge, poids, produit, posologie, précautions) ;
// la tablette retrouve les produits adaptés et leur stock. Le logiciel ne contient aucune dose : c'est le pharmacien qui les saisit.
export function routesConseil(ctx) {
  const { get, all, run, route, journal, exiger, Erreur, uuid, maintenant, texte, entier } = ctx
  const STOCK = `COALESCE((SELECT SUM(qte) FROM lots l WHERE l.produit_id=p.id),0)`

  route('GET', '/api/conseil/symptomes', ({ user }) => {
    exiger(user, 'vente')
    return all("SELECT symptome, COUNT(*) fiches FROM conseils WHERE actif=1 GROUP BY symptome ORDER BY symptome")
  })

  // Recherche : age_mois et poids (kg) facultatifs ; une borne à 0 veut dire « pas de limite ».
  route('GET', '/api/conseil', ({ user, q }) => {
    exiger(user, 'vente')
    const symptome = String(q.get('symptome') ?? '').trim()
    if (!symptome) throw new Erreur(400, 'Choisis un symptôme')
    const age = !q.get('age_mois') ? null : Math.max(0, Number(q.get('age_mois')))
    const poids = !q.get('poids') ? null : Math.max(0, Number(q.get('poids')))
    const grossesse = q.get('grossesse') === '1'
    const lignes = all(`SELECT c.*, p.nom produit_nom, p.dci, p.dosage, p.forme, p.prix, p.ordonnance, ${STOCK} stock
      FROM conseils c LEFT JOIN produits p ON p.id=c.produit_id AND p.actif=1 WHERE c.actif=1 AND c.symptome=? ORDER BY c.type DESC, c.titre`, symptome)
    const dans = (v, mn, mx) => v == null || ((mn === 0 || v >= mn) && (mx === 0 || v <= mx))
    const concerne = (c) => dans(age, c.age_min_mois, c.age_max_mois) && dans(poids, c.poids_min, c.poids_max)
    const alertes = lignes.filter((c) => c.type === 'alerte' && concerne(c)).map((c) => ({ id: c.id, titre: c.titre, texte: c.precautions }))
    const produits = lignes.filter((c) => c.type === 'produit' && concerne(c) && !(grossesse && c.grossesse_non)).map((c) => ({
      id: c.id, produit_id: c.produit_id, titre: c.titre, nom: c.produit_nom, dci: c.dci, dosage: c.dosage, forme: c.forme, prix: c.prix, ordonnance: c.ordonnance,
      stock: c.stock ?? 0, posologie: c.posologie, precautions: c.precautions
    }))
    const ecartes = grossesse ? lignes.filter((c) => c.type === 'produit' && c.grossesse_non && concerne(c)).length : 0
    return { symptome, age_mois: age, poids, alertes, produits, ecartes, aucune_fiche: lignes.length === 0 }
  })

  // Gestion des fiches (réservée à ceux qui gèrent les produits)
  route('GET', '/api/conseil/fiches', ({ user }) => {
    exiger(user, 'produits')
    return all(`SELECT c.*, p.nom produit_nom FROM conseils c LEFT JOIN produits p ON p.id=c.produit_id ORDER BY c.symptome, c.type DESC, c.titre`)
  })
  route('POST', '/api/conseil/fiches', ({ user, body, req }) => {
    exiger(user, 'produits')
    const type = body.type === 'alerte' ? 'alerte' : 'produit'
    const f = {
      symptome: texte(body.symptome, 'Symptôme', { requis: true, max: 60 }), titre: texte(body.titre, 'Titre', { max: 120 }) || '',
      age_min_mois: entier(body.age_min_mois ?? 0, 'Âge minimum'), age_max_mois: entier(body.age_max_mois ?? 0, 'Âge maximum'),
      poids_min: entier(body.poids_min ?? 0, 'Poids minimum'), poids_max: entier(body.poids_max ?? 0, 'Poids maximum'),
      posologie: texte(body.posologie, 'Posologie', { max: 600 }) || '', precautions: texte(body.precautions, 'Précautions', { max: 800 }) || '',
      grossesse_non: body.grossesse_non ? 1 : 0, produit_id: body.produit_id ? String(body.produit_id) : null
    }
    if (type === 'produit' && !f.produit_id) throw new Erreur(400, 'Choisis le produit conseillé')
    if (type === 'alerte' && !f.precautions) throw new Erreur(400, 'Écris le message d\'alerte')
    const id = body.id ? String(body.id) : uuid()
    const ex = get('SELECT id FROM conseils WHERE id=?', id)
    if (ex) run('UPDATE conseils SET symptome=?,type=?,titre=?,produit_id=?,age_min_mois=?,age_max_mois=?,poids_min=?,poids_max=?,posologie=?,precautions=?,grossesse_non=? WHERE id=?',
      f.symptome, type, f.titre, f.produit_id, f.age_min_mois, f.age_max_mois, f.poids_min, f.poids_max, f.posologie, f.precautions, f.grossesse_non, id)
    else run('INSERT INTO conseils (id,symptome,type,titre,produit_id,age_min_mois,age_max_mois,poids_min,poids_max,posologie,precautions,grossesse_non,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, f.symptome, type, f.titre, f.produit_id, f.age_min_mois, f.age_max_mois, f.poids_min, f.poids_max, f.posologie, f.precautions, f.grossesse_non, maintenant())
    journal(user, ex ? 'conseil modifié' : 'conseil ajouté', `${f.symptome} — ${f.titre}`, req?.ip)
    return { id }
  })
  route('POST', '/api/conseil/fiches/([^/]+)/supprimer', ({ user, params, req }) => {
    exiger(user, 'produits')
    run('DELETE FROM conseils WHERE id=?', params[0])
    journal(user, 'conseil supprimé', params[0], req?.ip)
    return { ok: true }
  })
}

// Fiches de démonstration. Aucune dose n'est fournie : la posologie est à saisir par le pharmacien.
export function semerConseils(db) {
  const run = (sql, ...p) => db.prepare(sql).run(...p)
  const prod = (n) => db.prepare('SELECT id FROM produits WHERE nom LIKE ? LIMIT 1').get(n + '%')?.id ?? null
  const DEMO = 'DÉMO : posologie à saisir par le pharmacien selon la notice du produit.'
  const maintenant = new Date().toISOString()
  const ajout = (symptome, type, titre, produit, o = {}) => run(
    'INSERT INTO conseils (id,symptome,type,titre,produit_id,age_min_mois,age_max_mois,poids_min,poids_max,posologie,precautions,grossesse_non,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    crypto.randomUUID(), symptome, type, titre, produit ? prod(produit) : null, o.amin ?? 0, o.amax ?? 0, o.pmin ?? 0, o.pmax ?? 0, o.pos ?? '', o.prec ?? '', o.gno ? 1 : 0, maintenant)
  ajout('Mal de gorge', 'alerte', 'Orienter vers le médecin', null, { prec: 'Difficulté à avaler ou à respirer, bave, cou gonflé, fièvre qui dure plus de 3 jours : ne pas conseiller seul, orienter vers le médecin. (Texte de démonstration à valider par le pharmacien.)' })
  ajout('Mal de gorge', 'alerte', 'Jeune enfant', null, { amax: 36, prec: 'Enfant de moins de 3 ans : avis du pharmacien titulaire avant tout conseil. (Texte de démonstration.)' })
  ajout('Mal de gorge', 'produit', 'Douleur et fièvre : paracétamol sirop enfant', 'Doliprane enfant', { amin: 1, amax: 144, pmin: 4, pmax: 40, pos: DEMO, prec: 'Ne pas associer avec un autre produit contenant du paracétamol.' })
  ajout('Mal de gorge', 'produit', 'Douleur et fièvre : paracétamol adulte', 'Paracétamol Biogaran', { amin: 144, pmin: 40, pos: DEMO, prec: 'Ne pas associer avec un autre produit contenant du paracétamol.' })
  ajout('Mal de gorge', 'produit', 'Anti-inflammatoire (adulte)', 'Ibuprofène', { amin: 180, pmin: 40, pos: DEMO, gno: true, prec: 'À éviter pendant la grossesse. À prendre au cours d\'un repas.' })
  ajout('Fièvre ou douleur', 'alerte', 'Nourrisson', null, { amax: 3, prec: 'Nourrisson de moins de 3 mois avec de la fièvre : orienter vers le médecin sans délai. (Texte de démonstration.)' })
  ajout('Fièvre ou douleur', 'produit', 'Paracétamol enfant', 'Doliprane enfant', { amin: 1, amax: 144, pmin: 4, pmax: 40, pos: DEMO })
  ajout('Fièvre ou douleur', 'produit', 'Paracétamol adulte', 'Efferalgan', { amin: 144, pmin: 40, pos: DEMO })
  ajout('Diarrhée', 'alerte', 'Orienter vers le médecin', null, { prec: 'Sang dans les selles, signes de déshydratation (bouche sèche, urines rares), nourrisson, diarrhée de plus de 2 jours : orienter vers le médecin. (Texte de démonstration.)' })
  ajout('Diarrhée', 'produit', 'Pansement digestif', 'Smecta', { pos: DEMO, prec: 'Boire beaucoup pour compenser les pertes. Espacer des autres médicaments.' })
}
