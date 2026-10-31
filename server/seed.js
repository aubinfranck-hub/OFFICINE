// Données de démonstration (fictives) : à ne PAS utiliser en production.
import { ouvrirBase, uuid, hacher, nouveauSecretTotp, maintenant } from './lib.js'

const db = ouvrirBase(process.env.DB || 'lgo.db')
if (db.prepare("SELECT 1 x FROM users WHERE role='titulaire'").get()) { console.log('Base déjà initialisée.'); process.exit(0) }

let graine = 42
const alea = () => { graine = (graine * 1664525 + 1013904223) % 4294967296; return graine / 4294967296 }
const run = (sql, ...p) => db.prepare(sql).run(...p)

const secret = nouveauSecretTotp()
const user = (nom, role, extra = {}) => {
  const id = uuid()
  run('INSERT INTO users (id,nom,role,email,mdp_hash,pin_hash,totp_secret,created_at) VALUES (?,?,?,?,?,?,?,?)',
    id, nom, role, extra.email ?? null, extra.mdp ? hacher(extra.mdp) : null, extra.pin ? hacher(extra.pin) : null, extra.secret ?? null, maintenant())
  return id
}
user('Pharmacien démo', 'titulaire', { email: 'titulaire@demo.ci', mdp: 'demo-officine-2026', secret })
user('Dr Adjoint', 'pharmacien', { pin: '1111' })
user('Moussa', 'preparateur', { pin: '2222' })
const awa = user('Awa', 'vendeur', { pin: '1234' })
run("INSERT OR REPLACE INTO meta (k,v) VALUES ('officine','Pharmacie Démo')")

const fournisseurs = {}
for (const [nom, tel, delai] of [['Grossiste Répartiteur A', '+225 27 00 00 01', 2], ['Grossiste Répartiteur B', '+225 27 00 00 02', 3], ['Laboratoire Direct', '+225 27 00 00 03', 7]]) {
  const id = uuid(); fournisseurs[nom] = id
  run('INSERT INTO fournisseurs (id,nom,telephone,delai_jours) VALUES (?,?,?,?)', id, nom, tel, delai)
}
const [fA, fB, fC] = Object.values(fournisseurs)
const organismes = {}
for (const [nom, taux] of [['MUGEFCI', 80], ['Assurance démo', 70], ['Mutuelle entreprise', 90]]) { const id = uuid(); organismes[nom] = id; run('INSERT INTO organismes (id,nom,taux) VALUES (?,?,?)', id, nom, taux) }

const dans = (mois) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + mois); return d.toISOString().slice(0, 10) }
// [code, nom, dci, dosage, forme, famille, labo, prix vente, prix achat, seuil, max, emplacement, ordonnance, stupéfiant, générique, fournisseur, lots[[n°, mois, qté]]]
const CATALOGUE = [
  ['6001001', 'Doliprane 500 mg', 'paracétamol', '500 mg', 'comprimé', 'Antalgiques', 'Sanofi', 600, 380, 30, 120, 'A1', 0, 0, 0, fA, [['D101', 14, 80], ['D102', 22, 90]]],
  ['6001002', 'Paracétamol Biogaran 500 mg', 'paracétamol', '500 mg', 'comprimé', 'Antalgiques', 'Biogaran', 400, 220, 30, 120, 'A1', 0, 0, 1, fA, [['P201', 20, 150]]],
  ['6001003', 'Efferalgan 1 g', 'paracétamol', '1 g', 'comprimé effervescent', 'Antalgiques', 'UPSA', 1500, 1000, 15, 60, 'A2', 0, 0, 0, fA, [['E301', 11, 40]]],
  ['6001004', 'Ibuprofène 400 mg', 'ibuprofène', '400 mg', 'comprimé', 'Antalgiques', 'Mylan', 1200, 700, 20, 80, 'A2', 0, 0, 1, fB, [['I401', 9, 6]]],
  ['6001005', 'Spasfon', 'phloroglucinol', '80 mg', 'comprimé', 'Gastro-entérologie', 'Teva', 2100, 1500, 12, 40, 'B1', 0, 0, 0, fB, [['S501', 16, 35]]],
  ['6002001', 'Amoxicilline 500 mg (12 gél)', 'amoxicilline', '500 mg', 'gélule', 'Antibiotiques', 'Sandoz', 2200, 1300, 15, 50, 'C1', 1, 0, 1, fB, [['A601', 14, 25], ['A602', 3, 4]]],
  ['6002002', 'Augmentin 1 g', 'amoxicilline + acide clavulanique', '1 g', 'comprimé', 'Antibiotiques', 'GSK', 6500, 4800, 8, 30, 'C1', 1, 0, 0, fB, [['G701', 12, 18]]],
  ['6002003', 'Ciprofloxacine 500 mg', 'ciprofloxacine', '500 mg', 'comprimé', 'Antibiotiques', 'Mylan', 3500, 2100, 8, 30, 'C2', 1, 0, 1, fB, [['C801', 18, 20]]],
  ['6002004', 'Azithromycine 250 mg', 'azithromycine', '250 mg', 'comprimé', 'Antibiotiques', 'Sandoz', 4000, 2600, 6, 24, 'C2', 1, 0, 1, fB, [['Z901', 10, 14]]],
  ['6003001', 'Coartem 20/120 (6 cp)', 'artéméther + luméfantrine', '20/120 mg', 'comprimé', 'Antipaludiques', 'Novartis', 2500, 1700, 20, 80, 'D1', 0, 0, 0, fA, [['L011', 10, 60]]],
  ['6003002', 'Artéméther-Luméfantrine générique', 'artéméther + luméfantrine', '20/120 mg', 'comprimé', 'Antipaludiques', 'Ipca', 1800, 1050, 20, 80, 'D1', 0, 0, 1, fA, [['L012', 15, 70]]],
  ['6003003', 'Quinine 500 mg', 'quinine', '500 mg', 'comprimé', 'Antipaludiques', 'Sanofi', 2800, 1900, 6, 20, 'D2', 1, 0, 0, fA, [['Q021', 12, 15]]],
  ['6004001', 'Amlodipine 5 mg', 'amlodipine', '5 mg', 'comprimé', 'Cardiologie', 'Mylan', 3000, 1800, 10, 40, 'E1', 1, 0, 1, fB, [['M031', 16, 30]]],
  ['6004002', 'Enalapril 10 mg', 'énalapril', '10 mg', 'comprimé', 'Cardiologie', 'Teva', 2500, 1500, 10, 40, 'E1', 1, 0, 1, fB, [['N041', 14, 25]]],
  ['6004003', 'Atorvastatine 20 mg', 'atorvastatine', '20 mg', 'comprimé', 'Cardiologie', 'Sandoz', 4500, 2800, 8, 30, 'E2', 1, 0, 1, fB, [['T051', 20, 22]]],
  ['6005001', 'Metformine 850 mg', 'metformine', '850 mg', 'comprimé', 'Diabétologie', 'Merck', 3000, 1700, 10, 40, 'F1', 1, 0, 1, fB, []],
  ['6005002', 'Glibenclamide 5 mg', 'glibenclamide', '5 mg', 'comprimé', 'Diabétologie', 'Mylan', 2200, 1200, 8, 30, 'F1', 1, 0, 1, fB, [['B061', 13, 18]]],
  ['6006001', 'Vitamine C 500 mg (30 cp)', 'acide ascorbique', '500 mg', 'comprimé', 'Vitamines', 'Laborex', 1800, 950, 8, 30, 'G1', 0, 0, 0, fC, [['C071', 2, 12], ['C072', 12, 20]]],
  ['6006002', 'Becozyme', 'vitamines B', '', 'comprimé', 'Vitamines', 'Bayer', 2400, 1500, 6, 24, 'G1', 0, 0, 0, fC, [['B081', 15, 16]]],
  ['6006003', 'Fer + Acide folique', 'fumarate ferreux + acide folique', '', 'comprimé', 'Vitamines', 'Laborex', 1500, 800, 10, 40, 'G2', 0, 0, 1, fC, [['F091', 18, 30]]],
  ['6007001', 'Oméprazole 20 mg', 'oméprazole', '20 mg', 'gélule', 'Gastro-entérologie', 'Sandoz', 2800, 1500, 10, 40, 'B2', 0, 0, 1, fB, [['O101', 14, 28]]],
  ['6007002', 'SRO (sels de réhydratation)', 'sels de réhydratation orale', '', 'sachet', 'Gastro-entérologie', 'Laborex', 300, 150, 40, 150, 'B3', 0, 0, 1, fC, [['R111', 24, 120]]],
  ['6007003', 'Smecta', 'diosmectite', '3 g', 'sachet', 'Gastro-entérologie', 'Ipsen', 2600, 1800, 10, 40, 'B3', 0, 0, 0, fA, [['M121', 12, 24]]],
  ['6008001', 'Fucidine crème 2 %', 'acide fusidique', '2 %', 'crème', 'Dermatologie', 'Leo', 3800, 2600, 4, 16, 'H1', 1, 0, 0, fA, [['U131', 14, 9]]],
  ['6008002', 'Bétadine dermique 125 ml', 'povidone iodée', '10 %', 'solution', 'Dermatologie', 'Meda', 2900, 1900, 5, 20, 'H1', 0, 0, 0, fA, [['T141', 20, 11]]],
  ['6009001', 'Sérum physiologique (unidoses)', 'chlorure de sodium', '0,9 %', 'unidose', 'Hygiène et soins', 'Gilbert', 1500, 850, 10, 40, 'I1', 0, 0, 1, fC, [['S151', 18, 8]]],
  ['6009002', 'Compresses stériles (boîte 20)', '', '', 'dispositif', 'Hygiène et soins', 'Hartmann', 1000, 550, 10, 40, 'I2', 0, 0, 0, fC, [['K161', 30, 30]]],
  ['6009003', 'Gel hydro-alcoolique 100 ml', '', '', 'gel', 'Hygiène et soins', 'Local', 1200, 600, 10, 40, 'I2', 0, 0, 0, fC, [['H171', 24, 25]]],
  ['6010001', 'Doliprane enfant 2,4 % sirop', 'paracétamol', '2,4 %', 'sirop', 'Pédiatrie', 'Sanofi', 1800, 1200, 10, 40, 'J1', 0, 0, 0, fA, [['J181', 12, 18]]],
  ['6010002', 'Zinc enfant (diarrhée)', 'zinc', '20 mg', 'comprimé dispersible', 'Pédiatrie', 'Laborex', 1200, 650, 10, 30, 'J1', 0, 0, 1, fC, [['Z191', 18, 20]]],
  ['6011001', 'Tramadol 50 mg', 'tramadol', '50 mg', 'gélule', 'Psychotropes et stupéfiants', 'Mylan', 2400, 1500, 4, 12, 'S1', 1, 1, 1, fB, [['TR201', 12, 10]]],
  ['6011002', 'Diazépam 5 mg', 'diazépam', '5 mg', 'comprimé', 'Psychotropes et stupéfiants', 'Roche', 1800, 1100, 4, 12, 'S1', 1, 1, 0, fB, [['DZ211', 14, 8]]],
  ['6012001', 'Cétirizine 10 mg', 'cétirizine', '10 mg', 'comprimé', 'Allergologie', 'Mylan', 1800, 1000, 8, 30, 'K1', 0, 0, 1, fB, [['CT221', 16, 22]]],
  ['6012002', 'Loratadine 10 mg', 'loratadine', '10 mg', 'comprimé', 'Allergologie', 'Sandoz', 2000, 1100, 6, 24, 'K1', 0, 0, 1, fB, [['LT231', 15, 14]]],
  ['6013001', 'Albendazole 400 mg', 'albendazole', '400 mg', 'comprimé', 'Antiparasitaires', 'Sandoz', 1200, 600, 8, 30, 'D3', 0, 0, 1, fA, [['AL241', 20, 20]]],
  ['6014001', 'Test de grossesse', '', '', 'dispositif', 'Parapharmacie', 'Local', 1000, 500, 10, 30, 'L1', 0, 0, 0, fC, [['TG251', 24, 30]]],
  ['6014002', 'Préservatifs (boîte 3)', '', '', 'dispositif', 'Parapharmacie', 'Local', 500, 250, 20, 80, 'L1', 0, 0, 0, fC, [['PR261', 30, 60]]]
]
const produits = []
for (const [code, nom, dci, dosage, forme, famille, labo, prix, pa, seuil, max, empl, ordo, stup, gen, four, lots] of CATALOGUE) {
  const id = uuid()
  run('INSERT INTO produits (id,code,nom,dci,dosage,forme,famille,labo,prix,prix_achat,seuil,stock_max,emplacement,ordonnance,stupefiant,generique,fournisseur_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, code, nom, dci || null, dosage || null, forme, famille, labo, prix, pa, seuil, max, empl, ordo, stup, gen, four)
  const ls = lots.map(([n, mois, q]) => { const lid = uuid(); run('INSERT INTO lots (id,produit_id,numero,peremption,qte,prix_achat) VALUES (?,?,?,?,?,?)', lid, id, n, dans(mois), q, pa); return { id: lid, qte: q } })
  produits.push({ id, nom, prix, pa, ls, stup, poids: 0.2 + alea() * 2 })
}
const clients = []
for (const [nom, tel, org, adh, solde] of [['Kouassi Ama', '07 01 02 03 04', 'MUGEFCI', 'MG-48211', 0], ['Traoré Issouf', '05 44 55 66 77', null, null, 12500], ['Yao Marie', '01 23 45 67 89', 'Assurance démo', 'AD-1002', 0], ['Koné Fatou', '07 98 76 54 32', 'Mutuelle entreprise', 'ME-7788', 4500]]) {
  const id = uuid(); clients.push(id)
  run('INSERT INTO clients (id,nom,telephone,organisme_id,num_adherent,solde,created_at) VALUES (?,?,?,?,?,?,?)', id, nom, tel, org ? organismes[org] : null, adh, solde, maintenant())
}

// Historique de ventes sur 14 jours pour que le tableau de bord ne soit pas vide
const MODES = ['especes', 'especes', 'especes', 'wave', 'orange', 'mtn']
let compteur = 0
for (let j = 14; j >= 1; j--) {
  const date = new Date(Date.now() - j * 86400000)
  const nb = 10 + Math.floor(alea() * 14)
  for (let k = 0; k < nb; k++) {
    const quand = new Date(date); quand.setUTCHours(8 + Math.floor(alea() * 10), Math.floor(alea() * 60))
    const choix = []
    for (let n = 1 + Math.floor(alea() * 3); n > 0; n--) { const p = produits[Math.floor(alea() * produits.length * 0.8)]; if (!p.stup && p.ls.some((l) => l.qte > 3) && !choix.includes(p)) choix.push(p) }
    if (!choix.length) continue
    const vid = uuid(), iso = quand.toISOString(), numero = `V-${iso.slice(0, 10).replaceAll('-', '')}-${String(++compteur).padStart(4, '0')}`
    let total = 0
    const lignes = choix.map((p) => { const lot = p.ls.find((l) => l.qte > 3); const q = 1 + Math.floor(alea() * 2); lot.qte -= q; total += q * p.prix; return { p, lot, q } })
    const mode = MODES[Math.floor(alea() * MODES.length)]
    run("INSERT INTO ventes (id,numero,user_id,user_nom,total,mode,part_patient,paiement_statut,created_at,type,part_organisme) VALUES (?,?,?,?,?,?,?,'confirme',?,'vente',0)", vid, numero, awa, 'Awa', total, mode, total, iso)
    run('INSERT INTO paiements (id,vente_id,mode,montant,statut,created_at) VALUES (?,?,?,?,?,?)', uuid(), vid, mode, total, 'confirme', iso)
    for (const { p, lot, q } of lignes) {
      run('INSERT INTO lignes_vente (vente_id,produit_id,lot_id,nom,qte,prix,pa) VALUES (?,?,?,?,?,?,?)', vid, p.id, lot.id, p.nom, q, p.prix, p.pa)
      run('UPDATE lots SET qte=? WHERE id=?', lot.qte, lot.id)
    }
  }
}
console.log('Base de démonstration créée (35 produits, 14 jours de ventes).')
console.log('Titulaire : titulaire@demo.ci / demo-officine-2026')
console.log('Secret TOTP (à saisir dans Google Authenticator) :', secret)
console.log('PIN : Dr Adjoint 1111 (pharmacien), Moussa 2222 (préparateur), Awa 1234 (vendeuse)')
