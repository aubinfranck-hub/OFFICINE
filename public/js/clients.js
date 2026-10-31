'use strict'
// ───────── Clients, crédit (ardoise) et fidélité ─────────
VUES.clients = {
  titre: 'Clients',
  charger: function () { var f = S.data.cf || (S.data.cf = { q: '', dette: '' }); return Promise.all([charge('clients', '/api/clients?' + qs(f)), charge('organismes', '/api/organismes')]) },
  html: function () {
    var f = S.data.cf || { q: '', dette: '' }, l = S.data.clients || []
    var dus = l.reduce(function (s, c) { return s + c.solde }, 0)
    return '<div class="carte"><div class="ligne-form"><div style="flex:2"><label>Recherche</label><input id="cq" data-i="cq" value="' + esc(f.q) + '" placeholder="Nom ou téléphone" autocomplete="off"></div>' + champ('Affichage', 'cdette', { opts: [['', 'Tous les clients'], ['1', 'Qui doivent de l\'argent']], val: f.dette }) + (!cloud() && peut('clients') ? '<button class="p" data-a="nouveauClient">+ Nouveau client</button>' : '') + '</div></div>' +
      '<div class="grille kpis" style="margin-bottom:14px"><div class="carte kpi"><span>Clients affichés</span><b>' + l.length + '</b></div><div class="carte kpi"><span>Dettes (ardoise)</span><b class="' + (dus ? 'warn' : 'ok') + '">' + F(dus) + '</b></div></div>' +
      carte('Clients', tableau([['Nom'], ['Téléphone'], ['Tiers payant'], ['Points', 'r'], ['Doit', 'r']], l.map(function (c) { return '<tr class="clic" data-a="ficheClient" data-v="' + esc(c.id) + '"><td><b>' + esc(c.nom) + '</b></td><td>' + esc(c.telephone || '') + '</td><td>' + esc(c.organisme_nom || '') + (c.num_adherent ? '<br><small class="m">' + esc(c.num_adherent) + '</small>' : '') + '</td><td class="r">' + c.points + '</td><td class="r ' + (c.solde ? 'bad' : '') + '">' + (c.solde ? F(c.solde) : '—') + '</td></tr>' }), 'Aucun client'))
  }
}
var minuteurC
INP.cq = function (v) { S.data.cf.q = v; clearTimeout(minuteurC); minuteurC = setTimeout(function () { charge('clients', '/api/clients?' + qs(S.data.cf)).then(rendre) }, 250) }
INP.cdette = function (v) { S.data.cf.dette = v; chargerVue() }
function formClient(c) {
  c = c || {}
  var orgs = S.data.organismes || S.catalogue.organismes || []
  return '<div class="ligne-form">' + champ('Nom', 'c-nom', { val: c.nom, af: 1 }) + champ('Téléphone', 'c-tel', { val: c.telephone }) + '</div><div class="ligne-form">' + champ('Organisme (tiers payant)', 'c-org', { opts: [['', 'Aucun']].concat(orgs.filter(function (o) { return o.actif !== 0 }).map(function (o) { return [o.id, o.nom + ' (' + o.taux + ' %)'] })), val: c.organisme_id }) + champ('N° adhérent', 'c-adh', { val: c.num_adherent }) + '</div>' + champ('Notes (allergies connues, remarques…)', 'c-notes', { val: c.notes })
}
ACT.nouveauClient = function () { ouvrirModal({ titre: 'Nouveau client', corps: formClient(), actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Enregistrer', a: 'sauverClient', cls: 'p' }] }) }
ACT.sauverClient = function (id) {
  if (!val('c-nom')) return modalErr('Le nom est obligatoire')
  api('/api/clients', { body: { id: id || undefined, nom: val('c-nom'), telephone: val('c-tel'), organisme_id: val('c-org') || null, num_adherent: val('c-adh'), notes: val('c-notes') } }).then(function () { fermerModal(); toast('Client enregistré'); rafraichirCatalogue(); chargerVue() }, function (e) { modalErr(e.message) })
}
ACT.ficheClient = function (id) {
  api('/api/clients/' + id).then(function (c) {
    window.__client = c
    ouvrirModal({ titre: esc(c.nom), large: true, corps: '<div class="grille kpis" style="margin-bottom:12px"><div class="kpi"><span>Doit</span><b class="' + (c.solde ? 'bad' : 'ok') + '">' + F(c.solde) + '</b></div><div class="kpi"><span>Points fidélité</span><b>' + c.points + '</b><small>1 point par 1 000 F</small></div><div class="kpi"><span>Téléphone</span><b style="font-size:17px">' + esc(c.telephone || '—') + '</b></div><div class="kpi"><span>Tiers payant</span><b style="font-size:17px">' + esc(c.organisme_nom || '—') + '</b><small>' + esc(c.num_adherent || '') + '</small></div></div>' + (c.notes ? '<p>📝 ' + esc(c.notes) + '</p>' : '') +
      (c.solde > 0 && !cloud() && peut('caisse') ? '<div class="carte"><h3>Encaisser un règlement</h3><div class="ligne-form">' + champ('Montant', 'rg-m', { type: 'number', val: c.solde }) + champ('Mode', 'rg-mode', { opts: [['especes', 'Espèces'], ['wave', 'Wave'], ['orange', 'Orange Money'], ['mtn', 'MTN Money'], ['moov', 'Moov Money'], ['cheque', 'Chèque']] }) + '<button class="p" data-a="reglerClient" data-v="' + esc(c.id) + '">Encaisser</button></div></div>' : '') +
      '<h3>Derniers achats</h3>' + tableau([['N°'], ['Date'], ['Total', 'r'], ['Payé', 'r'], ['À crédit', 'r']], c.ventes.map(function (v) { return '<tr><td>' + esc(v.numero) + '</td><td>' + dt(v.created_at) + '</td><td class="r">' + F(v.total - v.remise) + '</td><td class="r">' + F(v.part_patient) + '</td><td class="r ' + (v.credit ? 'warn' : '') + '">' + (v.credit ? F(v.credit) : '') + '</td></tr>' }), 'Aucun achat') +
      (c.reglements.length ? '<h3 style="margin-top:12px">Règlements reçus</h3>' + tableau([['Date'], ['Mode'], ['Montant', 'r']], c.reglements.map(function (r) { return '<tr><td>' + dt(r.created_at) + '</td><td>' + esc(MODES[r.mode] || r.mode) + '</td><td class="r">' + F(r.montant) + '</td></tr>' })) : ''),
      actions: [{ l: 'Fermer', a: 'fermer' }].concat(!cloud() && peut('clients') ? [{ l: '✏ Modifier', a: 'modifierClient', v: c.id }] : []) })
  }, function (e) { toast(e.message) })
}
ACT.modifierClient = function () { var c = window.__client; ouvrirModal({ titre: 'Modifier ' + esc(c.nom), corps: formClient(c), actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Enregistrer', a: 'sauverClient', v: c.id, cls: 'p' }] }) }
ACT.reglerClient = function (id) { api('/api/clients/' + id + '/reglement', { body: { montant: num('rg-m'), mode: val('rg-mode') } }).then(function (r) { fermerModal(); toast('Règlement enregistré · reste ' + F(r.solde)); rafraichirCatalogue(); chargerVue() }, function (e) { modalErr(e.message) }) }

// ───────── Tiers payant par assureur : conditions, bordereaux, relevés et retards ─────────
VUES.tierspayant = {
  titre: 'Tiers payant',
  charger: function () {
    var t = tabCourant('tierspayant', 'afacturer')
    if (t === 'afacturer') return charge('tp', '/api/tiers-payant')
    if (t === 'bordereaux') return charge('bordereaux', '/api/bordereaux')
    return charge('organismes', '/api/organismes')
  },
  html: function () {
    var t = tabCourant('tierspayant', 'afacturer'), h = onglets('tierspayant', [['afacturer', 'À facturer'], ['bordereaux', 'Bordereaux'], ['organismes', 'Assureurs et conditions']])
    if (t === 'afacturer') {
      var d = S.data.tp; if (!d) return h + '<p class="m">Chargement…</p>'
      var total = d.a_facturer.reduce(function (s, x) { return s + x.montant }, 0), imp = d.impayes.reduce(function (s, x) { return s + x.total }, 0), echu = d.impayes.filter(function (b) { return b.echu }).reduce(function (s, x) { return s + x.total }, 0)
      return h + '<div class="grille kpis" style="margin-bottom:14px"><div class="carte kpi"><span>À facturer</span><b>' + F(total) + '</b></div><div class="carte kpi"><span>Facturé, pas encore payé</span><b class="' + (imp ? 'warn' : 'ok') + '">' + F(imp) + '</b></div><div class="carte kpi"><span>Dont en retard</span><b class="' + (echu ? 'bad' : 'ok') + '">' + F(echu) + '</b></div><div class="carte kpi"><span>Encaissé (30 jours)</span><b class="ok">' + F(d.encaisse_30j) + '</b></div></div>' +
        carte('Parts des assureurs à facturer', tableau([['Assureur'], ['Ventes', 'r'], ['Depuis'], ['Montant', 'r'], ['']], d.a_facturer.map(function (x) { return '<tr><td><b>' + esc(x.nom) + '</b> <small class="m">' + x.taux + ' %</small></td><td class="r">' + x.nb_ventes + '</td><td>' + dj(x.depuis) + '</td><td class="r"><b>' + F(x.montant) + '</b></td><td style="white-space:nowrap">' + (cloud() ? '' : '<button class="s p" data-a="nouveauBordereau" data-v="' + esc(x.organisme_id) + '" data-n="' + esc(x.nom) + '" data-d="' + x.depuis + '">Faire le bordereau</button> ') + '<button class="s" data-a="releveOrganisme" data-v="' + esc(x.organisme_id) + '">Relevé</button></td></tr>' }), 'Rien à facturer')) +
        (d.impayes.length ? carte('Bordereaux en attente de paiement', tableau([['N°'], ['Assureur'], ['Période'], ['Échéance'], ['Montant', 'r']], d.impayes.map(function (b) { return '<tr class="clic" data-a="voirBordereau" data-v="' + esc(b.id) + '"><td><b>' + esc(b.numero) + '</b></td><td>' + esc(b.organisme_nom) + '</td><td>' + dj(b.du) + ' → ' + dj(b.au) + '</td><td>' + (b.echu ? '<span class="puce rouge">en retard · ' + dj(b.echeance) + '</span>' : dj(b.echeance)) + '</td><td class="r">' + F(b.total) + '</td></tr>' }))) : '')
    }
    if (t === 'bordereaux') {
      var b = S.data.bordereaux; if (!b) return h + '<p class="m">Chargement…</p>'
      return h + carte('Bordereaux', tableau([['N°'], ['Date'], ['Assureur'], ['Ventes', 'r'], ['Montant', 'r'], ['Échéance'], ['Statut']], b.map(function (x) { return '<tr class="clic" data-a="voirBordereau" data-v="' + esc(x.id) + '"><td><b>' + esc(x.numero) + '</b></td><td>' + dj(x.created_at) + '</td><td>' + esc(x.organisme_nom) + '</td><td class="r">' + x.nb_ventes + '</td><td class="r">' + F(x.total) + '</td><td>' + dj(x.echeance) + '</td><td>' + (x.statut === 'paye' ? '<span class="puce">payé ' + dj(x.paye_le) + '</span>' : (x.echeance && x.echeance < auj() ? '<span class="puce rouge">en retard</span>' : '<span class="puce off">en attente</span>')) + '</td></tr>' }), 'Aucun bordereau'))
    }
    var o = S.data.organismes; if (!o) return h + '<p class="m">Chargement…</p>'
    return h + '<p class="m">Chaque assureur a ses propres conditions : taux de prise en charge, plafond par vente, n° d\'adhérent obligatoire ou non, délai de paiement. Les produits « non remboursables » (parapharmacie…) restent à la charge du patient. C\'est toi qui fixes ces conditions ; le logiciel ne les impose pas.</p>' +
      (cloud() ? '' : carte('Ajouter un assureur', formOrganisme('oa', { taux: 80, delai_paiement: 30 }) + '<button class="p" data-a="ajouterOrganisme" style="margin-top:12px">Ajouter</button>')) +
      carte('Assureurs', tableau([['Assureur'], ['Prise en charge', 'r'], ['Plafond / vente', 'r'], ['N° adhérent'], ['Paiement sous', 'r'], ['']], o.map(function (x) {
        return '<tr><td>' + esc(x.nom) + (x.actif ? '' : ' <span class="puce rouge">désactivé</span>') + '</td><td class="r">' + x.taux + ' %</td><td class="r">' + (x.plafond ? F(x.plafond) : '—') + '</td><td>' + (x.adherent_obligatoire ? 'obligatoire' : 'facultatif') + '</td><td class="r">' + x.delai_paiement + ' j</td><td style="white-space:nowrap"><button class="s" data-a="releveOrganisme" data-v="' + esc(x.id) + '">Relevé</button>' + (cloud() ? '' : ' <button class="s" data-a="modifierOrganisme" data-v="' + esc(x.id) + '">Modifier</button>') + '</td></tr>'
      })))
  }
}
function formOrganisme(pre, o) {
  o = o || {}
  return '<div class="ligne-form">' + champ('Nom de l\'assureur', pre + '-nom', { val: o.nom }) + champ('Prise en charge (%)', pre + '-taux', { type: 'number', val: o.taux }) + champ('Plafond par vente (F, 0 = aucun)', pre + '-plafond', { type: 'number', val: o.plafond || 0 }) + champ('Paiement sous (jours)', pre + '-delai', { type: 'number', val: o.delai_paiement == null ? 30 : o.delai_paiement }) + '</div>' +
    '<div class="ligne-form">' + champ('N° d\'adhérent obligatoire pour vendre', pre + '-adh', { type: 'check', val: o.adherent_obligatoire }) + (o.id ? champ('Assureur actif', pre + '-actif', { type: 'check', val: o.actif }) : '') + '</div>'
}
function lireOrganisme(pre) { return { nom: val(pre + '-nom'), taux: num(pre + '-taux'), plafond: num(pre + '-plafond'), delai_paiement: num(pre + '-delai'), adherent_obligatoire: chk(pre + '-adh') } }
ACT.ajouterOrganisme = function () { api('/api/organismes', { body: lireOrganisme('oa') }).then(function () { toast('Assureur ajouté'); rafraichirCatalogue(); chargerVue() }, function (e) { toast(e.message) }) }
ACT.modifierOrganisme = function (id) {
  var o = (S.data.organismes || []).find(function (x) { return x.id === id }); if (!o) return
  ouvrirModal({ titre: 'Conditions de ' + esc(o.nom), corps: formOrganisme('oe', o), actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Enregistrer', a: 'sauverOrganisme', v: id, cls: 'p' }] })
}
ACT.sauverOrganisme = function (id) { var b = lireOrganisme('oe'); b.id = id; b.actif = chk('oe-actif'); api('/api/organismes', { body: b }).then(function () { fermerModal(); toast('Conditions enregistrées'); rafraichirCatalogue(); chargerVue() }, function (e) { modalErr(e.message) }) }
ACT.releveOrganisme = function (id) {
  api('/api/tiers-payant/releve?organisme_id=' + id).then(function (r) {
    window.__releve = r
    var o = r.organisme
    ouvrirModal({ titre: 'Relevé — ' + esc(o.nom), large: true, corps: '<p class="m">Prise en charge <b>' + o.taux + ' %</b>' + (o.plafond ? ' · plafond <b>' + F(o.plafond) + '</b> par vente' : '') + ' · n° d\'adhérent ' + (o.adherent_obligatoire ? '<b>obligatoire</b>' : 'facultatif') + ' · paiement sous <b>' + o.delai_paiement + ' jours</b></p>' +
      '<div class="grille kpis" style="margin:10px 0"><div class="kpi"><span>Pas encore facturé</span><b>' + F(r.a_facturer.m) + '</b><small>' + r.a_facturer.nb + ' vente(s)</small></div><div class="kpi"><span>Facturé, à encaisser</span><b class="' + (r.total_du ? 'warn' : 'ok') + '">' + F(r.total_du) + '</b></div><div class="kpi"><span>Dont en retard</span><b class="' + (r.total_echu ? 'bad' : 'ok') + '">' + F(r.total_echu) + '</b></div><div class="kpi"><span>Délai moyen de paiement</span><b>' + (r.delai_moyen_paiement == null ? '—' : r.delai_moyen_paiement + ' j') + '</b></div></div>' +
      tableau([['Bordereau'], ['Date'], ['Période'], ['Échéance'], ['Montant', 'r'], ['Statut']], r.bordereaux.map(function (b) { return '<tr><td><b>' + esc(b.numero) + '</b></td><td>' + dj(b.created_at) + '</td><td>' + dj(b.du) + ' → ' + dj(b.au) + '</td><td>' + dj(b.echeance) + '</td><td class="r">' + F(b.total) + '</td><td>' + (b.statut === 'paye' ? '<span class="puce">payé ' + dj(b.paye_le) + '</span>' : (b.retard > 0 ? '<span class="puce rouge">retard de ' + b.retard + ' j</span>' : '<span class="puce off">en attente</span>')) + '</td></tr>' }), 'Aucun bordereau émis'),
      actions: [{ l: 'Fermer', a: 'fermer' }, { l: '🖨 Imprimer le relevé', a: 'imprimerReleve', cls: 'p' }] })
  }, function (e) { toast(e.message) })
}
ACT.imprimerReleve = function () {
  var r = window.__releve, o = r.organisme
  imprimer('<h3 style="text-align:center">' + esc((S.etat && S.etat.officine) || '') + '</h3><h3 style="text-align:center">Relevé — ' + esc(o.nom) + '</h3><p>Édité le ' + dj(auj()) + '<br>À facturer : ' + N(r.a_facturer.m) + ' F · Facturé à encaisser : ' + N(r.total_du) + ' F · Dont en retard : ' + N(r.total_echu) + ' F</p><table>' +
    r.bordereaux.map(function (b) { return '<tr><td>' + esc(b.numero) + '</td><td>éch. ' + dj(b.echeance) + '</td><td>' + (b.statut === 'paye' ? 'payé' : (b.retard > 0 ? 'retard ' + b.retard + ' j' : 'en attente')) + '</td><td style="text-align:right">' + N(b.total) + '</td></tr>' }).join('') + '</table>')
}
ACT.nouveauBordereau = function (id, el) {
  window.__bord = { id: id, nom: el.dataset.n }
  ouvrirModal({ titre: 'Bordereau — ' + esc(el.dataset.n), large: true, corps: '<div class="ligne-form">' + champ('Du', 'b-du', { type: 'date', val: el.dataset.d }) + champ('Au', 'b-au', { type: 'date', val: auj() }) + '<button data-a="apercuBordereau">Actualiser</button></div><div id="b-apercu"></div>', actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Créer le bordereau', a: 'creerBordereau', cls: 'p' }] })
  ACT.apercuBordereau()
}
ACT.apercuBordereau = function () {
  api('/api/tiers-payant/ventes?' + qs({ organisme_id: window.__bord.id, du: val('b-du'), au: val('b-au') })).then(function (l) {
    var z = $('#b-apercu'); if (z) z.innerHTML = '<p><b>' + l.length + '</b> vente(s) · part de l\'assureur : <b>' + F(l.reduce(function (s, v) { return s + v.part_organisme }, 0)) + '</b></p>' + tableau([['N°'], ['Date'], ['Patient'], ['N° adhérent'], ['Ordonnance'], ['Total', 'r'], ['Part assureur', 'r']], l.map(function (v) { return '<tr><td>' + esc(v.numero) + '</td><td>' + dj(v.created_at) + '</td><td>' + esc(v.client_nom || '') + '</td><td>' + esc(v.num_adherent || '') + '</td><td>' + esc(v.num_ordonnance || '') + '</td><td class="r">' + F(v.total - v.remise) + '</td><td class="r"><b>' + F(v.part_organisme) + '</b></td></tr>' }))
  }, function (e) { modalErr(e.message) })
}
ACT.creerBordereau = function () {
  api('/api/bordereaux', { body: { organisme_id: window.__bord.id, du: val('b-du'), au: val('b-au') } }).then(function (r) { fermerModal(); toast('Bordereau ' + r.numero + ' · ' + F(r.total)); ACT.voirBordereau(r.id); S.tab.tierspayant = 'bordereaux'; chargerVue() }, function (e) { modalErr(e.message) })
}
ACT.voirBordereau = function (id) {
  api('/api/bordereaux/' + id).then(function (b) {
    window.__bordereau = b
    ouvrirModal({ titre: 'Bordereau ' + esc(b.numero), large: true, corps: '<p><b>' + esc(b.organisme_nom) + '</b> · du ' + dj(b.du) + ' au ' + dj(b.au) + ' · <b>' + F(b.total) + '</b> · à payer avant le <b>' + dj(b.echeance) + '</b> ' + (b.statut === 'paye' ? '<span class="puce">payé le ' + dj(b.paye_le) + '</span>' : '<span class="puce off">en attente de paiement</span>') + '</p>' + tableau([['N°'], ['Date'], ['Patient'], ['N° adhérent'], ['Ordonnance'], ['Part assureur', 'r']], b.ventes.map(function (v) { return '<tr><td>' + esc(v.numero) + '</td><td>' + dj(v.created_at) + '</td><td>' + esc(v.client_nom || '') + '</td><td>' + esc(v.num_adherent || '') + '</td><td>' + esc(v.num_ordonnance || '') + '</td><td class="r">' + F(v.part_organisme) + '</td></tr>' })),
      actions: [{ l: 'Fermer', a: 'fermer' }, { l: '🖨 Imprimer', a: 'imprimerBordereau' }].concat(b.statut === 'emis' && !cloud() ? [{ l: '✔ Marquer comme payé', a: 'payerBordereau', v: b.id, cls: 'p' }] : []) })
  }, function (e) { toast(e.message) })
}
ACT.imprimerBordereau = function () {
  var b = window.__bordereau
  imprimer('<h3 style="text-align:center">' + esc((S.etat && S.etat.officine) || '') + '</h3><h3 style="text-align:center">Bordereau ' + esc(b.numero) + '</h3><p>Assureur : <b>' + esc(b.organisme_nom) + '</b><br>Période : ' + dj(b.du) + ' au ' + dj(b.au) + '<br>À payer avant le ' + dj(b.echeance) + '</p><table>' + b.ventes.map(function (v) { return '<tr><td>' + esc(v.numero) + '</td><td>' + esc(v.client_nom || '') + '</td><td>' + esc(v.num_adherent || '') + '</td><td style="text-align:right">' + N(v.part_organisme) + '</td></tr>' }).join('') + '</table><hr><p style="text-align:right"><b>TOTAL ' + N(b.total) + ' F</b></p>')
}
ACT.payerBordereau = function (id) { if (confirm('Confirmer que cet assureur a payé ce bordereau ?')) api('/api/bordereaux/' + id + '/payer', { body: {} }).then(function () { fermerModal(); chargerVue() }, function (e) { toast(e.message) }) }
