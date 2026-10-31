import { MODES_MOBILE, MODES_PAIEMENT, peut } from './core.js'
import { ipDe } from './routes-auth.js'

export function routesComptoir(ctx) {
  const { get, all, run, tx, route, journal, exiger, exigerLocal, Erreur, uuid, maintenant, texte, entier, jour } = ctx

  const stockDe = (pid) => get('SELECT COALESCE(SUM(qte),0) s FROM lots WHERE produit_id=?', pid).s
  const sessionOuverte = (userId) => get("SELECT id FROM caisse_sessions WHERE user_id=? AND statut='ouverte'", userId)?.id ?? null
  const numeroDuJour = (prefixe, jourV) => {
    const n = get('SELECT COUNT(*) c FROM ventes WHERE substr(created_at,1,10)=? AND numero LIKE ?', jourV, `${prefixe}-%`).c + 1
    return `${prefixe}-${jourV.replaceAll('-', '')}-${String(n).padStart(4, '0')}`
  }
  const registre = (p, type, qte, ctxReg) => {
    run('INSERT INTO registre_stupefiants (created_at,produit_id,produit_nom,type,qte,solde,patient,prescripteur,num_ordonnance,ref,user_nom) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ctxReg.quand, p.id, p.nom, type, qte, stockDe(p.id), ctxReg.patient ?? null, ctxReg.prescripteur ?? null, ctxReg.num_ordonnance ?? null, ctxReg.ref ?? null, ctxReg.user_nom ?? null)
  }

  // ───────── Vente : sélection FEFO, prix recalculés par le serveur, paiements multiples ─────────
  function creerVente(p, user, { horsLigne = false } = {}) {
    if (!p || typeof p.id !== 'string' || p.id.length > 80 || !Array.isArray(p.lignes) || !p.lignes.length) throw new Erreur(400, 'Vente invalide')
    const deja = get('SELECT id,numero,total,remise,part_patient,part_organisme,paiement_statut FROM ventes WHERE id=?', p.id)
    if (deja) return { ...deja, deja: true, a_regulariser: [] }
    return tx(() => {
      const quand = horsLigne && p.created_at && !isNaN(Date.parse(p.created_at)) && Date.parse(p.created_at) <= Date.now() + 60000 ? new Date(p.created_at).toISOString() : maintenant()
      const jourV = quand.slice(0, 10)
      const client = p.client_id ? get('SELECT * FROM clients WHERE id=? AND actif=1', String(p.client_id)) : null
      if (p.client_id && !client) throw new Erreur(400, 'Client introuvable')
      const org = p.organisme_id ? get('SELECT * FROM organismes WHERE id=? AND actif=1', String(p.organisme_id)) : null
      if (p.organisme_id && !org) throw new Erreur(400, 'Organisme introuvable')

      const lignes = [], manques = [], stup = []
      let total = 0
      for (const l of p.lignes) {
        const qte = entier(l?.qte, 'Quantité', { min: 1, max: 10000 })
        const prod = get('SELECT * FROM produits WHERE id=? AND actif=1', String(l?.produit_id ?? ''))
        if (!prod) throw new Erreur(400, 'Produit inconnu')
        let reste = qte
        for (const lot of all('SELECT * FROM lots WHERE produit_id=? AND qte>0 AND peremption>=? ORDER BY peremption, numero', prod.id, jourV)) {
          if (!reste) break
          const prend = Math.min(reste, lot.qte)
          lignes.push({ prod, lot, qte: prend, pa: lot.prix_achat || prod.prix_achat })
          reste -= prend
        }
        if (reste > 0) {
          if (!horsLigne) throw new Erreur(409, `Stock insuffisant : ${prod.nom} (manque ${reste})`)
          lignes.push({ prod, lot: null, qte: reste, pa: prod.prix_achat })
          manques.push(`${prod.nom} x${reste}`)
        }
        if (prod.stupefiant && !stup.includes(prod)) stup.push(prod)
        total += qte * prod.prix
      }

      const patient = texte(p.patient_nom, 'Patient', { max: 120 }) || client?.nom || null
      const prescripteur = texte(p.prescripteur, 'Prescripteur', { max: 120 })
      const numOrdo = texte(p.num_ordonnance, 'N° d\'ordonnance', { max: 60 })
      if (stup.length && (!patient || !prescripteur || !numOrdo)) throw new Erreur(400, 'Produit stupéfiant : patient, prescripteur et n° d\'ordonnance obligatoires')

      const remise = entier(p.remise ?? 0, 'Remise', { max: total })
      if (remise > 0 && !peut(user, 'remise')) throw new Erreur(403, 'Tu n\'as pas le droit de faire une remise')
      const net = total - remise
      const taux = org ? org.taux : 0
      const partOrg = Math.round((net * taux) / 100)
      const partPatient = net - partOrg

      const paiements = (Array.isArray(p.paiements) ? p.paiements : []).map((x) => {
        if (!MODES_PAIEMENT.includes(x?.mode)) throw new Erreur(400, 'Mode de paiement inconnu')
        return { mode: x.mode, montant: entier(x.montant, 'Montant', { min: 1 }) }
      })
      const somme = paiements.reduce((s, x) => s + x.montant, 0)
      if (somme !== partPatient) throw new Erreur(400, `Les paiements (${somme}) ne couvrent pas la part du patient (${partPatient})`)
      const credit = paiements.filter((x) => x.mode === 'credit').reduce((s, x) => s + x.montant, 0)
      if (credit > 0 && !client) throw new Erreur(400, 'Vente à crédit : choisis un client')

      const numero = numeroDuJour('V', jourV)
      const aConfirmer = paiements.some((x) => MODES_MOBILE.includes(x.mode))
      const mode = partPatient === 0 ? 'bon_sante' : paiements.length === 1 ? paiements[0].mode : 'mixte'
      run(`INSERT INTO ventes (id,numero,user_id,user_nom,total,mode,organisme,taux_prise_charge,part_patient,paiement_statut,hors_ligne,created_at,
            type,client_id,client_nom,prescripteur,num_ordonnance,num_adherent,organisme_id,remise,part_organisme,credit,session_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'vente',?,?,?,?,?,?,?,?,?,?)`,
        p.id, numero, user.id, user.nom, total, mode, org?.nom ?? null, taux, partPatient, aConfirmer ? 'a_confirmer' : 'confirme', horsLigne ? 1 : 0, quand,
        client?.id ?? null, patient, prescripteur, numOrdo, texte(p.num_adherent, 'N° adhérent', { max: 60 }) || client?.num_adherent || null,
        org?.id ?? null, remise, partOrg, credit, sessionOuverte(user.id))
      for (const x of paiements) run('INSERT INTO paiements (id,vente_id,mode,montant,statut,created_at) VALUES (?,?,?,?,?,?)', uuid(), p.id, x.mode, x.montant, MODES_MOBILE.includes(x.mode) ? 'a_confirmer' : 'confirme', quand)
      for (const l of lignes) {
        run('INSERT INTO lignes_vente (vente_id,produit_id,lot_id,nom,qte,prix,pa) VALUES (?,?,?,?,?,?,?)', p.id, l.prod.id, l.lot?.id ?? null, l.prod.nom, l.qte, l.prod.prix, l.pa)
        if (l.lot) run('UPDATE lots SET qte=qte-? WHERE id=?', l.qte, l.lot.id)
        run('INSERT INTO mouvements (produit_id,lot_id,type,qte,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?)', l.prod.id, l.lot?.id ?? null, l.lot ? 'vente' : 'vente_sans_stock', -l.qte, numero, user.id, quand)
      }
      for (const prod of stup) {
        const qte = lignes.filter((l) => l.prod.id === prod.id).reduce((s, l) => s + l.qte, 0)
        registre(prod, 'sortie', qte, { quand, patient, prescripteur, num_ordonnance: numOrdo, ref: numero, user_nom: user.nom })
      }
      if (client) run('UPDATE clients SET solde=solde+?, points=points+? WHERE id=?', credit, Math.floor(partPatient / 1000), client.id)
      if (manques.length) journal(user, 'stock_a_regulariser', `${numero} : ${manques.join(', ')}`)
      return { id: p.id, numero, total, remise, part_patient: partPatient, part_organisme: partOrg, paiement_statut: aConfirmer ? 'a_confirmer' : 'confirme', a_regulariser: manques }
    })
  }

  // Retour partiel d'une vente (remise en stock + remboursement)
  function retourVente(id, body, user) {
    return tx(() => {
      const v = get("SELECT * FROM ventes WHERE id=? AND type='vente' AND statut='valide'", id)
      if (!v) throw new Erreur(404, 'Vente introuvable')
      if (!Array.isArray(body.lignes) || !body.lignes.length) throw new Erreur(400, 'Choisis les lignes à retourner')
      const mode = body.mode || 'especes'
      if (!MODES_PAIEMENT.includes(mode)) throw new Erreur(400, 'Mode de remboursement inconnu')
      const lignesV = all('SELECT * FROM lignes_vente WHERE vente_id=?', id)
      const sel = []
      let brut = 0
      for (const x of body.lignes) {
        const l = lignesV.find((y) => y.id === Number(x?.ligne_id))
        if (!l) throw new Erreur(400, 'Ligne inconnue')
        const qte = entier(x.qte, 'Quantité', { min: 1 })
        if (qte > l.qte - l.retourne) throw new Erreur(409, `Quantité retournable dépassée : ${l.nom}`)
        sel.push({ l, qte })
        brut += qte * l.prix
      }
      const netV = v.total - v.remise
      const net = v.total > 0 ? Math.round((brut * netV) / v.total) : 0
      const partOrg = netV > 0 ? Math.round((net * v.part_organisme) / netV) : 0
      const partPat = net - partOrg
      const client = v.client_id ? get('SELECT * FROM clients WHERE id=?', v.client_id) : null
      if (mode === 'credit' && !client) throw new Erreur(400, 'Remboursement sur compte : client requis')
      const quand = maintenant()
      const rid = uuid()
      const numero = numeroDuJour('R', quand.slice(0, 10))
      run(`INSERT INTO ventes (id,numero,user_id,user_nom,total,mode,organisme,taux_prise_charge,part_patient,paiement_statut,created_at,
            type,client_id,client_nom,organisme_id,remise,part_organisme,credit,session_id,retour_de,prescripteur,num_ordonnance)
           VALUES (?,?,?,?,?,?,?,?,?,'confirme',?, 'retour',?,?,?,?,?,?,?,?,?,?)`,
        rid, numero, user.id, user.nom, -brut, mode, v.organisme, v.taux_prise_charge, -partPat, quand,
        v.client_id, v.client_nom, v.organisme_id, -(brut - net), -partOrg, mode === 'credit' ? -partPat : 0, sessionOuverte(user.id), v.id, v.prescripteur, v.num_ordonnance)
      if (partPat > 0) run('INSERT INTO paiements (id,vente_id,mode,montant,statut,created_at) VALUES (?,?,?,?,?,?)', uuid(), rid, mode, -partPat, 'confirme', quand)
      for (const { l, qte } of sel) {
        run('INSERT INTO lignes_vente (vente_id,produit_id,lot_id,nom,qte,prix,pa) VALUES (?,?,?,?,?,?,?)', rid, l.produit_id, l.lot_id, l.nom, -qte, l.prix, l.pa)
        run('UPDATE lignes_vente SET retourne=retourne+? WHERE id=?', qte, l.id)
        if (l.lot_id) run('UPDATE lots SET qte=qte+? WHERE id=?', qte, l.lot_id)
        run('INSERT INTO mouvements (produit_id,lot_id,type,qte,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?)', l.produit_id, l.lot_id, 'retour', qte, numero, user.id, quand)
        const prod = get('SELECT * FROM produits WHERE id=?', l.produit_id)
        if (prod?.stupefiant) registre(prod, 'entree', qte, { quand, patient: v.client_nom, prescripteur: v.prescripteur, num_ordonnance: v.num_ordonnance, ref: numero, user_nom: user.nom })
      }
      if (client && mode === 'credit') run('UPDATE clients SET solde=solde-? WHERE id=?', partPat, client.id)
      journal(user, 'retour', `${numero} (vente ${v.numero}) ${net}F`)
      return { id: rid, numero, rembourse: partPat, total_retour: net }
    })
  }

  function annulerVente(id, user) {
    return tx(() => {
      const v = get('SELECT * FROM ventes WHERE id=?', id)
      if (!v) throw new Erreur(404, 'Vente introuvable')
      if (v.statut !== 'valide' || v.type !== 'vente') throw new Erreur(409, 'Vente déjà annulée ou non annulable')
      if (get("SELECT 1 x FROM ventes WHERE retour_de=? AND statut='valide'", id)) throw new Erreur(409, 'Cette vente a déjà un retour : annule-la par un retour')
      if (v.bordereau_id) throw new Erreur(409, 'Vente déjà incluse dans un bordereau de tiers payant')
      const quand = maintenant()
      for (const l of all('SELECT * FROM lignes_vente WHERE vente_id=?', id)) {
        if (l.lot_id) run('UPDATE lots SET qte=qte+? WHERE id=?', l.qte, l.lot_id)
        run('INSERT INTO mouvements (produit_id,lot_id,type,qte,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?)', l.produit_id, l.lot_id, 'annulation', l.qte, v.numero, user.id, quand)
        const prod = get('SELECT * FROM produits WHERE id=?', l.produit_id)
        if (prod?.stupefiant) registre(prod, 'entree', l.qte, { quand, patient: v.client_nom, prescripteur: v.prescripteur, num_ordonnance: v.num_ordonnance, ref: `Annulation ${v.numero}`, user_nom: user.nom })
      }
      if (v.client_id && v.credit) run('UPDATE clients SET solde=solde-? WHERE id=?', v.credit, v.client_id)
      run("UPDATE ventes SET statut='annulee' WHERE id=?", id)
      journal(user, 'vente_annulee', v.numero)
      return { ok: true }
    })
  }

  route('GET', '/api/catalogue', ({ user }) => {
    exiger(user)
    return {
      produits: all(`SELECT p.id,p.code,p.nom,p.dci,p.dosage,p.forme,p.famille,p.prix,p.ordonnance,p.stupefiant,p.generique,p.emplacement,
        COALESCE((SELECT SUM(qte) FROM lots l WHERE l.produit_id=p.id),0) stock FROM produits p WHERE p.actif=1 ORDER BY p.nom`),
      organismes: all('SELECT id,nom,taux FROM organismes WHERE actif=1 ORDER BY nom'),
      clients: all('SELECT id,nom,telephone,organisme_id,num_adherent,solde FROM clients WHERE actif=1 ORDER BY nom LIMIT 5000'),
      genere_le: maintenant()
    }
  })

  route('POST', '/api/ventes', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'vente')
    const r = creerVente(body, user, { horsLigne: body.hors_ligne === true })
    if (!r.deja) journal(user, 'vente', `${r.numero} ${r.total - (r.remise || 0)}F`, ipDe(req))
    return r
  })
  route('GET', '/api/ventes', ({ user, q }) => {
    exiger(user, 'vente')
    const du = jour(q, 'du'), au = jour(q, 'au')
    const voitTout = peut(user, 'stats')
    const filtre = q.get('q') ? `AND (v.numero LIKE ? OR v.client_nom LIKE ?)` : ''
    const args = [du, au, ...(q.get('q') ? [`%${q.get('q')}%`, `%${q.get('q')}%`] : []), ...(voitTout ? [] : [user.id])]
    const vs = all(`SELECT v.* FROM ventes v WHERE substr(v.created_at,1,10) BETWEEN ? AND ? ${filtre} ${voitTout ? '' : 'AND v.user_id=?'} ORDER BY v.created_at DESC LIMIT 300`, ...args)
    for (const v of vs) {
      v.lignes = all('SELECT id,nom,qte,prix,retourne FROM lignes_vente WHERE vente_id=?', v.id)
      v.paiements = all('SELECT id,mode,montant,statut FROM paiements WHERE vente_id=?', v.id)
    }
    return vs
  })
  route('GET', '/api/ventes/([^/]+)', ({ user, params }) => {
    exiger(user, 'vente')
    const v = get('SELECT * FROM ventes WHERE id=?', params[0])
    if (!v || (!peut(user, 'stats') && v.user_id !== user.id)) throw new Erreur(404, 'Vente introuvable')
    v.lignes = all('SELECT id,nom,qte,prix,retourne FROM lignes_vente WHERE vente_id=?', v.id)
    v.paiements = all('SELECT id,mode,montant,statut FROM paiements WHERE vente_id=?', v.id)
    return v
  })
  route('POST', '/api/paiements/([^/]+)/confirmer', ({ user, params, req }) => {
    exigerLocal(); exiger(user, 'confirmer')
    return tx(() => {
      const p = get('SELECT * FROM paiements WHERE id=?', params[0])
      if (!p) throw new Erreur(404, 'Paiement introuvable')
      run("UPDATE paiements SET statut='confirme' WHERE id=?", p.id)
      const reste = get("SELECT 1 x FROM paiements WHERE vente_id=? AND statut='a_confirmer'", p.vente_id)
      run('UPDATE ventes SET paiement_statut=? WHERE id=?', reste ? 'a_confirmer' : 'confirme', p.vente_id)
      journal(user, 'paiement_confirme', `${p.mode} ${p.montant}F`, ipDe(req))
      return { ok: true }
    })
  })
  route('POST', '/api/ventes/([^/]+)/annuler', ({ user, params }) => { exigerLocal(); exiger(user, 'annuler'); return annulerVente(params[0], user) })
  route('POST', '/api/ventes/([^/]+)/retour', ({ user, params, body }) => { exigerLocal(); exiger(user, 'annuler'); return retourVente(params[0], body, user) })

  // ───────── Clients et crédit (ardoise) ─────────
  route('GET', '/api/clients', ({ user, q }) => {
    exiger(user, 'clients')
    const rech = q.get('q') ? `%${q.get('q')}%` : null
    const dette = q.get('dette') === '1' ? 'AND c.solde>0' : ''
    return all(`SELECT c.*, o.nom organisme_nom FROM clients c LEFT JOIN organismes o ON o.id=c.organisme_id
      WHERE c.actif=1 ${dette} ${rech ? 'AND (c.nom LIKE ? OR c.telephone LIKE ?)' : ''} ORDER BY c.nom LIMIT 300`, ...(rech ? [rech, rech] : []))
  })
  route('POST', '/api/clients', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'clients')
    const nom = texte(body.nom, 'Nom', { requis: true, max: 120 })
    const orgId = body.organisme_id ? String(body.organisme_id) : null
    if (orgId && !get('SELECT 1 x FROM organismes WHERE id=?', orgId)) throw new Erreur(400, 'Organisme introuvable')
    const f = [nom, texte(body.telephone, 'Téléphone', { max: 40 }), orgId, texte(body.num_adherent, 'N° adhérent', { max: 60 }), texte(body.notes, 'Notes', { max: 300 })]
    if (body.id) {
      const r = run('UPDATE clients SET nom=?,telephone=?,organisme_id=?,num_adherent=?,notes=? WHERE id=?', ...f, String(body.id))
      if (!r.changes) throw new Erreur(404, 'Client introuvable')
      return { id: body.id }
    }
    const id = uuid()
    run('INSERT INTO clients (id,nom,telephone,organisme_id,num_adherent,notes,created_at) VALUES (?,?,?,?,?,?,?)', id, ...f, maintenant())
    journal(user, 'client_cree', nom, ipDe(req))
    return { id }
  })
  route('GET', '/api/clients/([^/]+)', ({ user, params }) => {
    exiger(user, 'clients')
    const c = get('SELECT c.*, o.nom organisme_nom FROM clients c LEFT JOIN organismes o ON o.id=c.organisme_id WHERE c.id=?', params[0])
    if (!c) throw new Erreur(404, 'Client introuvable')
    c.ventes = all("SELECT id,numero,created_at,type,total,remise,part_patient,credit FROM ventes WHERE client_id=? AND statut='valide' ORDER BY created_at DESC LIMIT 50", c.id)
    c.reglements = all('SELECT montant,mode,created_at FROM reglements_client WHERE client_id=? ORDER BY id DESC LIMIT 30', c.id)
    return c
  })
  route('POST', '/api/clients/([^/]+)/reglement', ({ user, body, params, req }) => {
    exigerLocal(); exiger(user, 'caisse')
    return tx(() => {
      const c = get('SELECT * FROM clients WHERE id=?', params[0])
      if (!c) throw new Erreur(404, 'Client introuvable')
      const montant = entier(body.montant, 'Montant', { min: 1 })
      if (montant > c.solde) throw new Erreur(409, `Le client doit ${c.solde} F seulement`)
      const mode = ['especes', 'cheque', 'carte', ...MODES_MOBILE].includes(body.mode) ? body.mode : 'especes'
      run('UPDATE clients SET solde=solde-? WHERE id=?', montant, c.id)
      run('INSERT INTO reglements_client (client_id,montant,mode,session_id,user_id,created_at) VALUES (?,?,?,?,?,?)', c.id, montant, mode, sessionOuverte(user.id), user.id, maintenant())
      journal(user, 'reglement_client', `${c.nom} ${montant}F`, ipDe(req))
      return { solde: c.solde - montant }
    })
  })

  // ───────── Caisse : ouverture, mouvements, clôture avec écart ─────────
  const resume = (s) => {
    const parMode = all(`SELECT p.mode, SUM(p.montant) montant FROM paiements p JOIN ventes v ON v.id=p.vente_id WHERE v.session_id=? AND v.statut='valide' GROUP BY p.mode ORDER BY montant DESC`, s.id)
    const especes = parMode.find((m) => m.mode === 'especes')?.montant ?? 0
    const regl = get("SELECT COALESCE(SUM(montant),0) m FROM reglements_client WHERE session_id=? AND mode='especes'", s.id).m
    const mv = all('SELECT type,montant,motif,created_at FROM mouvements_caisse WHERE session_id=? ORDER BY id', s.id)
    const entrees = mv.filter((m) => m.type === 'entree').reduce((t, m) => t + m.montant, 0)
    const sorties = mv.filter((m) => m.type === 'sortie').reduce((t, m) => t + m.montant, 0)
    return {
      ...s, par_mode: parMode, reglements_especes: regl, mouvements: mv, entrees, sorties,
      nb_ventes: get("SELECT COUNT(*) c FROM ventes WHERE session_id=? AND statut='valide' AND type='vente'", s.id).c,
      especes_attendues_calc: s.fond_initial + especes + regl + entrees - sorties
    }
  }
  route('GET', '/api/caisse', ({ user }) => {
    exiger(user, 'caisse')
    const s = get("SELECT * FROM caisse_sessions WHERE user_id=? AND statut='ouverte'", user.id)
    return { courante: s ? resume(s) : null }
  })
  route('POST', '/api/caisse/ouvrir', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'caisse')
    if (sessionOuverte(user.id)) throw new Erreur(409, 'Ta caisse est déjà ouverte')
    const fond = entier(body.fond ?? 0, 'Fond de caisse')
    const id = uuid()
    run('INSERT INTO caisse_sessions (id,user_id,user_nom,ouverte_le,fond_initial) VALUES (?,?,?,?,?)', id, user.id, user.nom, maintenant(), fond)
    journal(user, 'caisse_ouverte', `${fond}F`, ipDe(req))
    return { id }
  })
  route('POST', '/api/caisse/mouvement', ({ user, body }) => {
    exigerLocal(); exiger(user, 'caisse')
    const sid = sessionOuverte(user.id)
    if (!sid) throw new Erreur(409, 'Ouvre ta caisse d\'abord')
    if (!['entree', 'sortie'].includes(body.type)) throw new Erreur(400, 'Type invalide')
    run('UPDATE caisse_sessions SET note=note WHERE id=?', sid)
    run('INSERT INTO mouvements_caisse (session_id,type,montant,motif,user_id,created_at) VALUES (?,?,?,?,?,?)', sid, body.type, entier(body.montant, 'Montant', { min: 1 }), texte(body.motif, 'Motif', { requis: true, max: 120 }), user.id, maintenant())
    journal(user, 'mouvement_caisse', `${body.type} ${body.montant}F ${body.motif}`)
    return { ok: true }
  })
  route('POST', '/api/caisse/fermer', ({ user, body, req }) => {
    exigerLocal(); exiger(user, 'caisse')
    return tx(() => {
      const s = get("SELECT * FROM caisse_sessions WHERE user_id=? AND statut='ouverte'", user.id)
      if (!s) throw new Erreur(409, 'Aucune caisse ouverte')
      const comptees = entier(body.especes_comptees, 'Espèces comptées')
      const r = resume(s)
      const ecart = comptees - r.especes_attendues_calc
      run("UPDATE caisse_sessions SET statut='fermee', fermee_le=?, especes_attendues=?, especes_comptees=?, ecart=?, note=? WHERE id=?", maintenant(), r.especes_attendues_calc, comptees, ecart, texte(body.note, 'Note', { max: 200 }), s.id)
      journal(user, 'caisse_fermee', `écart ${ecart}F`, ipDe(req))
      return { ...resume(get('SELECT * FROM caisse_sessions WHERE id=?', s.id)) }
    })
  })
  route('GET', '/api/caisse/historique', ({ user, q }) => {
    exiger(user, 'stats')
    return all('SELECT * FROM caisse_sessions WHERE substr(ouverte_le,1,10) BETWEEN ? AND ? ORDER BY ouverte_le DESC LIMIT 200', jour(q, 'du'), jour(q, 'au'))
  })
}
