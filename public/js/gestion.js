'use strict'
// ───────── Produits : fiche, création, import, équivalents ─────────
var FAMILLES_DEFAUT = ['Antalgiques', 'Antibiotiques', 'Antipaludiques', 'Cardiologie', 'Diabétologie', 'Gastro-entérologie', 'Vitamines', 'Dermatologie', 'Pédiatrie', 'Allergologie', 'Antiparasitaires', 'Hygiène et soins', 'Parapharmacie', 'Psychotropes et stupéfiants']

VUES.produits = {
  titre: 'Produits',
  charger: function () {
    var f = S.data.pf || (S.data.pf = { q: '', famille: '', filtre: '' })
    var jobs = [charge('produits', '/api/produits?' + qs(f)), charge('familles', '/api/familles')]
    if (peut('achats') && !S.data.fournisseurs) jobs.push(charge('fournisseurs', '/api/fournisseurs'))
    return Promise.all(jobs)
  },
  html: function () {
    var f = S.data.pf || { q: '', famille: '', filtre: '' }, l = S.data.produits || []
    var fams = [''].concat(S.data.familles || [])
    var barre = '<div class="carte"><div class="ligne-form"><div style="flex:2">' + '<label>Recherche</label><input id="pq" data-i="pq" value="' + esc(f.q) + '" placeholder="Nom, DCI ou code-barres" autocomplete="off"></div>' +
      champ('Famille', 'pfam', { opts: fams.map(function (x) { return [x, x || 'Toutes'] }), val: f.famille }) + champ('Filtre', 'pfil', { opts: [['', 'Tous les produits'], ['rupture', 'En rupture'], ['bas', 'Stock bas'], ['stup', 'Stupéfiants'], ['ordonnance', 'Sur ordonnance'], ['inactif', 'Désactivés']], val: f.filtre }) +
      (peut('produits') && !cloud() ? '<button class="p" data-a="nouveauProduit">+ Nouveau produit</button><button data-a="importProduits">📥 Importer</button>' : '') + (peut('produits') ? '<button data-a="exportCatalogue">⬇ Exporter (Excel)</button>' : '') + '</div></div>'
    var marges = peut('marges')
    var lignes = l.map(function (p) {
      var marge = marges && p.prix_achat > 0 ? Math.round((p.prix - p.prix_achat) / p.prix * 100) + ' %' : ''
      return '<tr class="clic" data-a="fiche" data-v="' + esc(p.id) + '"><td><b>' + esc(p.nom) + '</b>' + tags(p) + '<br><small class="m">' + [p.dosage, p.forme, p.dci].filter(Boolean).map(esc).join(' · ') + '</small></td><td>' + esc(p.famille || '') + '</td><td class="r"><b>' + F(p.prix) + '</b></td>' + (marges ? '<td class="r"><small>' + (p.prix_achat ? F(p.prix_achat) : '—') + '</small><br><small class="m">' + marge + '</small></td>' : '') + '<td class="c">' + stk(p.stock, p.seuil) + '</td><td>' + esc(p.emplacement || '') + '</td></tr>'
    })
    return barre + carte(l.length + (l.length === 200 ? '+' : '') + ' produit(s)', tableau([['Produit'], ['Famille'], ['Prix', 'r']].concat(marges ? [['Achat / marge', 'r']] : []).concat([['Stock', 'c'], ['Empl.']]), lignes, 'Aucun produit : ajoute-en ou importe ton catalogue.'))
  }
}
var minuteurP
INP.pq = function (v) { S.data.pf.q = v; clearTimeout(minuteurP); minuteurP = setTimeout(function () { charge('produits', '/api/produits?' + qs(S.data.pf)).then(rendre) }, 250) }
INP.pfam = function (v) { S.data.pf.famille = v; chargerVue() }
INP.pfil = function (v) { S.data.pf.filtre = v; chargerVue() }

ACT.fiche = function (id) {
  api('/api/produits/' + id).then(function (p) {
    var marges = peut('marges'), ed = peut('stock') && !cloud()
    var corps = '<div class="grille kpis" style="margin-bottom:12px"><div class="kpi"><span>Prix de vente</span><b>' + F(p.prix) + '</b></div>' + (marges ? '<div class="kpi"><span>Prix d\'achat</span><b>' + F(p.prix_achat) + '</b>' + (p.prix_achat ? '<small class="ok">marge ' + Math.round((p.prix - p.prix_achat) / p.prix * 100) + ' %</small>' : '') + '</div>' : '') + '<div class="kpi"><span>En stock</span><b>' + p.stock + '</b><small>min ' + p.seuil + (p.stock_max ? ' · max ' + p.stock_max : '') + '</small></div><div class="kpi"><span>Vendus (30 j)</span><b>' + p.vendu_30j + '</b></div></div>' +
      '<p>' + [p.code && '🔖 ' + esc(p.code), p.dci && 'DCI : ' + esc(p.dci), p.dosage, p.forme, p.labo && 'Labo ' + esc(p.labo), p.emplacement && '📍 ' + esc(p.emplacement)].filter(Boolean).join(' · ') + ' ' + tags(p) + '</p>' +
      '<h3>Lots en stock (premier périmé, premier sorti)</h3>' + tableau([['Lot'], ['Péremption'], ['Qté', 'r']].concat(ed ? [['']] : []), p.lots.map(function (l) {
        var per = l.peremption < auj() ? 'bad' : l.peremption < ilya(-90) ? 'warn' : ''
        return '<tr><td>' + esc(l.numero) + '</td><td class="' + per + '">' + dj(l.peremption) + (per === 'bad' ? ' (périmé)' : '') + '</td><td class="r">' + l.qte + '</td>' + (ed ? '<td class="r" style="white-space:nowrap"><button class="s" data-a="ajusterLot" data-v="' + esc(l.id) + '" data-n="' + esc(p.nom + ' — lot ' + l.numero) + '">Ajuster</button> <button class="s d" data-a="perteLot" data-v="' + esc(l.id) + '" data-n="' + esc(p.nom + ' — lot ' + l.numero) + '" data-q="' + l.qte + '">Perte</button></td>' : '') + '</tr>'
      }), 'Aucun stock') +
      (p.substituts.length ? '<h3 style="margin-top:14px">Équivalents (même DCI)</h3>' + tableau([['Produit'], ['Prix', 'r'], ['Stock', 'c']], p.substituts.map(function (x) { return '<tr class="clic" data-a="fiche" data-v="' + esc(x.id) + '"><td>' + esc(x.nom) + tags(x) + '</td><td class="r">' + F(x.prix) + '</td><td class="c">' + stk(x.stock) + '</td></tr>' })) : '') +
      '<h3 style="margin-top:14px">Derniers mouvements</h3>' + tableau([['Date'], ['Type'], ['Lot'], ['Qté', 'r'], ['Réf.']], p.mouvements.map(function (m) { return '<tr><td>' + dt(m.created_at) + '</td><td>' + esc(m.type) + '</td><td>' + esc(m.lot || '') + '</td><td class="r ' + (m.qte < 0 ? 'bad' : 'ok') + '">' + (m.qte > 0 ? '+' : '') + m.qte + '</td><td><small>' + esc(m.ref || '') + '</small></td></tr>' }), 'Aucun mouvement')
    ouvrirModal({ titre: esc(p.nom), large: true, corps: corps, actions: (peut('produits') && !cloud() ? [{ l: '✏ Modifier la fiche', a: 'modifierProduit', v: p.id }] : []).concat([{ l: 'Fermer', a: 'fermer' }]) })
    window.__fiche = p
  }, function (e) { toast(e.message) })
}
function formProduit(p) {
  p = p || {}
  var fams = (S.data.familles && S.data.familles.length ? S.data.familles : FAMILLES_DEFAUT)
  if (p.famille && fams.indexOf(p.famille) < 0) fams = fams.concat([p.famille])
  var marges = peut('marges')
  var fours = [['', '—']].concat((S.data.fournisseurs || []).map(function (f) { return [f.id, f.nom] }))
  return '<div class="ligne-form">' + champ('Nom commercial', 'p-nom', { val: p.nom, af: 1 }) + champ('Code-barres / CIP', 'p-code', { val: p.code }) + '</div>' +
    '<div class="ligne-form">' + champ('DCI (molécule)', 'p-dci', { val: p.dci }) + champ('Dosage', 'p-dosage', { val: p.dosage, ph: '500 mg' }) + champ('Forme', 'p-forme', { val: p.forme, ph: 'comprimé' }) + '</div>' +
    '<div class="ligne-form">' + champ('Famille', 'p-fam', { opts: [['', '—']].concat(fams.map(function (f) { return [f, f] })), val: p.famille }) + champ('Laboratoire', 'p-labo', { val: p.labo }) + champ('Emplacement', 'p-empl', { val: p.emplacement, ph: 'A1' }) + '</div>' +
    '<div class="ligne-form">' + champ('Prix de vente (F)', 'p-prix', { type: 'number', val: p.prix }) + (marges ? champ('Prix d\'achat (F)', 'p-pa', { type: 'number', val: p.prix_achat }) : '') + champ('Stock minimum', 'p-seuil', { type: 'number', val: p.seuil == null ? 5 : p.seuil }) + champ('Stock maximum', 'p-max', { type: 'number', val: p.stock_max }) + '</div>' +
    (peut('achats') ? '<div class="ligne-form">' + champ('Fournisseur habituel', 'p-four', { opts: fours, val: p.fournisseur_id }) + '</div>' : '') +
    '<div class="ligne-form" style="margin-top:8px">' + champ('Sur ordonnance', 'p-ordo', { type: 'check', val: p.ordonnance }) + champ('Stupéfiant / psychotrope (registre)', 'p-stup', { type: 'check', val: p.stupefiant }) + champ('Générique', 'p-gen', { type: 'check', val: p.generique }) + champ('Remboursable par les organismes', 'p-remb', { type: 'check', val: p.remboursable == null ? 1 : p.remboursable }) + (p.id ? champ('Produit actif', 'p-actif', { type: 'check', val: p.actif == null ? 1 : p.actif }) : '') + '</div>'
}
ACT.nouveauProduit = function () { ouvrirModal({ titre: 'Nouveau produit', large: true, corps: formProduit(), actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Enregistrer', a: 'sauverProduit', cls: 'p' }] }) }
ACT.modifierProduit = function (id) {
  var p = window.__fiche && window.__fiche.id === id ? window.__fiche : null; if (!p) return
  ouvrirModal({ titre: 'Modifier ' + esc(p.nom), large: true, corps: formProduit(p), actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Enregistrer', a: 'sauverProduit', v: id, cls: 'p' }] })
}
ACT.sauverProduit = function (id) {
  if (!val('p-nom')) return modalErr('Le nom est obligatoire')
  var b = { id: id || undefined, nom: val('p-nom'), code: val('p-code'), dci: val('p-dci'), dosage: val('p-dosage'), forme: val('p-forme'), famille: val('p-fam'), labo: val('p-labo'), emplacement: val('p-empl'), prix: num('p-prix'), seuil: num('p-seuil'), stock_max: num('p-max'), ordonnance: chk('p-ordo'), stupefiant: chk('p-stup'), generique: chk('p-gen'), remboursable: chk('p-remb') }
  if ($('#p-pa')) b.prix_achat = num('p-pa'); else if (window.__fiche && id) b.prix_achat = window.__fiche.prix_achat || 0
  if ($('#p-four')) b.fournisseur_id = val('p-four') || null; else if (window.__fiche && id) b.fournisseur_id = window.__fiche.fournisseur_id
  if (id) b.actif = chk('p-actif')
  api('/api/produits', { body: b }).then(function () { fermerModal(); toast('Produit enregistré'); rafraichirCatalogue(); chargerVue() }, function (e) { modalErr(e.message) })
}
ACT.ajusterLot = function (id, el) {
  ouvrirModal({ titre: 'Ajuster le stock', corps: '<p>' + esc(el.dataset.n) + '</p><div class="ligne-form">' + champ('Variation (+ ou −)', 'aj-d', { type: 'number', ph: '-2', af: 1 }) + champ('Motif', 'aj-m', { ph: 'erreur de comptage…' }) + '</div>', actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Valider', a: 'validerAjust', v: id, cls: 'p' }] })
  $('#aj-d').removeAttribute('min')
}
ACT.validerAjust = function (id) { api('/api/ajustement', { body: { lot_id: id, delta: Number(val('aj-d')), motif: val('aj-m') } }).then(function () { fermerModal(); toast('Stock ajusté'); rafraichirCatalogue(); chargerVue() }, function (e) { modalErr(e.message) }) }
ACT.perteLot = function (id, el) {
  ouvrirModal({ titre: 'Sortie de stock (perte)', corps: '<p>' + esc(el.dataset.n) + ' — en stock : ' + el.dataset.q + '</p><div class="ligne-form">' + champ('Quantité', 'pt-q', { type: 'number', val: el.dataset.q, af: 1 }) + champ('Motif', 'pt-m', { opts: [['perime', 'Périmé'], ['casse', 'Casse'], ['vol', 'Vol / manquant'], ['autre', 'Autre']] }) + '</div>', actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Retirer du stock', a: 'validerPerte', v: id, cls: 'p' }] })
}
ACT.validerPerte = function (id) { api('/api/pertes', { body: { lot_id: id, qte: num('pt-q'), motif: val('pt-m') } }).then(function (r) { fermerModal(); toast('Retiré du stock · valeur perdue ' + F(r.valeur)); rafraichirCatalogue(); chargerVue() }, function (e) { modalErr(e.message) }) }

// ───────── Import du catalogue (CSV / Excel enregistré en CSV) ─────────
var ALIAS = { code: ['code', 'code-barres', 'codebarres', 'cip', 'ean', 'barcode'], nom: ['nom', 'designation', 'désignation', 'produit', 'libelle', 'libellé'], dci: ['dci', 'molecule', 'molécule'], dosage: ['dosage'], forme: ['forme'], famille: ['famille', 'categorie', 'catégorie', 'rayon'], labo: ['labo', 'laboratoire', 'fabricant'], prix: ['prix', 'prix vente', 'prix_vente', 'pv', 'prix de vente'], prix_achat: ['prix achat', 'prix_achat', 'pa', 'prix d\'achat', 'cout', 'coût'], seuil: ['seuil', 'stock min', 'stock_min', 'minimum'], stock_max: ['stock max', 'stock_max', 'maximum'], emplacement: ['emplacement', 'rayonnage', 'place'], ordonnance: ['ordonnance', 'rx'], stupefiant: ['stupefiant', 'stupéfiant', 'psychotrope'], generique: ['generique', 'générique'], remboursable: ['remboursable', 'rembours', 'remboursé'] }
function lireCsv(texte) {
  var t = texte.replace(/^﻿/, ''), sep = [';', '\t', ','].sort(function (a, b) { return t.split(b).length - t.split(a).length })[0]
  var rows = [], row = [], cur = '', q = false
  for (var i = 0; i < t.length; i++) {
    var c = t[i]
    if (q) { if (c === '"' && t[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true
    else if (c === sep) { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(function (x) { return x.trim() })) rows.push(row); row = [] }
    else cur += c
  }
  row.push(cur); if (row.some(function (x) { return x.trim() })) rows.push(row)
  if (rows.length < 2) return []
  var cols = rows[0].map(function (h) { var k = sansAccent(h).trim(); return Object.keys(ALIAS).find(function (n) { return ALIAS[n].some(function (a) { return sansAccent(a) === k }) }) || null })
  return rows.slice(1).map(function (r) { var o = {}; cols.forEach(function (c, i) { if (c) o[c] = (r[i] || '').trim() }); return o })
}
ACT.importProduits = function () {
  ouvrirModal({ titre: 'Importer le catalogue', large: true, corps: '<p>Prépare un fichier <b>Excel</b>, puis fais « Enregistrer sous » → <b>CSV</b>. La première ligne contient les titres des colonnes : <i>code, nom, dci, dosage, forme, famille, labo, prix, prix_achat, seuil, stock_max, emplacement, ordonnance, stupefiant, generique, remboursable</i> (seuls <b>nom</b> et <b>prix</b> sont obligatoires). Un produit déjà présent (même code, ou même nom et dosage) est mis à jour. Le stock se saisit ensuite par réception ou inventaire.</p><button data-a="modeleCsv">⬇ Télécharger un modèle</button><label>Fichier CSV</label><input type="file" id="imp-fichier" accept=".csv,.txt,text/csv" data-c="impfichier"><div id="imp-apercu" class="m" style="margin-top:10px"></div>', actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Importer', a: 'lancerImport', cls: 'p', id: 'btn-imp' }] })
  $('#btn-imp').disabled = true; window.__imp = null
}
ACT.modeleCsv = function () {
  var csv = 'code;nom;dci;dosage;forme;famille;labo;prix;prix_achat;seuil;stock_max;emplacement;ordonnance;stupefiant;generique;remboursable\r\n6001001;Doliprane 500 mg;paracétamol;500 mg;comprimé;Antalgiques;Sanofi;600;380;30;120;A1;non;non;non;oui\r\n'
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'modele-catalogue.csv'; a.click()
}
INP.impfichier = function (v, el) {
  var f = el.files[0]; if (!f) return
  var r = new FileReader()
  r.onload = function () {
    var l = lireCsv(String(r.result)); window.__imp = l
    $('#imp-apercu').innerHTML = l.length ? '<b>' + l.length + ' ligne(s)</b> lue(s). Exemple : ' + esc(l[0].nom || '?') + ' — ' + esc(l[0].prix || '?') + ' F' : '<span class="bad">Aucune ligne lisible : vérifie les titres de colonnes.</span>'
    $('#btn-imp').disabled = !l.length
  }
  r.readAsText(f, 'utf-8')
}
ACT.lancerImport = function () {
  var l = window.__imp; if (!l || !l.length) return
  var b = $('#btn-imp'); b.disabled = true; b.textContent = 'Import en cours…'
  api('/api/produits/import', { body: { lignes: l } }).then(function (r) {
    ouvrirModal({ titre: 'Import terminé', corps: '<p><b class="ok">' + r.crees + '</b> produit(s) créé(s), <b>' + r.modifies + '</b> mis à jour.</p>' + (r.erreurs.length ? '<h3>À corriger</h3><ul>' + r.erreurs.map(function (x) { return '<li>' + esc(x) + '</li>' }).join('') + '</ul>' : ''), actions: [{ l: 'Fermer', a: 'fermer', cls: 'p' }] })
    rafraichirCatalogue(); chargerVue()
  }, function (e) { b.disabled = false; b.textContent = 'Importer'; modalErr(e.message) })
}

ACT.exportCatalogue = function () { telecharger('/api/export/produits', 'catalogue.csv') }

// ───────── Stock : alertes, mouvements, inventaire ─────────
VUES.stock = {
  titre: 'Stock',
  charger: function () {
    var t = tabCourant('stock', 'alertes')
    if (t === 'alertes') return charge('alertes', '/api/alertes')
    if (t === 'mouvements') return charge('mouvements', '/api/mouvements')
    if (t === 'inventaire') return charge('inventaires', '/api/inventaires')
  },
  html: function () {
    var t = tabCourant('stock', 'alertes'), h = onglets('stock', [['alertes', '⚠ Alertes'], ['mouvements', 'Mouvements']].concat(peut('inventaire') ? [['inventaire', '📋 Inventaire']] : []))
    if (t === 'alertes') {
      var a = S.data.alertes; if (!a) return h + '<p class="m">Chargement…</p>'
      return h + '<div class="grille kpis" style="margin-bottom:14px">' + [['Ruptures', a.ruptures.length, 'bad'], ['Stocks bas', a.stock_bas.length, 'warn'], ['Péremption < 90 j', a.peremption_proche.length, 'warn'], ['Périmés en stock', a.perimes.length, 'bad']].map(function (k) { return '<div class="carte kpi"><span>' + k[0] + '</span><b class="' + (k[1] ? k[2] : 'ok') + '">' + k[1] + '</b></div>' }).join('') + '</div>' +
        (a.a_regulariser ? '<div class="alerte">⚠ ' + a.a_regulariser + ' sortie(s) de stock à régulariser : des ventes faites hors ligne sur des produits sans stock enregistré. Fais un inventaire ou une réception.</div>' : '') +
        '<div class="grille g2">' + carte('Ruptures et stocks bas', tableau([['Produit'], ['Stock', 'r'], ['À commander', 'r']], a.ruptures.map(function (p) { return '<tr><td class="bad">' + esc(p.nom) + '</td><td class="r">0</td><td class="r">' + p.a_commander + '</td></tr>' }).concat(a.stock_bas.map(function (p) { return '<tr><td class="warn">' + esc(p.nom) + '</td><td class="r">' + p.stock + '</td><td class="r">' + p.a_commander + '</td></tr>' })), 'Aucune alerte')) +
        carte('Péremptions', tableau([['Produit'], ['Lot'], ['Date'], ['Qté', 'r'], ['']], a.perimes.map(function (l) { return '<tr><td class="bad">' + esc(l.nom) + '</td><td>' + esc(l.numero) + '</td><td class="bad">' + dj(l.peremption) + '</td><td class="r">' + l.qte + '</td><td>' + (peut('stock') && !cloud() ? '<button class="s d" data-a="retirerPerime" data-v="' + esc(l.id) + '" data-q="' + l.qte + '">Retirer</button>' : '') + '</td></tr>' }).concat(a.peremption_proche.map(function (l) { return '<tr><td>' + esc(l.nom) + '</td><td>' + esc(l.numero) + '</td><td class="warn">' + dj(l.peremption) + '</td><td class="r">' + l.qte + '</td><td></td></tr>' })), 'Aucune péremption proche')) + '</div>'
    }
    if (t === 'mouvements') {
      var m = S.data.mouvements; if (!m) return h + '<p class="m">Chargement…</p>'
      return h + carte('200 derniers mouvements', tableau([['Date'], ['Produit'], ['Lot'], ['Type'], ['Qté', 'r'], ['Référence']], m.map(function (x) { return '<tr><td>' + dt(x.created_at) + '</td><td>' + esc(x.produit) + '</td><td>' + esc(x.lot || '') + '</td><td>' + esc(x.type) + '</td><td class="r ' + (x.qte < 0 ? 'bad' : 'ok') + '">' + (x.qte > 0 ? '+' : '') + x.qte + '</td><td><small>' + esc(x.ref || '') + '</small></td></tr>' })))
    }
    var inv = S.data.inventaires; if (!inv) return h + '<p class="m">Chargement…</p>'
    var ouvert = inv.find(function (i) { return i.statut === 'ouvert' })
    return h + (cloud() ? '' : carte('Nouvel inventaire', ouvert ? '<p>Un inventaire est en cours. Termine-le avant d\'en ouvrir un autre.</p>' : '<p class="m">Le logiciel liste les lots en stock ; tu comptes à l\'officine et saisis les quantités. Les écarts sont corrigés à la clôture (les ventes faites pendant le comptage sont conservées).</p><div class="ligne-form">' + champ('Nom', 'iv-nom', { val: 'Inventaire du ' + dj(auj()) }) + champ('Famille (facultatif)', 'iv-fam', { opts: [['', 'Tout le stock']].concat((S.data.familles || FAMILLES_DEFAUT).map(function (f) { return [f, f] })) }) + '<button class="p" data-a="ouvrirInventaire">Démarrer</button></div>')) +
      carte('Inventaires', tableau([['Nom'], ['Ouvert le'], ['Statut'], ['Progression', 'r'], ['']], inv.map(function (i) { return '<tr><td>' + esc(i.nom) + '</td><td>' + dt(i.ouvert_le) + '</td><td>' + (i.statut === 'ouvert' ? '<span class="puce off">en cours</span>' : '<span class="puce">clos</span>') + '</td><td class="r">' + i.nb_comptees + ' / ' + i.nb_lignes + '</td><td><button class="s" data-a="voirInventaire" data-v="' + esc(i.id) + '">' + (i.statut === 'ouvert' ? 'Compter' : 'Voir') + '</button></td></tr>' }), 'Aucun inventaire'))
  }
}
ACT.retirerPerime = function (id, el) { if (confirm('Retirer ce lot périmé du stock (' + el.dataset.q + ' unités) ?')) api('/api/pertes', { body: { lot_id: id, qte: Number(el.dataset.q), motif: 'perime' } }).then(function (r) { toast('Retiré · valeur perdue ' + F(r.valeur)); chargerVue() }, function (e) { toast(e.message) }) }
ACT.ouvrirInventaire = function () { api('/api/inventaires', { body: { nom: val('iv-nom'), famille: val('iv-fam') } }).then(function (r) { ACT.voirInventaire(r.id) }, function (e) { toast(e.message) }) }
ACT.voirInventaire = function (id, q, ecarts) {
  window.__ivE = !!ecarts
  api('/api/inventaires/' + id + '?' + qs({ q: typeof q === 'string' && q !== id ? q : '', ecarts: ecarts ? 1 : '' })).then(function (inv) {
    var ouvert = inv.statut === 'ouvert'
    ouvrirModal({ titre: esc(inv.nom) + ' — ' + inv.nb_comptees + ' / ' + inv.nb_lignes + ' lots comptés', large: true, corps: '<div class="ligne-form"><input id="iv-q" placeholder="Chercher un produit" value="' + esc(typeof q === 'string' && q !== id ? q : '') + '" data-i="ivq" data-id="' + esc(id) + '"><button data-a="ivEcarts" data-v="' + esc(id) + '">' + (ecarts ? 'Tout afficher' : 'Seulement les écarts') + '</button></div>' +
      tableau([['Produit'], ['Lot'], ['Péremption'], ['Théorique', 'r'], ['Compté', 'r'], ['Écart', 'r']], inv.lignes.map(function (l) {
        var ec = l.qte_comptee == null ? '' : l.qte_comptee - l.qte_theorique
        return '<tr><td>' + esc(l.produit_nom) + '</td><td>' + esc(l.lot_numero) + '</td><td>' + dj(l.peremption) + '</td><td class="r">' + l.qte_theorique + '</td><td class="r">' + (ouvert ? '<input type="number" min="0" value="' + (l.qte_comptee == null ? '' : l.qte_comptee) + '" data-c="compter" data-inv="' + esc(id) + '" data-lot="' + esc(l.lot_id) + '" style="width:84px;text-align:right;min-height:34px;padding:4px 6px">' : (l.qte_comptee == null ? '—' : l.qte_comptee)) + '</td><td class="r ' + (ec ? 'bad' : '') + '" id="ec-' + esc(l.lot_id) + '">' + (ec === '' ? '' : (ec > 0 ? '+' : '') + ec) + '</td></tr>'
      }), 'Aucune ligne') + (inv.lignes.length >= 400 ? '<p class="m">400 premières lignes affichées : utilise la recherche.</p>' : ''), actions: [{ l: 'Fermer', a: 'fermer' }].concat(ouvert ? [{ l: '✔ Clôturer et corriger le stock', a: 'cloturerInventaire', v: id, cls: 'p' }] : []) })
  }, function (e) { toast(e.message) })
}
var minuteurIv
INP.ivq = function (v, el) { clearTimeout(minuteurIv); minuteurIv = setTimeout(function () { ACT.voirInventaire(el.dataset.id, v, window.__ivE) }, 350) }
ACT.ivEcarts = function (id) { window.__ivE = !window.__ivE; ACT.voirInventaire(id, '', window.__ivE) }
INP.compter = function (v, el) {
  api('/api/inventaires/' + el.dataset.inv + '/compter', { body: { lot_id: el.dataset.lot, qte: v === '' ? null : Number(v) } }).then(function () {
    var th = el.closest('tr').children[3].textContent, e = $('#ec-' + el.dataset.lot)
    if (e) { var d = v === '' ? '' : Number(v) - Number(th); e.textContent = d === '' ? '' : (d > 0 ? '+' : '') + d; e.className = 'r ' + (d ? 'bad' : '') }
  }, function (e) { toast(e.message) })
}
ACT.cloturerInventaire = function (id) {
  if (!confirm('Clôturer l\'inventaire ? Les écarts comptés seront appliqués au stock.')) return
  api('/api/inventaires/' + id + '/cloturer', { body: {} }).then(function (r) { ouvrirModal({ titre: 'Inventaire clôturé', corps: '<div class="grille kpis"><div class="kpi"><span>Lots comptés</span><b>' + r.comptees + '</b></div><div class="kpi"><span>Écarts corrigés</span><b>' + r.ecarts + '</b></div><div class="kpi"><span>Valeur des écarts</span><b class="' + (r.valeur < 0 ? 'bad' : 'ok') + '">' + F(r.valeur) + '</b></div></div>', actions: [{ l: 'Fermer', a: 'fermer', cls: 'p' }] }); rafraichirCatalogue(); chargerVue() }, function (e) { toast(e.message) })
}

// ───────── Registre des stupéfiants et psychotropes ─────────
VUES.stup = {
  titre: 'Registre des stupéfiants',
  charger: function () { var f = S.data.sf || (S.data.sf = { du: ilya(90), au: auj(), produit_id: '' }); return charge('registre', '/api/registre?' + qs(f)) },
  html: function () {
    var r = S.data.registre, f = S.data.sf || {}; if (!r) return '<p class="m">Chargement…</p>'
    return '<div class="carte"><div class="ligne-form">' + champ('Produit', 'sf-p', { opts: [['', 'Tous']].concat(r.produits.map(function (p) { return [p.id, p.nom + ' (stock ' + p.stock + ')'] })), val: f.produit_id }) + champ('Du', 'sf-du', { type: 'date', val: f.du }) + champ('Au', 'sf-au', { type: 'date', val: f.au }) + '<button class="p" data-a="filtrerStup">Afficher</button><button data-a="imprimerStup">🖨 Imprimer</button></div></div>' +
      '<div class="grille kpis" style="margin-bottom:14px">' + r.produits.map(function (p) { return '<div class="carte kpi"><span>' + esc(p.nom) + '</span><b>' + p.stock + '</b><small>en stock</small></div>' }).join('') + '</div>' +
      carte('Mouvements', tableauStup(r.lignes))
  }
}
function tableauStup(l) {
  return tableau([['Date'], ['Produit'], ['Mouvement'], ['Qté', 'r'], ['Solde', 'r'], ['Patient'], ['Prescripteur'], ['N° ordonnance'], ['Référence']], l.map(function (x) {
    return '<tr><td>' + dt(x.created_at) + '</td><td>' + esc(x.produit_nom) + '</td><td class="' + (x.type === 'entree' ? 'ok' : 'warn') + '">' + (x.type === 'entree' ? 'Entrée' : 'Sortie') + '</td><td class="r">' + x.qte + '</td><td class="r"><b>' + x.solde + '</b></td><td>' + esc(x.patient || '') + '</td><td>' + esc(x.prescripteur || '') + '</td><td>' + esc(x.num_ordonnance || '') + '</td><td><small>' + esc(x.ref || '') + '</small></td></tr>'
  }), 'Aucun mouvement sur la période')
}
ACT.filtrerStup = function () { S.data.sf = { du: val('sf-du'), au: val('sf-au'), produit_id: val('sf-p') }; chargerVue() }
ACT.imprimerStup = function () { imprimer('<h3 style="text-align:center">Registre des stupéfiants — ' + esc((S.etat && S.etat.officine) || '') + '</h3>' + '<p>Période : ' + dj(S.data.sf.du) + ' au ' + dj(S.data.sf.au) + '</p>' + tableauStup(S.data.registre.lignes).replace(/<div class="defil">/, '<div>')) }
