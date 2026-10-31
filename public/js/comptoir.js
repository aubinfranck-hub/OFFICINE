'use strict'
// ───────── Comptoir : recherche, ticket, encaissement (fonctionne hors ligne) ─────────
var C = { q: '', lignes: [], client: null, organisme: '', adherent: '', remise: 0, attente: store.get('attente', []) }
var P = []            // paiements en cours de saisie
var ORD = { patient: '', prescripteur: '', numero: '' }
var RECU = 0          // espèces reçues du client (pour le rendu monnaie)

function sansAccent(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') }
function cle(p) { return p._k || (p._k = sansAccent([p.nom, p.dci, p.code, p.famille, p.dosage].join(' '))) }
function chercher(q) {
  var t = sansAccent(q).split(/\s+/).filter(Boolean)
  var l = S.catalogue.produits
  if (!t.length) return l.slice(0, 40)
  var exact = l.filter(function (p) { return p.code && p.code === q.trim() })
  if (exact.length) return exact
  var r = l.filter(function (p) { var k = cle(p); return t.every(function (x) { return k.indexOf(x) >= 0 }) })
  var d = sansAccent(q)
  r.sort(function (a, b) { var sa = sansAccent(a.nom).indexOf(d) === 0 ? 0 : 1, sb = sansAccent(b.nom).indexOf(d) === 0 ? 0 : 1; return sa - sb || (b.stock > 0) - (a.stock > 0) || a.nom.localeCompare(b.nom) })
  return r.slice(0, 50)
}
function ligneResultat(p) {
  return '<div class="res' + (p.stock <= 0 ? ' rupture' : '') + '" data-a="ajouter" data-v="' + esc(p.id) + '"><div><div class="nom">' + esc(p.nom) + tags(p) + '</div><div class="sous">' +
    [p.dosage, p.forme, p.dci, p.emplacement ? '📍 ' + p.emplacement : ''].filter(Boolean).map(esc).join(' · ') + '</div></div><div><b>' + F(p.prix) + '</b></div><div style="display:flex;gap:6px;align-items:center">' +
    (p.dci ? '<button class="s" data-a="subst" data-v="' + esc(p.id) + '" title="Voir les équivalents (même DCI)">⇄</button>' : '') + stk(p.stock) + '</div></div>'
}
function majResultats() {
  var z = $('#resultats'); if (!z) return
  var r = chercher(C.q)
  z.innerHTML = r.length ? r.map(ligneResultat).join('') : '<div class="c m" style="padding:30px">Aucun produit trouvé pour « ' + esc(C.q) + ' »</div>'
}
function produit(id) { return S.catalogue.produits.find(function (p) { return p.id === id }) }

// ───────── Calculs du ticket ─────────
function orgActif() { return S.catalogue.organismes.find(function (o) { return o.id === C.organisme }) || null }
function calc() {
  var total = C.lignes.reduce(function (s, l) { return s + l.prix * l.qte }, 0)
  var totalRemb = C.lignes.reduce(function (s, l) { return s + (l.remb === 0 ? 0 : l.prix * l.qte) }, 0)
  var remise = Math.min(Math.max(0, C.remise || 0), total)
  var net = total - remise, o = orgActif(), partOrg = 0
  if (o) {
    // même règle que le serveur : seuls les produits remboursables, remise au prorata, puis plafond de l'assureur
    partOrg = Math.round(Math.round(total > 0 ? totalRemb * net / total : 0) * o.taux / 100)
    if (o.plafond > 0) partOrg = Math.min(partOrg, o.plafond)
  }
  return { total: total, remise: remise, net: net, partOrg: partOrg, aPayer: net - partOrg, org: o, nonRemb: total - totalRemb }
}
function ajouter(id) {
  var p = produit(id); if (!p) return
  var l = C.lignes.find(function (x) { return x.id === id })
  if (p.stock <= 0 && S.online) { toast('Rupture de stock : ' + p.nom); return }
  if (l) { if (S.online && l.qte >= p.stock) { toast('Stock disponible : ' + p.stock); return } l.qte++ }
  else C.lignes.push({ id: id, nom: p.nom, prix: p.prix, qte: 1, stock: p.stock, stup: p.stupefiant, ordo: p.ordonnance, remb: p.remboursable === 0 ? 0 : 1 })
  rendre()
}
ACT.ajouter = function (v) { ajouter(v); var r = $('#rech'); if (r) r.focus() }
ACT.plus = function (v) { ajouter(v) }
ACT.moins = function (v) { var l = C.lignes.find(function (x) { return x.id === v }); if (l) l.qte--; C.lignes = C.lignes.filter(function (x) { return x.qte > 0 }); rendre() }
ACT.retirer = function (v) { C.lignes = C.lignes.filter(function (x) { return x.id !== v }); rendre() }
ACT.viderPanier = function () { C.lignes = []; C.client = null; C.organisme = ''; C.adherent = ''; C.remise = 0; rendre() }
INP.rech = function (v) { C.q = v; majResultats() }
INP.remise = function (v) { C.remise = Math.max(0, Number(String(v).replace(/\s/g, '')) || 0); majTotaux() }
INP.org = function (v) { C.organisme = v; rendre() }
INP.adh = function (v) { C.adherent = v }
function majTotaux() { var c = calc(); var e = $('#tot-net'); if (e) e.textContent = F(c.net); e = $('#tot-pay'); if (e) e.textContent = F(c.aPayer); e = $('#tot-org'); if (e) e.textContent = F(c.partOrg) }
document.addEventListener('keydown', function (e) {
  if (S.vue !== 'comptoir') return
  if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'rech') {
    var r = chercher(C.q)
    if (r.length === 1 || (r.length && r[0].code && r[0].code === C.q.trim())) { C.q = ''; ajouter(r[0].id); majResultats(); var i = $('#rech'); if (i) { i.value = ''; i.focus() } }
  }
  if (e.key === 'F2') { e.preventDefault(); var x = $('#rech'); if (x) x.focus() }
  if (e.key === 'F4' && C.lignes.length && !modalOuvert()) { e.preventDefault(); ouvrirEncaissement() }
})

// ───────── Équivalents (même DCI) ─────────
ACT.subst = function (id, el, ev) {
  ev.stopPropagation()
  var p = produit(id); if (!p || !p.dci) return
  var l = S.catalogue.produits.filter(function (x) { return x.id !== id && x.dci && sansAccent(x.dci) === sansAccent(p.dci) }).sort(function (a, b) { return a.prix - b.prix })
  ouvrirModal({ titre: 'Équivalents de ' + esc(p.nom), corps: '<p class="m">Même DCI : <b>' + esc(p.dci) + '</b>. Classés du moins cher au plus cher.</p>' + tableau([['Produit'], ['Dosage'], ['Prix', 'r'], ['Stock', 'c'], ['']], [p].concat(l).map(function (x) {
    return '<tr><td>' + esc(x.nom) + tags(x) + (x.id === id ? ' <small class="m">(produit cherché)</small>' : '') + '</td><td>' + esc(x.dosage || '') + '</td><td class="r"><b>' + F(x.prix) + '</b></td><td class="c">' + stk(x.stock) + '</td><td><button class="s p" data-a="ajouter" data-v="' + esc(x.id) + '">Ajouter</button></td></tr>'
  }), 'Aucun équivalent'), actions: [{ l: 'Fermer', a: 'fermer' }] })
}

// ───────── Client / patient ─────────
ACT.choisirClient = function () {
  ouvrirModal({ titre: 'Client / patient', corps: '<input id="cli-q" data-i="cliq" placeholder="Nom ou téléphone" autofocus><div id="cli-liste"></div><hr style="border:0;border-top:1px solid var(--b);margin:14px 0"><h3>Nouveau client</h3><div class="ligne-form">' + champ('Nom', 'nc-nom') + champ('Téléphone', 'nc-tel') + '</div><div class="ligne-form">' + champ('Organisme (tiers payant)', 'nc-org', { opts: [['', 'Aucun']].concat(S.catalogue.organismes.map(function (o) { return [o.id, o.nom + ' (' + o.taux + ' %)'] })) }) + champ('N° adhérent', 'nc-adh') + '</div>', actions: [{ l: 'Sans client', a: 'sansClient' }, { l: 'Créer et choisir', a: 'creerClient', cls: 'p' }] })
  majListeClients('')
}
function majListeClients(q) {
  var z = $('#cli-liste'); if (!z) return
  var k = sansAccent(q)
  var l = S.catalogue.clients.filter(function (c) { return !k || sansAccent(c.nom + ' ' + (c.telephone || '')).indexOf(k) >= 0 }).slice(0, 8)
  z.innerHTML = l.map(function (c) { return '<div class="res" data-a="prendreClient" data-v="' + esc(c.id) + '" style="grid-template-columns:1fr auto"><div><div class="nom">' + esc(c.nom) + '</div><div class="sous">' + esc(c.telephone || '') + '</div></div>' + (c.solde > 0 ? '<span class="puce rouge">doit ' + F(c.solde) + '</span>' : '') + '</div>' }).join('') || '<p class="m">Aucun client trouvé.</p>'
}
INP.cliq = function (v) { majListeClients(v) }
ACT.prendreClient = function (id) {
  var c = S.catalogue.clients.find(function (x) { return x.id === id }); if (!c) return
  C.client = c; if (c.organisme_id) { C.organisme = c.organisme_id; C.adherent = c.num_adherent || '' }
  fermerModal(); rendre()
}
ACT.sansClient = function () { C.client = null; fermerModal(); rendre() }
ACT.creerClient = function () {
  if (!val('nc-nom')) return modalErr('Le nom est obligatoire')
  api('/api/clients', { body: { nom: val('nc-nom'), telephone: val('nc-tel'), organisme_id: val('nc-org') || null, num_adherent: val('nc-adh') } }).then(function (r) {
    var c = { id: r.id, nom: val('nc-nom'), telephone: val('nc-tel'), organisme_id: val('nc-org') || null, num_adherent: val('nc-adh'), solde: 0 }
    S.catalogue.clients.unshift(c); store.set('catalogue', S.catalogue); ACT.prendreClient(c.id)
  }, function (e) { modalErr(e.message) })
}

// ───────── Ventes en attente ─────────
ACT.mettreAttente = function () {
  if (!C.lignes.length) return
  C.attente.push({ id: uuid(), date: new Date().toISOString(), lignes: C.lignes, client: C.client, organisme: C.organisme, adherent: C.adherent, remise: C.remise })
  store.set('attente', C.attente); ACT.viderPanier(); toast('Vente mise en attente')
}
ACT.voirAttente = function () {
  ouvrirModal({ titre: 'Ventes en attente', corps: tableau([['Heure'], ['Client'], ['Articles'], ['Total', 'r'], ['']], C.attente.map(function (a) {
    return '<tr><td>' + dt(a.date) + '</td><td>' + esc(a.client ? a.client.nom : '—') + '</td><td>' + a.lignes.length + '</td><td class="r">' + F(a.lignes.reduce(function (s, l) { return s + l.prix * l.qte }, 0)) + '</td><td><button class="s p" data-a="reprendre" data-v="' + a.id + '">Reprendre</button> <button class="s d" data-a="jeterAttente" data-v="' + a.id + '">Supprimer</button></td></tr>'
  }), 'Aucune vente en attente'), actions: [{ l: 'Fermer', a: 'fermer' }] })
}
ACT.reprendre = function (id) {
  var a = C.attente.find(function (x) { return x.id === id }); if (!a) return
  if (C.lignes.length) C.attente.push({ id: uuid(), date: new Date().toISOString(), lignes: C.lignes, client: C.client, organisme: C.organisme, adherent: C.adherent, remise: C.remise })
  C.attente = C.attente.filter(function (x) { return x.id !== id })
  C.lignes = a.lignes; C.client = a.client; C.organisme = a.organisme; C.adherent = a.adherent; C.remise = a.remise
  store.set('attente', C.attente); fermerModal(); rendre()
}
ACT.jeterAttente = function (id) { C.attente = C.attente.filter(function (x) { return x.id !== id }); store.set('attente', C.attente); ACT.voirAttente() }

// ───────── Vue comptoir ─────────
VUES.comptoir = {
  titre: 'Comptoir',
  html: function () {
    var c = calc()
    var lignes = C.lignes.map(function (l) {
      return '<div class="lig"><div><div style="font-weight:600">' + esc(l.nom) + (l.stup ? '<span class="tag st">STUP</span>' : '') + '</div><small class="m">' + F(l.prix) + ' × ' + l.qte + '</small></div><div class="qte"><button data-a="moins" data-v="' + esc(l.id) + '">−</button><b>' + l.qte + '</b><button data-a="plus" data-v="' + esc(l.id) + '">+</button></div><div class="r"><b>' + F(l.prix * l.qte) + '</b><br><button class="s d" data-a="retirer" data-v="' + esc(l.id) + '" style="border:0;min-height:22px;padding:0">retirer</button></div></div>'
    }).join('') || '<p class="m c" style="margin-top:30px">Cherche un produit à gauche<br>ou scanne un code-barres.</p>'
    var orgs = '<option value="">Sans tiers payant</option>' + S.catalogue.organismes.map(function (o) { return '<option value="' + esc(o.id) + '"' + (o.id === C.organisme ? ' selected' : '') + '>' + esc(o.nom) + ' — ' + o.taux + ' %</option>' }).join('')
    var rejet = S.rejets.length ? '<div class="alerte rouge">⚠ ' + S.rejets.length + ' vente(s) hors ligne refusée(s) par le serveur. <button class="s" data-a="aller" data-v="ventes">Voir</button></div>' : ''
    return rejet + '<div class="comptoir" style="height:calc(100vh - 128px)"><div class="gauche"><input id="rech" data-i="rech" value="' + esc(C.q) + '" placeholder="🔍  Nom, DCI ou code-barres…   (F2)" autocomplete="off" autofocus style="font-size:17px;min-height:50px"><div id="resultats" class="resultats">' + (chercher(C.q).map(ligneResultat).join('') || '<div class="c m" style="padding:30px">Aucun produit</div>') + '</div></div>' +
      '<div class="ticket-panneau"><div class="tete"><div style="display:flex;gap:8px;align-items:center"><button data-a="choisirClient" style="flex:1;text-align:left">' + (C.client ? '👤 <b>' + esc(C.client.nom) + '</b>' + (C.client.solde > 0 ? ' <span class="puce rouge">doit ' + F(C.client.solde) + '</span>' : '') : '👤 Client / patient (facultatif)') + '</button>' +
      '<button data-a="voirAttente" title="Ventes en attente">⏸ ' + (C.attente.length || '') + '</button></div><select data-c="org" style="margin-top:8px">' + orgs + '</select>' + (C.organisme ? '<input data-i="adh" value="' + esc(C.adherent) + '" placeholder="N° adhérent / bon de santé' + (orgActif() && orgActif().adherent_obligatoire ? ' (obligatoire)' : '') + '" style="margin-top:8px">' : '') + '</div>' +
      '<div class="corps">' + lignes + '</div><div class="pied"><div class="tot"><span class="m">Total</span><b>' + F(c.total) + '</b></div>' +
      (peut('remise') ? '<div class="tot" style="align-items:center"><span class="m">Remise (F)</span><input data-i="remise" inputmode="numeric" value="' + (C.remise || '') + '" style="width:110px;text-align:right;min-height:34px;padding:4px 8px"></div>' : '') +
      (c.org ? '<div class="tot"><span class="m">Part ' + esc(c.org.nom) + ' (' + c.org.taux + ' %' + (c.org.plafond > 0 ? ', plafond ' + N(c.org.plafond) : '') + ')</span><b id="tot-org">' + F(c.partOrg) + '</b></div>' + (c.nonRemb ? '<div class="tot"><span class="m">dont non remboursable</span><span class="warn">' + F(c.nonRemb) + '</span></div>' : '') : '') +
      '<div class="tot grand"><span>À payer</span><span id="tot-pay">' + F(c.aPayer) + '</span></div>' +
      '<button class="p" data-a="encaisser" style="width:100%;font-size:18px;min-height:54px;margin-top:10px"' + (C.lignes.length ? '' : ' disabled') + '>Encaisser  (F4)</button>' +
      '<div class="ligne-form" style="margin-top:8px"><button data-a="mettreAttente"' + (C.lignes.length ? '' : ' disabled') + '>⏸ Mettre en attente</button><button class="d" data-a="viderPanier"' + (C.lignes.length ? '' : ' disabled') + '>Vider</button></div></div></div></div>'
  }
}

// ───────── Encaissement ─────────
ACT.encaisser = function () { ouvrirEncaissement() }
function stupDansPanier() { return C.lignes.some(function (l) { return l.stup }) }
function ouvrirEncaissement() {
  if (!C.lignes.length) return
  var c = calc()
  if (c.org && c.org.adherent_obligatoire && !String(C.adherent || '').trim()) { toast(c.org.nom + ' : saisis le n° d\'adhérent avant d\'encaisser'); return }
  P = []; RECU = 0
  ORD = { patient: C.client ? C.client.nom : '', prescripteur: '', numero: '' }
  var stup = stupDansPanier()
  var corps = '<div class="grille kpis" style="margin-bottom:10px"><div class="kpi"><span>Total</span><b>' + F(c.total) + '</b></div>' + (c.remise ? '<div class="kpi"><span>Remise</span><b>' + F(c.remise) + '</b></div>' : '') + (c.org ? '<div class="kpi"><span>Part ' + esc(c.org.nom) + (c.org.plafond > 0 && c.partOrg >= c.org.plafond ? ' (plafond atteint)' : '') + '</span><b>' + F(c.partOrg) + '</b>' + (c.nonRemb ? '<small class="warn">' + F(c.nonRemb) + ' non remboursable</small>' : '') + '</div>' : '') + '<div class="kpi"><span>À payer par le patient</span><b style="color:var(--v)">' + F(c.aPayer) + '</b></div></div>'
  if (c.aPayer > 0) corps += '<h3>Mode de paiement</h3><div class="modes">' + ['especes', 'wave', 'orange', 'mtn', 'moov', 'cheque', 'credit'].map(function (m) { return '<button data-a="addPay" data-v="' + m + '">' + MODES[m] + '</button>' }).join('') + '</div><div id="pay-zone"></div>'
  else corps += '<p class="ok">Prise en charge complète : rien à encaisser auprès du patient.</p>'
  corps += '<details' + (stup ? ' open' : '') + ' style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">' + (stup ? '⚠ Ordonnance (obligatoire : stupéfiant)' : 'Ordonnance (facultatif)') + '</summary><div class="ligne-form">' + champ('Patient', 'o-pat', { val: ORD.patient }) + champ('Prescripteur', 'o-pre') + champ('N° d\'ordonnance', 'o-num') + '</div></details>'
  ouvrirModal({ titre: 'Encaissement', large: true, corps: corps, actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Valider la vente', a: 'validerVente', cls: 'p', id: 'btn-valider' }] })
  if (c.aPayer > 0) ACT.addPay('especes')
}
function resteAPayer() { return calc().aPayer - P.reduce(function (s, p) { return s + (Number(p.montant) || 0) }, 0) }
ACT.addPay = function (mode) {
  if (mode === 'credit' && !C.client) { toast('Pour une vente à crédit, choisis d\'abord un client'); return }
  var reste = resteAPayer()
  if (reste <= 0 && P.length) { toast('Le montant est déjà couvert'); return }
  P.push({ mode: mode, montant: Math.max(0, reste) }); majPay()
}
ACT.delPay = function (i) { P.splice(Number(i), 1); majPay() }
INP.payMontant = function (v, el) { P[Number(el.dataset.idx)].montant = Math.max(0, Math.round(Number(String(v).replace(/\s/g, '')) || 0)); majReste() }
INP.recu = function (v) { RECU = Math.max(0, Number(String(v).replace(/\s/g, '')) || 0); majReste() }
function majPay() {
  var z = $('#pay-zone')
  if (z) z.innerHTML = P.map(function (p, i) {
    return '<div class="pay"><b>' + MODES[p.mode] + '</b><input data-i="payMontant" data-idx="' + i + '" inputmode="numeric" value="' + p.montant + '" style="text-align:right"><button class="s d" data-a="delPay" data-v="' + i + '">✕</button></div>' + (p.mode === 'especes' ? '<div class="pay" style="margin-top:-2px"><small class="m">Reçu du client</small><input data-i="recu" inputmode="numeric" placeholder="ex. 5000" value="' + (RECU || '') + '" style="text-align:right"><span></span></div>' : '') + (MOBILE.indexOf(p.mode) >= 0 ? '<div class="m" style="font-size:12px;margin:-2px 0 4px 110px">À confirmer après vérification du message de l\'opérateur.</div>' : '')
  }).join('') + '<div id="reste" class="tot" style="margin-top:8px"></div>'
  majReste()
}
function majReste() {
  var r = resteAPayer(), e = $('#reste')
  var esp = P.filter(function (p) { return p.mode === 'especes' }).reduce(function (s, p) { return s + p.montant }, 0)
  if (e) e.innerHTML = r === 0 ? '<span class="ok">✔ Montant couvert</span>' + (RECU > esp && esp > 0 ? '<b>Rendu : ' + F(RECU - esp) + '</b>' : '') : '<span class="' + (r > 0 ? 'warn' : 'bad') + '">' + (r > 0 ? 'Reste à payer' : 'Trop perçu') + '</span><b>' + F(Math.abs(r)) + '</b>'
  var b = $('#btn-valider'); if (b) b.disabled = (calc().aPayer > 0 && r !== 0)
}
ACT.validerVente = function () {
  var c = calc()
  var pat = val('o-pat'), pre = val('o-pre'), ord = val('o-num')
  if (stupDansPanier() && (!pat || !pre || !ord)) return modalErr('Stupéfiant : patient, prescripteur et n° d\'ordonnance obligatoires')
  if (c.aPayer > 0 && resteAPayer() !== 0) return modalErr('Les paiements doivent couvrir exactement ' + F(c.aPayer))
  var vente = { id: uuid(), created_at: new Date().toISOString(), lignes: C.lignes.map(function (l) { return { produit_id: l.id, qte: l.qte } }),
    client_id: C.client ? C.client.id : undefined, organisme_id: C.organisme || undefined, num_adherent: C.organisme ? C.adherent : undefined, remise: c.remise,
    paiements: P.filter(function (p) { return p.montant > 0 }).map(function (p) { return { mode: p.mode, montant: p.montant } }), patient_nom: pat || undefined, prescripteur: pre || undefined, num_ordonnance: ord || undefined }
  var esp = P.filter(function (p) { return p.mode === 'especes' }).reduce(function (s, p) { return s + p.montant }, 0)
  var snap = { date: vente.created_at, user: S.user.nom, lignes: C.lignes.map(function (l) { return { nom: l.nom, qte: l.qte, prix: l.prix } }), total: c.total, remise: c.remise, org: c.org ? c.org.nom + ' ' + c.org.taux + ' %' : '', partOrg: c.partOrg, aPayer: c.aPayer, paiements: vente.paiements, rendu: RECU > esp && esp > 0 ? RECU - esp : 0, client: C.client ? C.client.nom : '', adherent: C.organisme ? C.adherent : '' }
  C.lignes.forEach(function (l) { var p = produit(l.id); if (p) p.stock = Math.max(0, p.stock - l.qte) })
  if (C.client && vente.paiements.some(function (p) { return p.mode === 'credit' })) C.client.solde += vente.paiements.filter(function (p) { return p.mode === 'credit' })[0].montant
  store.set('catalogue', S.catalogue)
  var b = $('#btn-valider'); if (b) b.disabled = true
  api('/api/ventes', { body: vente }).then(function (r) { snap.numero = r.numero; terminerVente(snap, false) }, function (e) {
    if (e.reseau) { vente.hors_ligne = true; S.file.push(vente); store.set('file', S.file); snap.numero = 'HORS-LIGNE'; terminerVente(snap, true) }
    else { rafraichirCatalogue(); if (b) b.disabled = false; modalErr(e.message) }
  })
}
function terminerVente(snap, horsLigne) {
  C.lignes = []; C.client = null; C.organisme = ''; C.adherent = ''; C.remise = 0; C.q = ''
  ouvrirModal({ titre: horsLigne ? 'Vente enregistrée sur la tablette' : 'Vente ' + esc(snap.numero) + ' enregistrée', corps: (horsLigne ? '<div class="alerte">Le serveur de l\'officine est injoignable. La vente est gardée sur cet appareil et sera envoyée automatiquement.</div>' : '') +
    '<div class="tot grand"><span>Encaissé</span><span>' + F(snap.aPayer) + '</span></div>' + (snap.rendu ? '<div class="tot" style="font-size:20px"><span>Rendu monnaie</span><b>' + F(snap.rendu) + '</b></div>' : '') + (snap.paiements.some(function (p) { return MOBILE.indexOf(p.mode) >= 0 }) ? '<p class="warn">Paiement mobile à confirmer par le titulaire après vérification.</p>' : ''),
    actions: [{ l: '🖨 Imprimer le ticket', a: 'imprimerSnap', v: '' }, { l: 'Nouvelle vente', a: 'fermer', cls: 'p' }] })
  window.__snap = snap; rendre(); setTimeout(function () { var r = $('#rech'); if (r) r.focus() }, 50)
}
ACT.imprimerSnap = function () { imprimer(ticketHtml(window.__snap)) }
function ticketHtml(s) {
  var p = S.param || {}
  return '<div style="text-align:center"><b style="font-size:14px">' + esc((S.etat && S.etat.officine) || '') + '</b><br>' + esc(p.adresse || '') + (p.telephone ? '<br>Tél ' + esc(p.telephone) : '') + '</div><hr>' +
    '<div>N° ' + esc(s.numero || '') + '<br>' + dt(s.date) + ' · ' + esc(s.user) + (s.client ? '<br>Client : ' + esc(s.client) : '') + (s.adherent ? '<br>Adhérent : ' + esc(s.adherent) : '') + '</div><hr>' +
    '<table>' + s.lignes.map(function (l) { return '<tr><td>' + l.qte + ' × ' + esc(l.nom) + '</td><td style="text-align:right">' + N(l.qte * l.prix) + '</td></tr>' }).join('') + '</table><hr>' +
    '<table><tr><td>Total</td><td style="text-align:right">' + N(s.total) + '</td></tr>' + (s.remise ? '<tr><td>Remise</td><td style="text-align:right">-' + N(s.remise) + '</td></tr>' : '') + (s.partOrg ? '<tr><td>Part ' + esc(s.org) + '</td><td style="text-align:right">-' + N(s.partOrg) + '</td></tr>' : '') +
    '<tr><td><b>À PAYER</b></td><td style="text-align:right"><b>' + N(s.aPayer) + ' F</b></td></tr>' + s.paiements.map(function (x) { return '<tr><td>' + esc(MODES[x.mode] || x.mode) + '</td><td style="text-align:right">' + N(x.montant) + '</td></tr>' }).join('') + (s.rendu ? '<tr><td>Rendu</td><td style="text-align:right">' + N(s.rendu) + '</td></tr>' : '') + '</table><hr>' +
    '<div style="text-align:center">' + esc(p.message_ticket || 'Merci de votre confiance') + '</div>'
}

// ───────── Envoi des ventes faites hors ligne ─────────
var envoi = false
function viderFile() {
  if (envoi || !S.file.length || !S.token) return
  envoi = true
  var suite = function () {
    if (!S.file.length) { envoi = false; rafraichirCatalogue(); rendre(); return }
    var v = S.file[0]; v.hors_ligne = true
    api('/api/ventes', { body: v }).then(function () { S.file.shift(); store.set('file', S.file); suite() }, function (e) {
      if (e.reseau || e.http === 401 || e.http >= 500) { envoi = false; return }
      S.rejets.push({ date: v.created_at, motif: e.message, vente: v }); store.set('rejets', S.rejets)
      S.file.shift(); store.set('file', S.file); suite()
    })
  }
  suite()
}
setInterval(viderFile, 8000)

// ───────── Ventes du jour : consultation, retours, annulations ─────────
VUES.ventes = {
  titre: 'Ventes',
  charger: function () { var d = S.data.vq || (S.data.vq = { du: auj(), au: auj(), q: '' }); return charge('ventes', '/api/ventes?' + qs(d)) },
  html: function () {
    var d = S.data.vq || { du: auj(), au: auj(), q: '' }, l = S.data.ventes
    var att = S.file.length ? '<div class="alerte">⏳ ' + S.file.length + ' vente(s) faite(s) hors ligne en attente d\'envoi au serveur.</div>' : ''
    var rej = S.rejets.length ? '<div class="carte"><h3 class="bad">Ventes refusées par le serveur (' + S.rejets.length + ')</h3>' + tableau([['Date'], ['Raison'], ['Articles'], ['']], S.rejets.map(function (r, i) { return '<tr><td>' + dt(r.date) + '</td><td>' + esc(r.motif) + '</td><td>' + r.vente.lignes.length + '</td><td><button class="s" data-a="supprRejet" data-v="' + i + '">Supprimer</button></td></tr>' }), '') + '<p class="m">Ces ventes n\'ont pas été enregistrées : vérifie le stock ou les produits concernés.</p></div>' : ''
    var filtre = '<div class="carte"><div class="ligne-form">' + champ('Du', 'v-du', { type: 'date', val: d.du }) + champ('Au', 'v-au', { type: 'date', val: d.au }) + champ('N° ou client', 'v-q', { val: d.q }) + '<button class="p" data-a="filtrerVentes">Afficher</button>' + (peut('stats') ? '<button data-a="exportVentes">⬇ Exporter (Excel)</button>' : '') + '</div></div>'
    if (!l) return att + rej + filtre + '<p class="m">Chargement…</p>'
    var lignes = l.map(function (v) {
      var etat = v.statut === 'annulee' ? '<span class="puce rouge">annulée</span>' : (v.paiement_statut === 'a_confirmer' ? '<span class="puce off">à confirmer</span>' : '') + (v.type === 'retour' ? '<span class="puce bleu">retour</span>' : '')
      var pay = v.paiements.map(function (p) { return (MODES[p.mode] || p.mode) + ' ' + N(p.montant) + (p.statut === 'a_confirmer' ? '*' : '') }).join(' + ') || (v.organisme ? 'Tiers payant' : '')
      var net = v.total - v.remise
      return '<tr><td><b>' + esc(v.numero) + '</b>' + (v.hors_ligne ? ' <small class="m">hors ligne</small>' : '') + '<br><small class="m">' + dt(v.created_at) + '</small></td><td>' + esc(v.client_nom || '') + '<br><small class="m">' + esc(v.user_nom || '') + '</small></td><td style="max-width:260px"><small>' + v.lignes.map(function (x) { return esc(x.nom) + ' ×' + Math.abs(x.qte) }).join(', ') + '</small></td><td><small>' + esc(pay) + (v.organisme ? '<br>' + esc(v.organisme) + ' ' + v.taux_prise_charge + ' %' : '') + '</small></td><td class="r"><b>' + F(net) + '</b><br>' + etat + '</td><td style="white-space:nowrap"><button class="s" data-a="ticketVente" data-v="' + esc(v.id) + '">🖨</button> ' +
        (v.type === 'vente' && v.statut === 'valide' && peut('annuler') && !cloud() ? '<button class="s" data-a="retourVente" data-v="' + esc(v.id) + '">Retour</button> <button class="s d" data-a="annulerVente" data-v="' + esc(v.id) + '">Annuler</button>' : '') +
        (v.paiement_statut === 'a_confirmer' && v.statut === 'valide' && peut('confirmer') && !cloud() ? v.paiements.filter(function (p) { return p.statut === 'a_confirmer' }).map(function (p) { return ' <button class="s p" data-a="confirmerPaiement" data-v="' + esc(p.id) + '">Confirmer ' + (MODES[p.mode] || '') + '</button>' }).join('') : '') + '</td></tr>'
    })
    return att + rej + filtre + carte(l.length + ' opération(s)', tableau([['N° / heure'], ['Client / vendeur'], ['Articles'], ['Paiement'], ['Net', 'r'], ['']], lignes, 'Aucune vente sur cette période'))
  }
}
ACT.exportVentes = function () { var d = S.data.vq || {}; telecharger('/api/export/ventes?' + qs({ du: d.du, au: d.au }), 'ventes.csv') }
ACT.supprRejet = function (i) { S.rejets.splice(Number(i), 1); store.set('rejets', S.rejets); rendre() }
ACT.filtrerVentes = function () { S.data.vq = { du: val('v-du'), au: val('v-au'), q: val('v-q') }; chargerVue() }
ACT.ticketVente = function (id) {
  api('/api/ventes/' + id).then(function (v) {
    imprimer(ticketHtml({ numero: v.numero, date: v.created_at, user: v.user_nom, client: v.client_nom, adherent: v.num_adherent, total: v.total < 0 ? -v.total : v.total, remise: Math.abs(v.remise), org: (v.organisme || '') + ' ' + v.taux_prise_charge + ' %', partOrg: Math.abs(v.part_organisme), aPayer: Math.abs(v.part_patient), rendu: 0,
      lignes: v.lignes.map(function (l) { return { nom: l.nom, qte: l.qte, prix: l.prix } }), paiements: v.paiements.map(function (p) { return { mode: p.mode, montant: p.montant } }) }))
  }, function (e) { toast(e.message) })
}
ACT.confirmerPaiement = function (id) { api('/api/paiements/' + id + '/confirmer', { body: {} }).then(function () { toast('Paiement confirmé'); chargerVue() }, function (e) { toast(e.message) }) }
ACT.annulerVente = function (id) { if (confirm('Annuler cette vente ? Le stock sera remis.')) api('/api/ventes/' + id + '/annuler', { body: {} }).then(function () { toast('Vente annulée'); chargerVue(); rafraichirCatalogue() }, function (e) { toast(e.message) }) }
ACT.retourVente = function (id) {
  var v = S.data.ventes.find(function (x) { return x.id === id }); if (!v) return
  var modes = ['especes'].concat(MOBILE).concat(v.client_id ? ['credit'] : [])
  ouvrirModal({ titre: 'Retour sur ' + esc(v.numero), corps: '<p class="m">Indique les quantités rendues par le client. Le stock est remis dans le même lot.</p>' + tableau([['Produit'], ['Vendu', 'r'], ['Déjà rendu', 'r'], ['À rendre', 'r']], v.lignes.map(function (l) {
    return '<tr><td>' + esc(l.nom) + '</td><td class="r">' + l.qte + '</td><td class="r">' + l.retourne + '</td><td class="r"><input type="number" min="0" max="' + (l.qte - l.retourne) + '" value="0" data-rl="' + l.id + '" style="width:80px;text-align:right"' + (l.qte - l.retourne <= 0 ? ' disabled' : '') + '></td></tr>'
  })) + champ('Remboursement', 'rt-mode', { opts: modes.map(function (m) { return [m, MODES[m]] }) }), actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Valider le retour', a: 'validerRetour', v: id, cls: 'p' }] })
}
ACT.validerRetour = function (id) {
  var lignes = Array.prototype.slice.call(document.querySelectorAll('[data-rl]')).map(function (e) { return { ligne_id: Number(e.dataset.rl), qte: Number(e.value) } }).filter(function (x) { return x.qte > 0 })
  if (!lignes.length) return modalErr('Indique au moins une quantité')
  api('/api/ventes/' + id + '/retour', { body: { lignes: lignes, mode: val('rt-mode') } }).then(function (r) { fermerModal(); toast('Retour enregistré : rembourser ' + F(r.rembourse)); chargerVue(); rafraichirCatalogue() }, function (e) { modalErr(e.message) })
}

// ───────── Caisse : ouverture, mouvements, clôture avec écart ─────────
VUES.caisse = {
  titre: 'Caisse',
  charger: function () {
    return api('/api/caisse').then(function (r) { S.caisse = r.courante }, function () {}).then(function () { if (peut('stats')) return charge('histCaisse', '/api/caisse/historique?' + qs({ du: ilya(30), au: auj() })) })
  },
  html: function () {
    var c = S.caisse, h = ''
    if (!c) h = carte('Ouvrir la caisse', '<p class="m">Compte le fond de caisse (espèces présentes au départ) avant de commencer à vendre.</p><div class="ligne-form">' + champ('Fond de caisse (F)', 'cs-fond', { type: 'number', val: 0 }) + '<button class="p" data-a="ouvrirCaisse">Ouvrir ma caisse</button></div>')
    else {
      var voit = peut('stats')
      h = '<div class="grille kpis" style="margin-bottom:14px"><div class="carte kpi"><span>Ouverte depuis</span><b style="font-size:18px">' + dt(c.ouverte_le) + '</b></div><div class="carte kpi"><span>Fond de caisse</span><b>' + F(c.fond_initial) + '</b></div><div class="carte kpi"><span>Ventes</span><b>' + c.nb_ventes + '</b></div>' + (voit ? '<div class="carte kpi"><span>Espèces attendues</span><b>' + F(c.especes_attendues_calc) + '</b></div>' : '') + '</div>' +
        '<div class="grille g2">' + carte('Encaissements par mode', c.par_mode.length ? barres(c.par_mode, 'mode', 'montant') : '<p class="m">Aucun encaissement.</p>') +
        carte('Entrées / sorties d\'espèces', '<div class="ligne-form">' + champ('Type', 'mv-type', { opts: [['sortie', 'Sortie (dépense)'], ['entree', 'Entrée']] }) + champ('Montant', 'mv-mt', { type: 'number' }) + champ('Motif', 'mv-motif') + '<button data-a="mouvementCaisse">Ajouter</button></div>' + tableau([['Heure'], ['Type'], ['Motif'], ['Montant', 'r']], c.mouvements.map(function (m) { return '<tr><td>' + dt(m.created_at) + '</td><td>' + m.type + '</td><td>' + esc(m.motif) + '</td><td class="r">' + F(m.montant) + '</td></tr>' }), 'Aucun mouvement')) + '</div>' +
        carte('Clôturer la caisse', '<p class="m">Compte les espèces dans le tiroir' + (voit ? '' : ' (le montant attendu ne s\'affiche qu\'après la clôture)') + '.</p><div class="ligne-form">' + champ('Espèces comptées (F)', 'cl-esp', { type: 'number' }) + champ('Remarque', 'cl-note') + '<button class="p" data-a="fermerCaisse">Clôturer</button></div>')
    }
    if (peut('stats') && S.data.histCaisse) h += carte('Historique des caisses (30 jours)', tableau([['Ouverture'], ['Caissier(ère)'], ['Fond', 'r'], ['Attendu', 'r'], ['Compté', 'r'], ['Écart', 'r']], S.data.histCaisse.map(function (s) {
      return '<tr><td>' + dt(s.ouverte_le) + '</td><td>' + esc(s.user_nom) + '</td><td class="r">' + F(s.fond_initial) + '</td><td class="r">' + (s.especes_attendues == null ? '—' : F(s.especes_attendues)) + '</td><td class="r">' + (s.especes_comptees == null ? '—' : F(s.especes_comptees)) + '</td><td class="r ' + (s.ecart ? 'bad' : 'ok') + '">' + (s.ecart == null ? 'en cours' : (s.ecart > 0 ? '+' : '') + F(s.ecart)) + '</td></tr>'
    })))
    return h
  }
}
ACT.ouvrirCaisse = function () { api('/api/caisse/ouvrir', { body: { fond: num('cs-fond') } }).then(function () { toast('Caisse ouverte'); chargerVue() }, function (e) { toast(e.message) }) }
ACT.mouvementCaisse = function () { api('/api/caisse/mouvement', { body: { type: val('mv-type'), montant: num('mv-mt'), motif: val('mv-motif') } }).then(function () { chargerVue() }, function (e) { toast(e.message) }) }
ACT.fermerCaisse = function () {
  if (val('cl-esp') === '') return toast('Saisis le montant compté')
  if (!confirm('Clôturer la caisse ?')) return
  api('/api/caisse/fermer', { body: { especes_comptees: num('cl-esp'), note: val('cl-note') } }).then(function (r) {
    S.caisse = null
    ouvrirModal({ titre: 'Caisse clôturée', corps: '<div class="grille kpis"><div class="kpi"><span>Attendu</span><b>' + F(r.especes_attendues) + '</b></div><div class="kpi"><span>Compté</span><b>' + F(r.especes_comptees) + '</b></div><div class="kpi"><span>Écart</span><b class="' + (r.ecart ? 'bad' : 'ok') + '">' + (r.ecart > 0 ? '+' : '') + F(r.ecart) + '</b></div></div>' + barres(r.par_mode, 'mode', 'montant'), actions: [{ l: 'Fermer', a: 'fermer', cls: 'p' }] })
    chargerVue()
  }, function (e) { toast(e.message) })
}
