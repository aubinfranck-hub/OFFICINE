'use strict'
// ───────── Utilitaires ─────────
var $ = function (s, r) { return (r || document).querySelector(s) }
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) }
var F = function (n) { return Number(n || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') + ' F' }
var N = function (n) { return Number(n || 0).toLocaleString('fr-FR').replace(/ | /g, ' ') }
var pad = function (x) { return ('0' + x).slice(-2) }
var dt = function (iso) { if (!iso) return ''; var d = new Date(iso); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) }
var dj = function (iso) { if (!iso) return ''; var d = String(iso).slice(0, 10).split('-'); return d[2] + '/' + d[1] + '/' + d[0] }
var auj = function () { return new Date().toISOString().slice(0, 10) }
var ilya = function (j) { return new Date(Date.now() - j * 86400000).toISOString().slice(0, 10) }
var uuid = function () {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID()
  var b = new Uint8Array(16); crypto.getRandomValues(b); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128
  var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2) }).join('')
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20)
}
var store = {
  get: function (k, d) { try { var v = localStorage.getItem('lgo_' + k); return v == null ? d : JSON.parse(v) } catch (e) { return d } },
  set: function (k, v) { try { localStorage.setItem('lgo_' + k, JSON.stringify(v)) } catch (e) {} },
  del: function (k) { try { localStorage.removeItem('lgo_' + k) } catch (e) {} }
}
var MODES = { especes: 'Espèces', wave: 'Wave', orange: 'Orange Money', mtn: 'MTN Money', moov: 'Moov Money', cheque: 'Chèque', carte: 'Carte', credit: 'Crédit (ardoise)', mixte: 'Mixte', bon_sante: 'Tiers payant' }
var MOBILE = ['wave', 'orange', 'mtn', 'moov']

var S = {
  etat: store.get('etat', null), token: store.get('token', null), user: store.get('user', null), param: store.get('param', {}),
  vue: 'login', online: true, data: {}, tab: {}, loginTab: 'equipe', equipe: [], choisi: null, pin: '', err: '', secret: null,
  catalogue: store.get('catalogue', { produits: [], organismes: [], clients: [] }), file: store.get('file', []), rejets: store.get('rejets', []),
  caisse: null
}
var VUES = {}   // nom -> { titre, perm, html(), charger() }
var ACT = {}    // actions déclenchées par data-a
var INP = {}    // saisies déclenchées par data-i

var cloud = function () { return !!(S.etat && S.etat.mode === 'cloud') }
var enLigne = function () { return !!(S.etat && S.etat.mode === 'online') }
var peut = function (p) { var u = S.user; return !!u && !!u.perms && (u.perms.indexOf('*') >= 0 || u.perms.indexOf(p) >= 0) }
var val = function (id) { var e = document.getElementById(id); return e ? String(e.value).trim() : '' }
var num = function (id) { var v = val(id).replace(/\s/g, ''); return v === '' ? 0 : Number(v) }
var chk = function (id) { var e = document.getElementById(id); return e && e.checked ? 1 : 0 }
function toast(m) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove() }, 3600) }

// ───────── Réseau ─────────
function api(path, opt) {
  opt = opt || {}
  var h = { 'content-type': 'application/json' }
  if (S.token) h.authorization = 'Bearer ' + S.token
  return fetch(path, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined }).then(function (r) {
    S.online = true
    return r.json().catch(function () { return {} }).then(function (j) {
      if (!r.ok) {
        if (r.status === 401 && S.token && path !== '/api/login' && path !== '/api/pin') deconnecter(true)
        var e = new Error(j.erreur || 'Erreur ' + r.status); e.http = r.status; throw e
      }
      return j
    })
  }, function () { S.online = false; var e = new Error('Serveur injoignable'); e.reseau = true; throw e })
}
function qs(o) { return Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] != null }).map(function (k) { return k + '=' + encodeURIComponent(o[k]) }).join('&') }
function charge(cle, url) { return api(url).then(function (r) { S.data[cle] = r }, function (e) { toast(e.message) }) }

// ───────── Fenêtres (modales) ─────────
function ouvrirModal(o) {
  var acts = (o.actions || []).map(function (a) { return '<button class="' + (a.cls || '') + '" data-a="' + a.a + '" data-v="' + esc(a.v == null ? '' : a.v) + '"' + (a.id ? ' id="' + a.id + '"' : '') + '>' + a.l + '</button>' }).join('')
  $('#modales').innerHTML = '<div class="voile" data-a="voile"><div class="modale' + (o.large ? ' large' : '') + '"><div class="mt"><h3 style="margin:0">' + o.titre + '</h3><button class="s" data-a="fermer">✕</button></div><div class="mc">' + o.corps + '<div class="err" id="merr"></div></div>' + (acts ? '<div class="mp">' + acts + '</div>' : '') + '</div></div>'
  var f = $('#modales [autofocus]'); if (f) f.focus()
}
function fermerModal() { $('#modales').innerHTML = '' }
function modalErr(m) { var e = $('#merr'); if (e) e.textContent = m }
function modalOuvert() { return !!$('#modales .voile') }
ACT.fermer = fermerModal
ACT.voile = function (v, el, ev) { if (ev.target === el) fermerModal() }

// ───────── Éléments de formulaire et de tableau ─────────
function champ(label, id, o) {
  o = o || {}
  var v = o.val == null ? '' : o.val
  var corps
  if (o.opts) corps = '<select id="' + id + '">' + o.opts.map(function (x) { return '<option value="' + esc(x[0]) + '"' + (String(x[0]) === String(v) ? ' selected' : '') + '>' + esc(x[1]) + '</option>' }).join('') + '</select>'
  else if (o.type === 'check') corps = '<label style="display:flex;gap:8px;align-items:center;text-transform:none;font-size:14px;color:var(--t);margin:0"><input type="checkbox" id="' + id + '" style="width:auto;min-height:0"' + (v ? ' checked' : '') + '> ' + esc(label) + '</label>'
  else corps = '<input id="' + id + '" type="' + (o.type || 'text') + '" value="' + esc(v) + '" placeholder="' + esc(o.ph || '') + '"' + (o.type === 'number' ? ' inputmode="numeric" min="0"' : '') + (o.af ? ' autofocus' : '') + (o.max ? ' maxlength="' + o.max + '"' : '') + (o.ro ? ' readonly' : '') + '>'
  return o.type === 'check' ? '<div>' + corps + '</div>' : '<div><label for="' + id + '">' + esc(label) + '</label>' + corps + '</div>'
}
function tableau(cols, rows, vide) {
  return '<div class="defil"><table><tr>' + cols.map(function (c) { return '<th class="' + (c[1] || '') + '">' + c[0] + '</th>' }).join('') + '</tr>' +
    (rows.length ? rows.join('') : '<tr><td colspan="' + cols.length + '" class="m">' + (vide || 'Rien à afficher') + '</td></tr>') + '</table></div>'
}
function carte(titre, corps, droite) { return '<div class="carte"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3>' + titre + '</h3>' + (droite || '') + '</div>' + corps + '</div>' }
function onglets(vue, liste) {
  var cur = S.tab[vue] || liste[0][0]
  return '<div class="onglets">' + liste.map(function (o) { return '<button data-a="tab" data-v="' + vue + ':' + o[0] + '" class="' + (cur === o[0] ? 'sel' : '') + '">' + o[1] + '</button>' }).join('') + '</div>'
}
function tabCourant(vue, defaut) { return S.tab[vue] || defaut }
ACT.tab = function (v) { var p = v.split(':'); S.tab[p[0]] = p[1]; rendre(); chargerVue() }
function stk(n, seuil) { return '<span class="stk' + (n <= 0 ? ' zero' : n <= (seuil || 0) ? ' bas' : '') + '">' + n + '</span>' }
function tags(p) { return (p.remboursable === 0 ? '<span class="tag" style="background:#eee;color:#666" title="Non remboursable par les organismes">NR</span>' : '') + (p.ordonnance ? '<span class="tag rx">Rx</span>' : '') + (p.stupefiant ? '<span class="tag st">STUP</span>' : '') + (p.generique ? '<span class="tag gen">G</span>' : '') }
function barres(lignes, cleNom, cleVal, fmt) {
  var max = Math.max.apply(null, lignes.map(function (l) { return Math.abs(l[cleVal]) }).concat([1]))
  return '<div class="barres">' + lignes.map(function (l) { return '<div class="bl"><span title="' + esc(l[cleNom]) + '" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(MODES[l[cleNom]] || l[cleNom]) + '</span><div class="rail"><i style="width:' + Math.max(2, Math.abs(l[cleVal]) / max * 100) + '%"></i></div><b class="r">' + (fmt ? fmt(l[cleVal]) : F(l[cleVal])) + '</b></div>' }).join('') + '</div>'
}
function graphique(serie) {
  var W = 640, H = 220, g = 34, b = 22, n = serie.length || 1
  var max = Math.max.apply(null, serie.map(function (s) { return s.ca }).concat([1]))
  var pas = (W - g) / n, bw = Math.max(4, Math.min(34, pas * 0.62))
  var haut = H - b - 14
  var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Chiffre d\'affaires par jour">'
  for (var k = 0; k <= 4; k++) {
    var y = 8 + haut - haut * k / 4
    out += '<line x1="' + g + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#e5ece9"/><text x="' + (g - 4) + '" y="' + (y + 3) + '" text-anchor="end">' + (max * k / 4 >= 1000 ? Math.round(max * k / 4000) + 'k' : Math.round(max * k / 4)) + '</text>'
  }
  var pts = []
  serie.forEach(function (s, i) {
    var x = g + i * pas + (pas - bw) / 2, h = s.ca / max * haut
    out += '<rect x="' + x + '" y="' + (8 + haut - h) + '" width="' + bw + '" height="' + Math.max(0, h) + '" rx="3" fill="#0e7c61"><title>' + dj(s.jour) + ' : ' + F(s.ca) + (s.marge != null ? ' (marge ' + F(s.marge) + ')' : '') + ' · ' + s.nb + ' ventes</title></rect>'
    if (s.marge != null) pts.push((x + bw / 2) + ',' + (8 + haut - Math.max(0, s.marge) / max * haut))
    if (n <= 16 || i % Math.ceil(n / 12) === 0) out += '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + s.jour.slice(8) + '/' + s.jour.slice(5, 7) + '</text>'
  })
  if (pts.length > 1) out += '<polyline fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linejoin="round" points="' + pts.join(' ') + '"/>'
  return out + '</svg>'
}
function telecharger(url, nom) {
  var h = {}; if (S.token) h.authorization = 'Bearer ' + S.token
  return fetch(url, { headers: h }).then(function (r) {
    if (!r.ok) return r.json().then(function (j) { throw new Error(j.erreur || 'Erreur ' + r.status) })
    var cd = r.headers.get('content-disposition') || '', m = /filename="([^"]+)"/.exec(cd)
    return r.blob().then(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = m ? m[1] : nom; document.body.appendChild(a); a.click(); a.remove(); toast('Fichier téléchargé : ' + a.download) })
  }).catch(function (e) { toast(e.message === 'Failed to fetch' ? 'Serveur injoignable' : e.message) })
}
function imprimer(html) { $('#impression').innerHTML = html; setTimeout(function () { window.print() }, 80) }

// ───────── Navigation ─────────
var NAV = [
  ['comptoir', 'Comptoir', '🛒', 'vente', true], ['ventes', 'Ventes', '🧾', 'vente'], ['caisse', 'Caisse', '💰', 'caisse', true],
  ['conseil', 'Conseil', '🩺', 'vente'], ['produits', 'Produits', '💊', 'vente'], ['stock', 'Stock', '📦', 'stock'], ['achats', 'Achats', '🚚', 'achats'],
  ['clients', 'Clients', '👥', 'clients'], ['tierspayant', 'Tiers payant', '🏥', 'tierspayant'], ['stup', 'Stupéfiants', '📕', 'stupefiant'],
  ['stats', 'Statistiques', '📊', 'stats'], ['reglages', 'Réglages', '⚙️', 'parametres']
]
function navVisible() { return NAV.filter(function (n) { return peut(n[3]) && !(cloud() && n[4]) }) }
function aller(vue) { S.vue = vue; S.err = ''; fermerModal(); rendre(); chargerVue(); var z = $('.zone'); if (z) z.scrollTop = 0 }
function chargerVue() { var v = VUES[S.vue]; if (v && v.charger) Promise.resolve(v.charger()).then(function () { rendre() }) }
ACT.aller = function (v) { aller(v) }

ACT.monCompte = function () {
  ouvrirModal({ titre: 'Mon compte — ' + esc(S.user.nom), corps: '<p class="m">' + esc(S.user.role_label || '') + (S.user.perms && S.user.perms.indexOf('*') < 0 ? ' · ' + S.user.perms.length + ' habilitation(s)' : '') + '</p><h3>Changer mon mot de passe</h3>' + champ('Ancien mot de passe', 'mc-old', { type: 'password' }) + champ('Nouveau mot de passe (8 caractères minimum)', 'mc-new', { type: 'password' }), actions: [{ l: 'Fermer', a: 'fermer' }, { l: 'Changer', a: 'changerMdp', cls: 'p' }] })
}
ACT.changerMdp = function () { api('/api/moi/mdp', { body: { ancien: document.getElementById('mc-old').value, nouveau: document.getElementById('mc-new').value } }).then(function () { fermerModal(); toast('Mot de passe changé') }, function (e) { modalErr(e.message) }) }
function menu() {
  var items = navVisible().map(function (n) { return '<button data-a="aller" data-v="' + n[0] + '" class="' + (S.vue === n[0] ? 'on' : '') + '" title="' + n[1] + '"><span class="ic">' + n[2] + '</span><span class="tx">' + n[1] + '</span></button>' }).join('')
  return '<nav id="menu"><div class="logo"><i>✚</i><b>LGO</b></div>' + items + '<div class="bas"><div class="qui">' + esc(S.user.nom) + '<br><small>' + esc(S.user.role_label || '') + '</small></div>' + (enLigne() || S.user.role === 'titulaire' ? '<button data-a="monCompte" title="Mon compte"><span class="ic">👤</span><span class="tx">Mon compte</span></button>' : '') + '<button data-a="sortir" title="Se déconnecter"><span class="ic">⏻</span><span class="tx">Déconnexion</span></button></div></nav>'
}
function chipsEtat() {
  var c = ''
  c += '<span id="statut" class="puce"></span>'
  if (S.caisse && !cloud()) c += '<span class="puce">Caisse ouverte</span>'
  else if (peut('caisse') && !cloud() && S.online) c += '<button class="s" data-a="aller" data-v="caisse" style="border-color:var(--o);color:var(--o)">Caisse fermée : ouvrir</button>'
  return c
}
function majStatut() {
  var c = $('#statut'); if (!c) return
  var att = S.file.length ? ' · ' + S.file.length + ' vente(s) à envoyer' : ''
  c.className = 'puce' + (S.online ? '' : ' off')
  c.textContent = cloud() ? (S.online ? 'À distance' : 'Hors ligne') : enLigne() ? (S.online ? 'En ligne' : 'Hors ligne — les ventes sont gardées sur la tablette' + att) : ((S.online ? 'Connecté' : 'Hors ligne — les ventes sont gardées sur la tablette') + att)
}

function rendre() {
  var act = document.activeElement, focus = act && act.id, pos = act && act.selectionStart
  var h
  if (S.vue === 'setup') h = vueSetup()
  else if (S.vue === 'login') h = vueLogin()
  else {
    var v = VUES[S.vue] || VUES.stats
    h = '<div id="racine">' + menu() + '<main id="contenu"><div class="entete"><h2>' + esc(v.titre || '') + '</h2><span class="sp"></span>' + chipsEtat() + '</div><div class="zone">' + v.html() + '</div></main></div>'
  }
  $('#app').innerHTML = h
  majStatut()
  if (focus && document.getElementById(focus)) { var el = document.getElementById(focus); el.focus(); try { if (pos != null && el.setSelectionRange) el.setSelectionRange(pos, pos) } catch (e) {} }
}

// ───────── Installation et connexion ─────────
function vueSetup() {
  if (S.secret) return '<div class="centre carte"><h3>Installation terminée</h3><p>Ajoute cette clé dans <b>Google Authenticator</b> : bouton « + », puis « Saisir une clé de configuration ». Elle sera demandée à chaque connexion du titulaire. <b>Elle ne s\'affichera plus.</b></p><div class="mono">' + esc(S.secret.totp_secret) + '</div><button class="p" data-a="fini" style="width:100%;margin-top:14px">J\'ai enregistré la clé</button></div>'
  return '<div class="centre carte"><h3>Installer l\'officine</h3>' + champ('Nom de l\'officine', 's_off', { af: 1 }) + champ('Nom du titulaire', 's_nom') + champ('Email', 's_mail', { type: 'email' }) + champ('Mot de passe (10 caractères minimum)', 's_mdp', { type: 'password' }) + '<div class="err">' + esc(S.err) + '</div><button class="p" data-a="installer" style="width:100%">Créer</button></div>'
}
function vueLogin() {
  var c = cloud() || enLigne()
  var tabs = c ? '' : '<div class="ligne-form" style="margin-bottom:10px"><button data-a="logtab" data-v="equipe" class="' + (S.loginTab === 'equipe' ? 'sel' : '') + '">Équipe (PIN)</button><button data-a="logtab" data-v="titulaire" class="' + (S.loginTab === 'titulaire' ? 'sel' : '') + '">Titulaire</button></div>'
  var corps
  if (S.loginTab === 'titulaire' || c) {
    corps = champ(enLigne() ? 'Identifiant' : 'Email', 'l_mail', { type: enLigne() ? 'text' : 'email', af: 1 }) + champ('Mot de passe', 'l_mdp', { type: 'password' }) + champ(enLigne() ? 'Code Google Authenticator (si la double sécurité est activée)' : 'Code à 6 chiffres de Google Authenticator', 'l_code', { max: 6 }) + '<div class="err">' + esc(S.err) + '</div><button class="p" data-a="login" style="width:100%">Se connecter</button>'
  } else if (!S.choisi) {
    corps = '<p>Qui est au comptoir ?</p><div class="equipe">' + (S.equipe.length ? S.equipe.map(function (u) { return '<button data-a="choisir" data-v="' + esc(u.id) + '" data-n="' + esc(u.nom) + '">' + esc(u.nom) + '<br><small class="m">' + esc(u.role_label) + '</small></button>' }).join('') : '<p class="m">Aucun employé (ou serveur injoignable). Le titulaire peut les créer.</p>') + '</div><div class="err">' + esc(S.err) + '</div>'
  } else {
    corps = '<p class="c"><b>' + esc(S.choisi.nom) + '</b> · saisis ton PIN</p><div class="points">' + '●'.repeat(S.pin.length) + '</div><div class="pin">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map(function (k) { return '<button data-a="touche" data-v="' + k + '" class="' + (k === 'OK' ? 'p' : '') + '">' + k + '</button>' }).join('') + '</div><div class="err c">' + esc(S.err) + '</div><button data-a="retour" style="width:100%">Changer de personne</button>'
  }
  return '<div class="centre carte"><h3 style="font-size:19px">✚ ' + esc((S.etat && S.etat.officine) || 'LGO Officine') + '</h3>' + tabs + corps + '</div>'
}
function action(fn) { S.err = ''; return Promise.resolve().then(fn).then(null, function (e) { S.err = e.message; rendre() }) }
ACT.installer = function () { action(function () { return api('/api/installation', { body: { officine: val('s_off'), nom: val('s_nom'), email: val('s_mail'), mdp: document.getElementById('s_mdp').value } }).then(function (r) { S.secret = r; rendre() }) }) }
ACT.fini = function () { S.secret = null; S.vue = 'login'; S.loginTab = 'titulaire'; api('/api/etat').then(function (e) { S.etat = e; store.set('etat', e); rendre() }) }
ACT.logtab = function (v) { S.loginTab = v; S.err = ''; S.choisi = null; S.pin = ''; rendre() }
ACT.login = function () { action(function () { return api('/api/login', { body: { email: val('l_mail'), mdp: document.getElementById('l_mdp').value, code: val('l_code') } }).then(ouvrirSession) }) }
ACT.choisir = function (v, el) { S.choisi = { id: v, nom: el.dataset.n }; S.pin = ''; S.err = ''; rendre() }
ACT.retour = function () { S.choisi = null; S.pin = ''; S.err = ''; rendre() }
ACT.touche = function (k) {
  if (k === 'C') S.pin = ''
  else if (k === 'OK') { action(function () { return api('/api/pin', { body: { user_id: S.choisi.id, pin: S.pin } }).then(ouvrirSession) }).then(function () { S.pin = ''; rendre() }); return }
  else if (S.pin.length < 6) S.pin += k
  rendre()
}
ACT.sortir = function () { deconnecter() }
document.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && S.vue === 'login' && (S.loginTab === 'titulaire' || cloud())) ACT.login()
  if (e.key === 'Enter' && S.vue === 'login' && S.choisi && S.pin.length >= 4 && document.activeElement === document.body) ACT.touche('OK')
  if (e.key === 'Escape' && modalOuvert()) fermerModal()
})
function deconnecter(silencieux) {
  if (!silencieux && S.token) api('/api/logout', { body: {} }).catch(function () {})
  S.token = null; S.user = null; store.del('token'); store.del('user'); S.vue = 'login'; S.pin = ''; S.choisi = null; S.err = ''; S.caisse = null; S.data = {}
  fermerModal(); chargerEquipe(); rendre()
}
function ouvrirSession(r) {
  S.token = r.token; S.user = r.user; store.set('token', r.token); store.set('user', r.user)
  S.err = ''; S.vue = peut('stats') ? 'stats' : (cloud() ? 'produits' : 'comptoir'); if (cloud() && !peut('stats')) S.vue = 'produits'
  chargerContexte(); rendre(); chargerVue()
}
function chargerContexte() {
  if (cloud()) return
  api('/api/parametres').then(function (p) { S.param = p; store.set('param', p) }, function () {})
  rafraichirCatalogue()
  if (peut('caisse')) api('/api/caisse').then(function (r) { S.caisse = r.courante; rendre() }, function () {})
}
function rafraichirCatalogue() {
  if (!S.token || cloud()) return Promise.resolve()
  return api('/api/catalogue').then(function (c) { S.catalogue = c; store.set('catalogue', c); if (S.vue === 'comptoir' && !modalOuvert()) majResultats() }, function () {})
}
function chargerEquipe() {
  if (cloud() || enLigne()) { S.loginTab = 'titulaire'; return }
  api('/api/equipe').then(function (l) { S.equipe = l; store.set('equipe', l); rendre() }, function () { S.equipe = store.get('equipe', []); rendre() })
}

// ───────── Démarrage ─────────
function demarrer() {
  api('/api/etat').then(function (e) { S.etat = e; store.set('etat', e) }, function () {}).then(function () {
    if (S.etat && !S.etat.installe) S.vue = 'setup'
    else if (S.token && S.user && S.user.perms) { S.vue = peut('stats') ? 'stats' : (cloud() ? 'produits' : 'comptoir'); chargerContexte(); chargerVue(); api('/api/me').then(function (u) { S.user = u; store.set('user', u); rendre() }, function () {}) }
    else { S.token = null; S.vue = 'login'; if (cloud() || enLigne()) S.loginTab = 'titulaire'; chargerEquipe() }
    rendre()
  })
}

// ───────── Événements ─────────
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-a]'); if (!el) return
  var f = ACT[el.dataset.a]; if (f) f(el.dataset.v, el, e)
})
document.addEventListener('input', function (e) { var el = e.target.closest('[data-i]'); if (el && INP[el.dataset.i]) INP[el.dataset.i](el.value, el) })
document.addEventListener('change', function (e) { var el = e.target.closest('[data-c]'); if (el && INP[el.dataset.c]) INP[el.dataset.c](el.value, el) })
setInterval(function () { if (S.vue !== 'login' && S.vue !== 'setup') api('/api/etat').then(function () { majStatut() }, function () { majStatut() }) }, 12000)
window.addEventListener('online', function () { if (window.viderFile) viderFile() })
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(function () {})
