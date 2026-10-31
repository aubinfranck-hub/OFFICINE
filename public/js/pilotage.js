'use strict'
// ───────── Tableau de bord et statistiques ─────────
var PERIODES = [['jour', 'Aujourd\'hui'], ['7', '7 jours'], ['30', '30 jours'], ['mois', 'Ce mois'], ['perso', 'Dates']]
function bornes(p) {
  var a = auj(), m = a.slice(0, 8) + '01'
  return { jour: [a, a], '7': [ilya(6), a], '30': [ilya(29), a], mois: [m, a] }[p] || null
}
VUES.stats = {
  titre: 'Tableau de bord',
  charger: function () {
    var f = S.data.sp || (S.data.sp = { periode: '30', du: ilya(29), au: auj() })
    var b = bornes(f.periode); if (b) { f.du = b[0]; f.au = b[1] }
    return charge('stats', '/api/stats?' + qs({ du: f.du, au: f.au }))
  },
  html: function () {
    var f = S.data.sp || { periode: '30' }, s = S.data.stats
    var barre = '<div class="onglets">' + PERIODES.map(function (p) { return '<button data-a="periode" data-v="' + p[0] + '" class="' + (f.periode === p[0] ? 'sel' : '') + '">' + p[1] + '</button>' }).join('') + '</div>' +
      (f.periode === 'perso' ? '<div class="carte"><div class="ligne-form">' + champ('Du', 'sp-du', { type: 'date', val: f.du }) + champ('Au', 'sp-au', { type: 'date', val: f.au }) + '<button class="p" data-a="periodePerso">Afficher</button></div></div>' : '')
    if (!s) return barre + '<p class="m">Chargement…</p>'
    var kpi = function (t, v, sous, cls) { return '<div class="carte kpi"><span>' + t + '</span><b class="' + (cls || '') + '">' + v + '</b>' + (sous ? '<small class="m">' + sous + '</small>' : '') + '</div>' }
    var sync = cloud() && S.etat && S.etat.derniere_sync ? '<p class="m">Données de l\'officine mises à jour le ' + dt(S.etat.derniere_sync) + '</p>' : ''
    var alertes = '<div class="grille kpis" style="margin-bottom:14px">' +
      kpi('Créances clients', F(s.creances_clients), 'ardoise des clients', s.creances_clients ? 'warn' : '') + kpi('Tiers payant à encaisser', F(s.creances_organismes), 'organismes', s.creances_organismes ? 'warn' : '') +
      kpi('Dettes fournisseurs', F(s.dettes_fournisseurs), 'à payer', s.dettes_fournisseurs ? 'warn' : '') + kpi('Valeur du stock', F(s.valeur_stock.achat != null ? s.valeur_stock.achat : s.valeur_stock.vente), s.valeur_stock.achat != null ? 'au prix d\'achat · ' + F(s.valeur_stock.vente) + ' en vente' : 'au prix de vente') + '</div>'
    return barre + sync + '<div class="grille kpis" style="margin-bottom:14px">' +
      kpi('Chiffre d\'affaires', F(s.ca), s.nb_ventes + ' ventes') + kpi('Panier moyen', F(s.panier_moyen), s.hors_ligne ? s.hors_ligne + ' faites hors ligne' : '') +
      (s.marge != null ? kpi('Marge brute', F(s.marge), s.taux_marge + ' % du CA', 'ok') : '') + kpi('Remises accordées', F(s.remises)) + kpi('Part des organismes', F(s.part_organismes)) + '</div>' + alertes +
      carte('Chiffre d\'affaires par jour' + (s.marge != null ? ' <small class="m">(courbe orange : marge)</small>' : ''), graphique(s.serie)) +
      '<div class="grille g2">' + carte('Par mode de paiement', s.par_mode.length ? barres(s.par_mode, 'mode', 'montant') : '<p class="m">Aucune vente.</p>') +
      carte('Par famille de produits', s.par_famille.length ? barres(s.par_famille, 'famille', 'ca') : '<p class="m">Aucune vente.</p>') +
      carte('Par vendeur(se)', s.par_vendeur.length ? tableau([['Nom'], ['Ventes', 'r'], ['CA', 'r']], s.par_vendeur.map(function (v) { return '<tr><td>' + esc(v.user_nom || '') + '</td><td class="r">' + v.nb + '</td><td class="r">' + F(v.ca) + '</td></tr>' })) : '<p class="m">Aucune vente.</p>') +
      carte('Analyse ABC', '<p class="m">A : produits qui font 80 % du CA · B : les 15 % suivants · C : le reste.</p><div class="grille kpis"><div class="kpi"><span>Classe A</span><b class="ok">' + s.abc.A + '</b></div><div class="kpi"><span>Classe B</span><b>' + s.abc.B + '</b></div><div class="kpi"><span>Classe C</span><b class="m">' + s.abc.C + '</b></div></div>') + '</div>' +
      carte('Produits les plus vendus', tableau([['Produit'], ['ABC', 'c'], ['Qté', 'r'], ['CA', 'r']].concat(s.marge != null ? [['Marge', 'r']] : []), s.top_produits.map(function (p) { return '<tr><td>' + esc(p.nom) + '</td><td class="c"><span class="puce' + (p.classe === 'A' ? '' : p.classe === 'B' ? ' bleu' : ' off') + '">' + p.classe + '</span></td><td class="r">' + p.qte + '</td><td class="r">' + F(p.ca) + '</td>' + (p.marge != null ? '<td class="r ok">' + F(p.marge) + '</td>' : '') + '</tr>' }), 'Aucune vente')) +
      carte('Produits dormants (en stock, aucune vente depuis 90 jours)', tableau([['Produit'], ['Stock', 'r']].concat(s.valeur_stock.achat != null ? [['Valeur immobilisée', 'r']] : []), s.dormants.map(function (p) { return '<tr><td>' + esc(p.nom) + '</td><td class="r">' + p.stock + '</td>' + (p.valeur != null ? '<td class="r warn">' + F(p.valeur) + '</td>' : '') + '</tr>' }), 'Aucun produit dormant'))
  }
}
ACT.periode = function (v) { S.data.sp.periode = v; chargerVue(); rendre() }
ACT.periodePerso = function () { S.data.sp.du = val('sp-du'); S.data.sp.au = val('sp-au'); charge('stats', '/api/stats?' + qs(S.data.sp)).then(rendre) }

// ───────── Réglages : équipe, officine, journal, synchronisation ─────────
VUES.reglages = {
  titre: 'Réglages',
  charger: function () {
    var t = tabCourant('reglages', 'equipe')
    if (t === 'equipe') return charge('utilisateurs', '/api/utilisateurs')
    if (t === 'officine') return charge('parametres', '/api/parametres')
    if (t === 'journal') return charge('audit', '/api/audit')
  },
  html: function () {
    var t = tabCourant('reglages', 'equipe'), h = onglets('reglages', [['equipe', '👥 Équipe'], ['officine', '🏪 Officine'], ['journal', '📜 Journal'], ['sync', '☁ Synchronisation']])
    if (t === 'equipe') {
      var u = S.data.utilisateurs; if (!u) return h + '<p class="m">Chargement…</p>'
      return h + (cloud() ? '' : carte('Nouvel employé', '<div class="ligne-form">' + champ('Nom', 'u-nom') + champ('Rôle', 'u-role', { opts: [['vendeur', 'Vendeur(se) — comptoir et clients'], ['preparateur', 'Préparateur — + stock, achats, remises'], ['pharmacien', 'Pharmacien adjoint — + marges, stats, annulations']] }) + champ('PIN (4 à 6 chiffres)', 'u-pin', { type: 'password', max: 6 }) + '<button class="p" data-a="ajouterEmploye">Ajouter</button></div>')) +
        carte('Équipe', tableau([['Nom'], ['Rôle'], ['Statut'], ['']], u.map(function (x) { return '<tr><td><b>' + esc(x.nom) + '</b></td><td>' + esc(x.role_label || x.role) + '</td><td>' + (x.actif ? '<span class="puce">actif</span>' : '<span class="puce rouge">désactivé</span>') + '</td><td>' + (x.role !== 'titulaire' && !cloud() ? '<button class="s" data-a="changerPin" data-v="' + esc(x.id) + '" data-n="' + esc(x.nom) + '">Changer le PIN</button> ' + (x.actif ? '<button class="s d" data-a="desactiverEmploye" data-v="' + esc(x.id) + '">Désactiver</button>' : '<button class="s" data-a="reactiverEmploye" data-v="' + esc(x.id) + '">Réactiver</button>') : '') + '</td></tr>' }))) +
        carte('Droits par rôle', tableau([['Droit'], ['Vendeur', 'c'], ['Préparateur', 'c'], ['Pharmacien', 'c'], ['Titulaire', 'c']], [['Vendre, caisse, clients', 1, 1, 1, 1], ['Faire une remise', 0, 1, 1, 1], ['Réceptions, commandes, stock, inventaire', 0, 1, 1, 1], ['Stupéfiants', 0, 1, 1, 1], ['Créer / modifier les produits, voir les prix d\'achat et marges', 0, 0, 1, 1], ['Annuler une vente, retours, confirmer les paiements mobiles', 0, 0, 1, 1], ['Statistiques, tiers payant', 0, 0, 1, 1], ['Équipe, réglages, journal d\'audit', 0, 0, 0, 1]].map(function (r) { return '<tr><td>' + r[0] + '</td>' + r.slice(1).map(function (x) { return '<td class="c">' + (x ? '<span class="ok">✔</span>' : '<span class="m">—</span>') + '</td>' }).join('') + '</tr>' })))
    }
    if (t === 'officine') {
      var p = S.data.parametres; if (!p) return h + '<p class="m">Chargement…</p>'
      return h + carte('Informations de l\'officine (imprimées sur les tickets)', '<div class="ligne-form">' + champ('Nom de l\'officine', 'pa-nom', { val: p.officine }) + champ('Téléphone', 'pa-tel', { val: p.telephone }) + '</div>' + champ('Adresse', 'pa-adr', { val: p.adresse }) + champ('Message en bas du ticket', 'pa-msg', { val: p.message_ticket }) + (cloud() ? '' : '<button class="p" data-a="sauverParametres" style="margin-top:12px">Enregistrer</button>'))
    }
    if (t === 'journal') {
      var a = S.data.audit; if (!a) return h + '<p class="m">Chargement…</p>'
      return h + carte('Journal d\'audit (300 derniers événements)', tableau([['Date'], ['Qui'], ['Action'], ['Détail']], a.map(function (x) { return '<tr><td>' + dt(x.created_at) + '</td><td>' + esc(x.user_nom || '') + '</td><td>' + esc(x.action) + '</td><td><small>' + esc(x.detail || '') + '</small></td></tr>' })))
    }
    return h + carte('Synchronisation avec la version web', '<p>Mode : <b>' + (cloud() ? 'copie web (lecture seule)' : 'serveur de l\'officine') + '</b></p><p>Dernière synchronisation : <b>' + (S.etat && S.etat.derniere_sync ? dt(S.etat.derniere_sync) : 'jamais') + '</b></p>' + (cloud() ? '<p class="m">Cette copie reçoit les données de l\'officine dès qu\'internet est disponible là-bas.</p>' : '<p class="m">L\'officine envoie ses ventes, son stock et ses chiffres au site web toutes les 15 secondes quand internet est là. Aucun mot de passe ni PIN n\'est envoyé.</p><button class="p" data-a="syncMaintenant">Synchroniser maintenant</button>'))
  }
}
ACT.ajouterEmploye = function () { api('/api/utilisateurs', { body: { nom: val('u-nom'), role: val('u-role'), pin: val('u-pin') } }).then(function () { toast('Employé ajouté'); chargerVue() }, function (e) { toast(e.message) }) }
ACT.changerPin = function (id, el) { ouvrirModal({ titre: 'Nouveau PIN pour ' + esc(el.dataset.n), corps: champ('Nouveau PIN (4 à 6 chiffres)', 'np-pin', { type: 'password', af: 1, max: 6 }), actions: [{ l: 'Annuler', a: 'fermer' }, { l: 'Enregistrer', a: 'sauverPin', v: id, cls: 'p' }] }) }
ACT.sauverPin = function (id) { api('/api/utilisateurs/' + id + '/pin', { body: { pin: val('np-pin') } }).then(function () { fermerModal(); toast('PIN changé') }, function (e) { modalErr(e.message) }) }
ACT.desactiverEmploye = function (id) { if (confirm('Désactiver cet employé ? Il ne pourra plus se connecter.')) api('/api/utilisateurs/' + id + '/desactiver', { body: {} }).then(function () { chargerVue() }, function (e) { toast(e.message) }) }
ACT.reactiverEmploye = function (id) { api('/api/utilisateurs/' + id + '/reactiver', { body: {} }).then(function () { chargerVue() }, function (e) { toast(e.message) }) }
ACT.sauverParametres = function () {
  api('/api/parametres', { body: { officine: val('pa-nom'), telephone: val('pa-tel'), adresse: val('pa-adr'), message_ticket: val('pa-msg') } }).then(function () {
    S.etat.officine = val('pa-nom'); store.set('etat', S.etat); S.param = { adresse: val('pa-adr'), telephone: val('pa-tel'), message_ticket: val('pa-msg') }; store.set('param', S.param); toast('Informations enregistrées'); rendre()
  }, function (e) { toast(e.message) })
}
ACT.syncMaintenant = function () { api('/api/sync/maintenant', { body: {} }).then(function (r) { toast(r.ok ? 'Synchronisé (' + r.lignes + ' lignes)' : 'Synchronisation non configurée'); api('/api/etat').then(function (e) { S.etat = e; rendre() }) }, function (e) { toast(e.message) }) }
