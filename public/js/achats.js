'use strict'
// ───────── Achats : suggestions, commandes, réceptions, fournisseurs ─────────
var R = { fournisseur: '', commande: null, bl: '', echeance: '', lignes: [] }
var SUG = {}   // sélection des suggestions : produit_id -> { coche, qte, fournisseur }

VUES.achats = {
  titre: 'Achats',
  charger: function () {
    var t = tabCourant('achats', 'suggestions'), jobs = []
    if (!S.data.fournisseurs || t === 'fournisseurs') jobs.push(charge('fournisseurs', '/api/fournisseurs'))
    if (t === 'suggestions') jobs.push(charge('suggestions', '/api/commandes/suggestions'))
    if (t === 'commandes') jobs.push(charge('commandes', '/api/commandes'))
    if (t === 'receptions') jobs.push(charge('receptions', '/api/receptions'))
    return Promise.all(jobs)
  },
  html: function () {
    var t = tabCourant('achats', 'suggestions'), h = onglets('achats', [['suggestions', '💡 À commander'], ['commandes', 'Commandes'], ['receptions', 'Livraisons reçues'], ['fournisseurs', 'Fournisseurs']])
    var fours = S.data.fournisseurs || []
    if (t === 'suggestions') {
      var s = S.data.suggestions; if (!s) return h + '<p class="m">Chargement…</p>'
      if (!fours.length) return h + '<div class="alerte">Ajoute d\'abord tes fournisseurs (onglet « Fournisseurs »).</div>'
      s.forEach(function (l) { if (!SUG[l.produit_id]) SUG[l.produit_id] = { coche: true, qte: l.qte, fournisseur: l.fournisseur_id || '' } })
      var fo = function (cur) { return '<option value="">— choisir —</option>' + fours.map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === cur ? ' selected' : '') + '>' + esc(f.nom) + '</option>' }).join('') }
      return h + carte('Produits à recommander (' + s.length + ')', '<p class="m">Calculé d\'après le stock minimum, le stock maximum et les ventes des 30 derniers jours, en tenant compte des commandes déjà passées.</p>' + tableau([[''], ['Produit'], ['Stock', 'r'], ['Vendu 30 j', 'r'], ['En cours', 'r'], ['Qté', 'r'], ['Fournisseur']], s.map(function (l) {
        var x = SUG[l.produit_id]
        return '<tr><td><input type="checkbox" style="width:20px;min-height:0" data-c="sugcoche" data-id="' + esc(l.produit_id) + '"' + (x.coche ? ' checked' : '') + '></td><td>' + (l.urgent ? '<span class="puce rouge">rupture</span> ' : '') + esc(l.nom) + '</td><td class="r">' + l.stock + '</td><td class="r">' + l.vendu_30j + '</td><td class="r">' + (l.en_commande || '') + '</td><td class="r"><input type="number" min="1" value="' + x.qte + '" data-i="sugqte" data-id="' + esc(l.produit_id) + '" style="width:84px;text-align:right;min-height:34px;padding:4px 6px"></td><td><select data-c="sugfour" data-id="' + esc(l.produit_id) + '" style="min-height:34px;padding:4px">' + fo(x.fournisseur) + '</select></td></tr>'
      }), 'Rien à commander : le stock est suffisant.') + (s.length && !cloud() && peut('achats') ? '<button class="p" data-a="creerCommandes" style="margin-top:12px">Créer les commandes des lignes cochées</button>' : ''))
    }
    if (t === 'commandes') {
      var c = S.data.commandes; if (!c) return h + '<p class="m">Chargement…</p>'
      return h + carte('Commandes fournisseurs', tableau([['N°'], ['Date'], ['Fournisseur'], ['Lignes', 'r'], ['Estimé', 'r'], ['Statut']], c.map(function (x) {
        return '<tr class="clic" data-a="voirCommande" data-v="' + esc(x.id) + '"><td><b>' + esc(x.numero) + '</b></td><td>' + dt(x.created_at) + '</td><td>' + esc(x.fournisseur_nom) + '</td><td class="r">' + x.nb_lignes + '</td><td class="r">' + F(x.total_estime) + '</td><td>' + puceStatut(x.statut) + '</td></tr>'
      }), 'Aucune commande'), cloud() ? '' : '<button data-a="receptionLibre">+ Réception sans commande</button>')
    }
    if (t === 'receptions') {
      var r = S.data.receptions; if (!r) return h + '<p class="m">Chargement…</p>'
      var dette = r.reduce(function (s, x) { return s + x.reste }, 0)
      return h + '<div class="grille kpis" style="margin-bottom:14px"><div class="carte kpi"><span>Dettes fournisseurs</span><b class="' + (dette ? 'warn' : 'ok') + '">' + F(dette) + '</b></div></div>' + carte('Livraisons reçues', tableau([['N°'], ['Date'], ['Fournisseur'], ['BL'], ['Total', 'r'], ['Reste dû', 'r'], ['Échéance']], r.map(function (x) {
        return '<tr class="clic" data-a="voirReception" data-v="' + esc(x.id) + '"><td><b>' + esc(x.numero) + '</b></td><td>' + dt(x.created_at) + '</td><td>' + esc(x.fournisseur_nom) + '</td><td>' + esc(x.num_bl || '') + '</td><td class="r">' + F(x.total) + '</td><td class="r ' + (x.reste ? 'warn' : 'ok') + '">' + (x.reste ? F(x.reste) : 'payé') + '</td><td class="' + (x.reste && x.echeance < auj() ? 'bad' : '') + '">' + dj(x.echeance) + '</td></tr>'
      }), 'Aucune livraison'))
    }
    return h + (cloud() ? '' : carte('Nouveau fournisseur', '<div class="ligne-form">' + champ('Nom', 'f-nom') + champ('Téléphone (WhatsApp)', 'f-tel', { ph: '+22507…' }) + champ('Délai de livraison (jours)', 'f-delai', { type: 'number', val: 2 }) + '<button class="p" data-a="ajouterFournisseur">Ajouter</button></div>')) +
      carte('Fournisseurs', tableau([['Nom'], ['Téléphone'], ['Délai', 'r'], ['Dette', 'r']], fours.map(function (f) { return '<tr><td><b>' + esc(f.nom) + '</b></td><td>' + esc(f.telephone || '') + '</td><td class="r">' + f.delai_jours + ' j</td><td class="r ' + (f.dette ? 'warn' : '') + '">' + F(f.dette) + '</td></tr>' }), 'Aucun fournisseur'))
  }
}
function puceStatut(s) { return { envoyee: '<span class="puce bleu">envoyée</span>', recue_partielle: '<span class="puce off">reçue en partie</span>', recue: '<span class="puce">reçue</span>', annulee: '<span class="puce rouge">annulée</span>' }[s] || esc(s) }
INP.sugqte = function (v, el) { SUG[el.dataset.id].qte = Math.max(1, Number(v) || 1) }
INP.sugcoche = function (v, el) { SUG[el.dataset.id].coche = el.checked }
INP.sugfour = function (v, el) { SUG[el.dataset.id].fournisseur = v }
ACT.ajouterFournisseur = function () { api('/api/fournisseurs', { body: { nom: val('f-nom'), telephone: val('f-tel'), delai_jours: num('f-delai') } }).then(function () { S.data.fournisseurs = null; chargerVue() }, function (e) { toast(e.message) }) }
ACT.creerCommandes = function () {
  var groupes = {}, sans = 0
  ;(S.data.suggestions || []).forEach(function (l) {
    var x = SUG[l.produit_id]; if (!x || !x.coche) return
    if (!x.fournisseur) { sans++; return }
    ;(groupes[x.fournisseur] = groupes[x.fournisseur] || []).push({ produit_id: l.produit_id, qte: x.qte })
  })
  if (sans) return toast(sans + ' ligne(s) cochée(s) sans fournisseur : choisis-en un')
  var ids = Object.keys(groupes); if (!ids.length) return toast('Coche au moins une ligne')
  Promise.all(ids.map(function (f) { return api('/api/commandes', { body: { fournisseur_id: f, lignes: groupes[f] } }) })).then(function (r) {
    SUG = {}; S.tab.achats = 'commandes'; toast(r.length + ' commande(s) créée(s)'); chargerVue()
  }, function (e) { toast(e.message) })
}
function texteCommande(c) {
  return (S.etat && S.etat.officine ? S.etat.officine + '\n' : '') + 'Commande ' + c.numero + ' du ' + dj(c.created_at) + '\n\n' + c.lignes.map(function (l) { return '• ' + l.nom + ' × ' + l.qte_commandee }).join('\n') + '\n\nMerci de confirmer la disponibilité et le délai.'
}
ACT.voirCommande = function (id) {
  api('/api/commandes/' + id).then(function (c) {
    window.__cmd = c
    var tel = (c.fournisseur_tel || '').replace(/[^\d]/g, '')
    ouvrirModal({ titre: 'Commande ' + esc(c.numero) + ' — ' + esc(c.fournisseur_nom), large: true, corps: '<p>' + puceStatut(c.statut) + ' · créée le ' + dt(c.created_at) + ' · estimé <b>' + F(c.total_estime) + '</b></p>' + tableau([['Produit'], ['Commandé', 'r'], ['Reçu', 'r'], ['Prix achat', 'r']], c.lignes.map(function (l) { return '<tr><td>' + esc(l.nom) + '</td><td class="r">' + l.qte_commandee + '</td><td class="r ' + (l.qte_recue >= l.qte_commandee ? 'ok' : '') + '">' + l.qte_recue + '</td><td class="r">' + F(l.prix_achat) + '</td></tr>' })),
      actions: [{ l: 'Fermer', a: 'fermer' }, { l: '🖨 Imprimer', a: 'imprimerCommande' }, { l: '💬 WhatsApp', a: 'whatsappCommande', v: tel }].concat(c.statut === 'envoyee' && !cloud() ? [{ l: 'Annuler la commande', a: 'annulerCommande', v: c.id, cls: 'd' }] : []).concat((c.statut === 'envoyee' || c.statut === 'recue_partielle') && !cloud() ? [{ l: '📥 Recevoir la livraison', a: 'recevoirCommande', v: c.id, cls: 'p' }] : []) })
  }, function (e) { toast(e.message) })
}
ACT.imprimerCommande = function () { var c = window.__cmd; imprimer('<h3 style="text-align:center">Bon de commande ' + esc(c.numero) + '</h3><p>Fournisseur : ' + esc(c.fournisseur_nom) + '<br>Date : ' + dj(c.created_at) + '</p>' + '<table>' + c.lignes.map(function (l) { return '<tr><td>' + esc(l.nom) + '</td><td style="text-align:right">× ' + l.qte_commandee + '</td></tr>' }).join('') + '</table>') }
ACT.whatsappCommande = function (tel) { window.open('https://wa.me/' + (tel || '') + '?text=' + encodeURIComponent(texteCommande(window.__cmd)), '_blank') }
ACT.annulerCommande = function (id) { if (confirm('Annuler cette commande ?')) api('/api/commandes/' + id + '/annuler', { body: {} }).then(function () { fermerModal(); chargerVue() }, function (e) { toast(e.message) }) }

// ───────── Réception d'une livraison ─────────
ACT.recevoirCommande = function () {
  var c = window.__cmd
  R = { fournisseur: c.fournisseur_id, commande: c.id, bl: '', echeance: '', lignes: c.lignes.filter(function (l) { return l.qte_recue < l.qte_commandee }).map(function (l) { return { produit_id: l.produit_id, nom: l.nom, qte: l.qte_commandee - l.qte_recue, numero: '', peremption: '', prix_achat: l.prix_achat, prix_vente: '' } }) }
  formReception()
}
ACT.receptionLibre = function () { R = { fournisseur: '', commande: null, bl: '', echeance: '', lignes: [] }; formReception() }
function formReception() {
  var fours = S.data.fournisseurs || []
  var marges = peut('marges')
  ouvrirModal({ titre: 'Réception d\'une livraison', large: true, corps: '<div class="ligne-form">' + champ('Fournisseur', 'r-four', { opts: [['', '— choisir —']].concat(fours.map(function (f) { return [f.id, f.nom] })), val: R.fournisseur }) + champ('N° du bon de livraison', 'r-bl', { val: R.bl }) + champ('Échéance de paiement', 'r-ech', { type: 'date', val: R.echeance }) + '</div>' +
    (R.commande ? '' : '<label>Ajouter un produit</label><input id="r-q" data-i="rq" placeholder="Chercher le produit reçu…" autocomplete="off"><div id="r-res"></div>') +
    '<div id="r-zone"></div>', actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Enregistrer la réception', a: 'validerReception', cls: 'p' }] })
  majReception()
}
function majReception() {
  var z = $('#r-zone'); if (!z) return
  var total = R.lignes.reduce(function (s, l) { return s + (Number(l.qte) || 0) * (Number(l.prix_achat) || 0) }, 0)
  z.innerHTML = tableau([['Produit'], ['Qté', 'r'], ['N° de lot'], ['Péremption'], ['Prix achat', 'r'], ['Nouveau prix vente', 'r'], ['']], R.lignes.map(function (l, i) {
    var inp = function (k, t, w) { return '<input data-i="rl" data-k="' + k + '" data-idx="' + i + '" value="' + esc(l[k]) + '" ' + (t ? 'type="number" min="0" inputmode="numeric" ' : '') + 'style="width:' + w + 'px;min-height:34px;padding:4px 6px' + (t ? ';text-align:right' : '') + '">' }
    return '<tr><td>' + esc(l.nom) + '</td><td class="r">' + inp('qte', 1, 70) + '</td><td>' + inp('numero', 0, 100) + '</td><td><input data-i="rl" data-k="peremption" data-idx="' + i + '" value="' + esc(l.peremption) + '" placeholder="2027-06" style="width:96px;min-height:34px;padding:4px 6px"></td><td class="r">' + inp('prix_achat', 1, 90) + '</td><td class="r">' + inp('prix_vente', 1, 90) + '</td><td><button class="s d" data-a="rdel" data-v="' + i + '">✕</button></td></tr>'
  }), 'Ajoute les produits reçus') + '<div class="tot" style="margin-top:10px;font-size:18px"><span>Total de la livraison</span><b id="r-total">' + F(total) + '</b></div>'
}
INP.rl = function (v, el) { R.lignes[Number(el.dataset.idx)][el.dataset.k] = v; var t = $('#r-total'); if (t) t.textContent = F(R.lignes.reduce(function (s, l) { return s + (Number(l.qte) || 0) * (Number(l.prix_achat) || 0) }, 0)) }
ACT.rdel = function (i) { R.lignes.splice(Number(i), 1); majReception() }
INP.rq = function (v) {
  var z = $('#r-res'); if (!z) return
  var k = sansAccent(v)
  z.innerHTML = !k ? '' : S.catalogue.produits.filter(function (p) { return cle(p).indexOf(k) >= 0 }).slice(0, 6).map(function (p) { return '<div class="res" data-a="raj" data-v="' + esc(p.id) + '" style="grid-template-columns:1fr auto"><div class="nom">' + esc(p.nom) + '</div><small class="m">stock ' + p.stock + '</small></div>' }).join('')
}
ACT.raj = function (id) {
  var p = produit(id); if (!p || R.lignes.some(function (l) { return l.produit_id === id })) return
  R.lignes.push({ produit_id: id, nom: p.nom, qte: '', numero: '', peremption: '', prix_achat: '', prix_vente: '' })
  $('#r-q').value = ''; $('#r-res').innerHTML = ''; majReception()
}
ACT.validerReception = function () {
  R.fournisseur = val('r-four'); R.bl = val('r-bl'); R.echeance = val('r-ech')
  if (!R.fournisseur) return modalErr('Choisis le fournisseur')
  if (!R.lignes.length) return modalErr('Aucun produit dans la livraison')
  var bad = R.lignes.find(function (l) { return !(Number(l.qte) > 0) || !l.numero || !/^\d{4}-\d{2}(-\d{2})?$/.test(l.peremption) })
  if (bad) return modalErr('Complète pour « ' + bad.nom + ' » : quantité, n° de lot et péremption (AAAA-MM)')
  api('/api/receptions', { body: { fournisseur_id: R.fournisseur, commande_id: R.commande, num_bl: R.bl, echeance: R.echeance || undefined, lignes: R.lignes.map(function (l) { return { produit_id: l.produit_id, qte: Number(l.qte), numero: l.numero, peremption: l.peremption, prix_achat: Number(l.prix_achat) || 0, prix_vente: l.prix_vente === '' ? undefined : Number(l.prix_vente) } }) } }).then(function (r) {
    fermerModal(); toast('Livraison ' + r.numero + ' enregistrée · ' + F(r.total)); rafraichirCatalogue(); S.tab.achats = 'receptions'; chargerVue()
  }, function (e) { modalErr(e.message) })
}
ACT.voirReception = function (id) {
  api('/api/receptions/' + id).then(function (r) {
    ouvrirModal({ titre: 'Livraison ' + esc(r.numero) + ' — ' + esc(r.fournisseur_nom), large: true, corps: '<div class="grille kpis"><div class="kpi"><span>Total</span><b>' + F(r.total) + '</b></div><div class="kpi"><span>Payé</span><b>' + F(r.paye) + '</b></div><div class="kpi"><span>Reste dû</span><b class="' + (r.total > r.paye ? 'warn' : 'ok') + '">' + F(r.total - r.paye) + '</b></div></div>' +
      tableau([['Produit'], ['Lot'], ['Péremption'], ['Qté', 'r'], ['Prix achat', 'r']], r.lignes.map(function (l) { return '<tr><td>' + esc(l.nom) + '</td><td>' + esc(l.lot_numero) + '</td><td>' + dj(l.peremption) + '</td><td class="r">' + l.qte + '</td><td class="r">' + F(l.prix_achat) + '</td></tr>' })) +
      (r.paiements.length ? '<h3 style="margin-top:12px">Paiements</h3>' + tableau([['Date'], ['Mode'], ['Montant', 'r']], r.paiements.map(function (p) { return '<tr><td>' + dt(p.created_at) + '</td><td>' + esc(p.mode) + '</td><td class="r">' + F(p.montant) + '</td></tr>' })) : '') +
      (r.total > r.paye && !cloud() ? '<div class="ligne-form" style="margin-top:12px">' + champ('Montant payé', 'fp-m', { type: 'number', val: r.total - r.paye }) + champ('Mode', 'fp-mode', { opts: [['especes', 'Espèces'], ['virement', 'Virement'], ['cheque', 'Chèque'], ['mobile', 'Mobile money']] }) + '<button class="p" data-a="payerFournisseur" data-v="' + esc(r.id) + '">Enregistrer le paiement</button></div>' : ''), actions: [{ l: 'Fermer', a: 'fermer' }] })
  }, function (e) { toast(e.message) })
}
ACT.payerFournisseur = function (id) { api('/api/receptions/' + id + '/payer', { body: { montant: num('fp-m'), mode: val('fp-mode') } }).then(function () { fermerModal(); toast('Paiement enregistré'); chargerVue() }, function (e) { modalErr(e.message) }) }
