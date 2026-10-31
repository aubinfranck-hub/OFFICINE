// Données de démonstration (fictives) : à ne PAS utiliser en production.
import { ouvrirBase, uuid, hacher, nouveauSecretTotp, maintenant } from './lib.js'

const db = ouvrirBase(process.env.DB || 'lgo.db')
if (db.prepare("SELECT 1 x FROM users WHERE role='titulaire'").get()) { console.log('Base déjà initialisée.'); process.exit(0) }

const secret = nouveauSecretTotp()
const ajout = (nom, role, extra = {}) => {
  const id = uuid()
  db.prepare('INSERT INTO users (id,nom,role,email,mdp_hash,pin_hash,totp_secret,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, nom, role, extra.email ?? null, extra.mdp ? hacher(extra.mdp) : null, extra.pin ? hacher(extra.pin) : null, extra.secret ?? null, maintenant())
  return id
}
ajout('Pharmacien démo', 'titulaire', { email: 'titulaire@demo.ci', mdp: 'demo-officine-2026', secret })
ajout('Awa', 'vendeur', { pin: '1234' })
ajout('Koffi', 'vendeur', { pin: '5678' })
db.prepare("INSERT OR REPLACE INTO meta (k,v) VALUES ('officine','Pharmacie Démo')").run()

const dans = (mois) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + mois); return d.toISOString().slice(0, 10) }
const produits = [
  ['Paracétamol 500 mg (16 cp)', 'paracétamol', 'comprimé', 500, 20, [['P001', 8, 40], ['P002', 20, 60]]],
  ['Amoxicilline 500 mg (12 gél)', 'amoxicilline', 'gélule', 2200, 10, [['A001', 14, 25]]],
  ['Artéméther-Luméfantrine (6 cp)', 'antipaludique', 'comprimé', 2500, 15, [['L001', 10, 30]]],
  ['Sérum physiologique (unidoses)', 'chlorure de sodium', 'unidose', 1500, 10, [['S001', 18, 8]]],
  ['Vitamine C 500 mg (30 cp)', 'acide ascorbique', 'comprimé', 1800, 8, [['C001', 2, 12], ['C002', 12, 20]]],
  ['Ibuprofène 400 mg (20 cp)', 'ibuprofène', 'comprimé', 1200, 12, [['I001', 9, 4]]],
  ['SRO (sels de réhydratation)', 'sels de réhydratation', 'sachet', 300, 30, [['R001', 24, 100]]],
  ['Metformine 850 mg (30 cp)', 'metformine', 'comprimé', 3000, 6, []]
]
for (const [nom, dci, forme, prix, seuil, lots] of produits) {
  const id = uuid()
  db.prepare('INSERT INTO produits (id,nom,dci,forme,prix,seuil) VALUES (?,?,?,?,?,?)').run(id, nom, dci, forme, prix, seuil)
  for (const [num, mois, qte] of lots) db.prepare('INSERT INTO lots (id,produit_id,numero,peremption,qte) VALUES (?,?,?,?,?)').run(uuid(), id, num, dans(mois), qte)
}
for (const [nom, taux] of [['MUGEFCI', 80], ['Assurance démo', 70]]) db.prepare('INSERT INTO organismes (id,nom,taux) VALUES (?,?,?)').run(uuid(), nom, taux)
console.log('Base de démonstration créée.')
console.log('Titulaire : titulaire@demo.ci / demo-officine-2026')
console.log('Secret TOTP (à saisir dans Google Authenticator ou Aegis) :', secret)
console.log('Vendeuses (PIN) : Awa 1234, Koffi 5678')
