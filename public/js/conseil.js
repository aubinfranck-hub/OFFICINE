'use strict'
// ───────── Conseil au comptoir : symptôme + âge + poids → produits en stock ─────────
var CV = { symptome: '', ans: '', mois: '', kg: '', grossesse: false, res: null, edition: false }

VUES.conseil = {
  titre: 'Conseil',
  charger: function () {
    var jobs = [charge('symptomes', '/api/conseil/symptomes')]
    if (peut('produits') && CV.edition) jobs.push(charge('fiches', '/api/conseil/fiches'), charge('produits_liste', '/api/produits?'))
    return Promise.all(jobs)
  },
  html: function () {
    if (CV.edition) return editionHtml()
    var sy = S.data.symptomes || []
    var h = '<div class="carte"><h3>1. Quel est le problème du client ?</h3><div class="chips">' + sy.map(function (s) {
      return '<button class="chip' + (CV.symptome === s.symptome ? ' sel' : '') + '" data-a="cvSymptome" data-v="' + esc(s.symptome) + '">' + esc(s.symptome) + '</button>'
    }).join('') + (sy.length ? '' : '<span class="m">Aucune fiche conseil pour le moment.' + (peut('produits') ? ' Crée la première avec « Gérer les fiches ».' : ' Demande au pharmacien d\'en créer.') + '</span>') + '</div></div>' +
      '<div class="carte"><h3>2. Âge et poids du client</h3><div class="ligne-form">' +
      champ('Âge (années)', 'cv-ans', { type: 'number', val: CV.ans }) + champ('+ mois (bébé)', 'cv-mois', { type: 'number', val: CV.mois }) + champ('Poids (kg)', 'cv-kg', { type: 'number', val: CV.kg }) + '</div>' +
      '<div style="margin-top:8px">' + champ('Cliente enceinte ou qui allaite', 'cv-gro', { type: 'check', val: CV.grossesse }) + '</div>' +
      '<button class="p" data-a="cvChercher" style="width:100%;margin-top:12px;min-height:52px;font-size:17px"' + (CV.symptome ? '' : ' disabled') + '>🔎 Voir les conseils</button></div>'
    if (CV.res) h += resultatHtml(CV.res)
    if (peut('produits')) h += '<div style="text-align:right"><button class="s" data-a="cvEdition">⚙️ Gérer les fiches conseil</button></div>'
    return h
  }
}

function resultatHtml(r) {
  var h = ''
  if (r.aucune_fiche) return '<div class="alerte">Aucune fiche pour « ' + esc(r.symptome) + ' ».</div>'
  r.alertes.forEach(function (a) { h += '<div class="alerte" style="border-left:6px solid #c0392b"><b>⚠ ' + esc(a.titre) + '</b><br>' + esc(a.texte) + '</div>' })
  if (r.ecartes) h += '<div class="alerte">' + r.ecartes + ' produit(s) écarté(s) car déconseillé(s) pendant la grossesse.</div>'
  h += '<div class="carte"><h3>Produits conseillés</h3>' + (r.produits.length ? r.produits.map(function (p) {
    var dispo = p.stock > 0
    return '<div class="conseil-ligne"><div style="flex:1"><b>' + esc(p.nom || p.titre) + '</b> ' + (p.ordonnance ? '<span class="puce">Ordonnance</span>' : '') + '<br><small class="m">' + esc(p.titre) + (p.dosage ? ' · ' + esc(p.dosage) : '') + (p.forme ? ' · ' + esc(p.forme) : '') + '</small>' +
      (p.posologie ? '<div style="margin-top:4px"><b>Posologie :</b> ' + esc(p.posologie) + '</div>' : '') + (p.precautions ? '<div class="warn" style="margin-top:2px">' + esc(p.precautions) + '</div>' : '') + '</div>' +
      '<div style="text-align:right;min-width:120px"><b>' + F(p.prix) + '</b><br>' + (dispo ? '<span class="puce vert">En stock : ' + p.stock + '</span>' : '<span class="puce rouge">Rupture</span>') + '<br>' +
      (dispo && p.produit_id ? '<button class="p" data-a="cvAjouter" data-v="' + esc(p.produit_id) + '" style="margin-top:6px;min-height:44px">+ Au panier</button>' : (p.produit_id ? '<button class="s" data-a="cvEquiv" data-v="' + esc(p.produit_id) + '" style="margin-top:6px;min-height:44px">Équivalents</button>' : '')) + '</div></div>'
  }).join('') : '<p class="m">Aucun produit adapté à cet âge ou ce poids : demande conseil au pharmacien.</p>') + '</div>'
  return h
}

function lireCV() {
  CV.ans = ($('#cv-ans') || {}).value || ''; CV.mois = ($('#cv-mois') || {}).value || ''; CV.kg = ($('#cv-kg') || {}).value || ''
  var g = $('#cv-gro'); CV.grossesse = !!(g && g.checked)
}
ACT.cvSymptome = function (v) { lireCV(); CV.symptome = v; CV.res = null; rendre() }
ACT.cvChercher = function () {
  lireCV()
  var mois = (CV.ans === '' && CV.mois === '') ? '' : (Number(CV.ans || 0) * 12 + Number(CV.mois || 0))
  api('/api/conseil?' + qs({ symptome: CV.symptome, age_mois: mois, poids: CV.kg, grossesse: CV.grossesse ? '1' : '' })).then(function (r) { CV.res = r; rendre() }, function (e) { toast(e.message) })
}
ACT.cvAjouter = function (id) { ajouter(id); toast('Ajouté au panier'); }
ACT.cvEquiv = function (id) { aller('produits') }
ACT.cvEdition = function () { CV.edition = !CV.edition; aller('conseil') }

function editionHtml() {
  var f = S.data.fiches || [], pr = (S.data.produits_liste && S.data.produits_liste.produits) || S.data.produits_liste || []
  if (!Array.isArray(pr)) pr = []
  var opts = [['', '— choisir —']].concat(pr.map(function (p) { return [p.id, p.nom] }))
  return '<div style="display:flex;justify-content:space-between;align-items:center"><button class="s" data-a="cvEdition">← Retour au conseil</button></div>' +
    carte('Ajouter une fiche', '<div class="ligne-form">' + champ('Symptôme (ex. Mal de gorge)', 'cf-sym') + champ('Type', 'cf-type', { opts: [['produit', 'Produit conseillé'], ['alerte', 'Alerte : orienter vers le médecin']], val: 'produit' }) + champ('Titre', 'cf-titre') + '</div>' +
      '<div class="ligne-form">' + champ('Produit conseillé', 'cf-prod', { opts: opts }) + champ('Âge min (mois)', 'cf-amin', { type: 'number' }) + champ('Âge max (mois, 0 = sans limite)', 'cf-amax', { type: 'number' }) + champ('Poids min (kg)', 'cf-pmin', { type: 'number' }) + champ('Poids max (kg, 0 = sans limite)', 'cf-pmax', { type: 'number' }) + '</div>' +
      champ('Posologie (écrite par le pharmacien)', 'cf-pos') + champ('Précautions / message d\'alerte', 'cf-prec') + champ('Déconseillé pendant la grossesse', 'cf-gro', { type: 'check' }) +
      '<button class="p" data-a="cvSauver" style="margin-top:10px">Enregistrer la fiche</button>') +
    carte('Fiches existantes (' + f.length + ')', tableau([['Symptôme'], ['Type'], ['Produit / titre'], ['Âge (mois)'], ['Poids (kg)'], ['']], f.map(function (c) {
      return '<tr><td>' + esc(c.symptome) + '</td><td>' + (c.type === 'alerte' ? '⚠ Alerte' : 'Produit') + '</td><td>' + esc(c.produit_nom || c.titre) + '<br><small class="m">' + esc(c.titre) + '</small></td><td>' + c.age_min_mois + ' → ' + (c.age_max_mois || '∞') + '</td><td>' + c.poids_min + ' → ' + (c.poids_max || '∞') + '</td><td><button class="s d" data-a="cvSuppr" data-v="' + esc(c.id) + '">Supprimer</button></td></tr>'
    }), 'Aucune fiche'))
}
ACT.cvSauver = function () {
  var g = function (i) { return document.getElementById(i).value }
  api('/api/conseil/fiches', { body: { symptome: g('cf-sym'), type: g('cf-type'), titre: g('cf-titre'), produit_id: g('cf-prod'), age_min_mois: g('cf-amin') || 0, age_max_mois: g('cf-amax') || 0, poids_min: g('cf-pmin') || 0, poids_max: g('cf-pmax') || 0, posologie: g('cf-pos'), precautions: g('cf-prec'), grossesse_non: document.getElementById('cf-gro').checked } })
    .then(function () { toast('Fiche enregistrée'); chargerVue() }, function (e) { toast(e.message) })
}
ACT.cvSuppr = function (id) { api('/api/conseil/fiches/' + id + '/supprimer', { body: {} }).then(function () { toast('Fiche supprimée'); chargerVue() }, function (e) { toast(e.message) }) }
