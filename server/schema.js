// Schéma de la base. Les anciennes bases (v1) sont migrées sans perte de données.

export const V1 = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, nom TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('titulaire','vendeur')),
  email TEXT UNIQUE, mdp_hash TEXT, pin_hash TEXT, totp_secret TEXT, actif INTEGER NOT NULL DEFAULT 1,
  echecs INTEGER NOT NULL DEFAULT 0, bloque_jusqua INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expire INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS produits (
  id TEXT PRIMARY KEY, code TEXT, nom TEXT NOT NULL, dci TEXT, forme TEXT, prix INTEGER NOT NULL CHECK (prix >= 0),
  seuil INTEGER NOT NULL DEFAULT 0, actif INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS ix_produits_nom ON produits(nom);
CREATE TABLE IF NOT EXISTS lots (
  id TEXT PRIMARY KEY, produit_id TEXT NOT NULL REFERENCES produits(id), numero TEXT NOT NULL,
  peremption TEXT NOT NULL, qte INTEGER NOT NULL DEFAULT 0, UNIQUE (produit_id, numero));
CREATE TABLE IF NOT EXISTS organismes (id TEXT PRIMARY KEY, nom TEXT NOT NULL, taux INTEGER NOT NULL CHECK (taux BETWEEN 0 AND 100), actif INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS ventes (
  id TEXT PRIMARY KEY, numero TEXT NOT NULL, user_id TEXT, user_nom TEXT, total INTEGER NOT NULL,
  mode TEXT NOT NULL, organisme TEXT, taux_prise_charge INTEGER NOT NULL DEFAULT 0, part_patient INTEGER NOT NULL,
  paiement_statut TEXT NOT NULL DEFAULT 'confirme', statut TEXT NOT NULL DEFAULT 'valide',
  hors_ligne INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, synced INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_ventes_date ON ventes(created_at);
CREATE TABLE IF NOT EXISTS lignes_vente (
  id INTEGER PRIMARY KEY AUTOINCREMENT, vente_id TEXT NOT NULL REFERENCES ventes(id), produit_id TEXT NOT NULL,
  lot_id TEXT, nom TEXT NOT NULL, qte INTEGER NOT NULL, prix INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mouvements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, produit_id TEXT NOT NULL, lot_id TEXT, type TEXT NOT NULL,
  qte INTEGER NOT NULL, ref TEXT, user_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, user_nom TEXT, action TEXT NOT NULL, detail TEXT, ip TEXT, created_at TEXT NOT NULL);
`

// Tables suivies par un horodatage « maj » (utilisé pour la synchronisation vers le cloud)
export const TABLES_MAJ = ['produits', 'lots', 'organismes', 'ventes', 'clients', 'fournisseurs', 'commandes', 'receptions', 'caisse_sessions', 'bordereaux']

const V2_TABLES = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, nom TEXT NOT NULL, telephone TEXT, organisme_id TEXT, num_adherent TEXT, notes TEXT,
  solde INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, maj TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_clients_nom ON clients(nom);
CREATE TABLE IF NOT EXISTS fournisseurs (
  id TEXT PRIMARY KEY, nom TEXT NOT NULL, telephone TEXT, email TEXT, delai_jours INTEGER NOT NULL DEFAULT 0,
  actif INTEGER NOT NULL DEFAULT 1, maj TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS commandes (
  id TEXT PRIMARY KEY, numero TEXT NOT NULL, fournisseur_id TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'envoyee',
  total_estime INTEGER NOT NULL DEFAULT 0, note TEXT, user_id TEXT, created_at TEXT NOT NULL, maj TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS lignes_commande (
  id INTEGER PRIMARY KEY AUTOINCREMENT, commande_id TEXT NOT NULL, produit_id TEXT NOT NULL, nom TEXT NOT NULL,
  qte_commandee INTEGER NOT NULL, qte_recue INTEGER NOT NULL DEFAULT 0, prix_achat INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS receptions (
  id TEXT PRIMARY KEY, numero TEXT NOT NULL, fournisseur_id TEXT NOT NULL, commande_id TEXT, num_bl TEXT,
  total INTEGER NOT NULL DEFAULT 0, paye INTEGER NOT NULL DEFAULT 0, echeance TEXT, user_id TEXT, user_nom TEXT,
  created_at TEXT NOT NULL, maj TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS lignes_reception (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reception_id TEXT NOT NULL, produit_id TEXT NOT NULL, nom TEXT NOT NULL,
  lot_numero TEXT NOT NULL, peremption TEXT NOT NULL, qte INTEGER NOT NULL, prix_achat INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS paiements_fournisseur (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reception_id TEXT NOT NULL, montant INTEGER NOT NULL, mode TEXT NOT NULL,
  user_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS caisse_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_nom TEXT, ouverte_le TEXT NOT NULL, fermee_le TEXT,
  fond_initial INTEGER NOT NULL DEFAULT 0, especes_attendues INTEGER, especes_comptees INTEGER, ecart INTEGER,
  statut TEXT NOT NULL DEFAULT 'ouverte', note TEXT, maj TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS mouvements_caisse (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('entree','sortie')),
  montant INTEGER NOT NULL, motif TEXT NOT NULL, user_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS paiements (
  id TEXT PRIMARY KEY, vente_id TEXT NOT NULL, mode TEXT NOT NULL, montant INTEGER NOT NULL,
  statut TEXT NOT NULL DEFAULT 'confirme', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_paiements_vente ON paiements(vente_id);
CREATE TABLE IF NOT EXISTS reglements_client (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, montant INTEGER NOT NULL, mode TEXT NOT NULL,
  session_id TEXT, user_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS registre_stupefiants (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, produit_id TEXT NOT NULL, produit_nom TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('entree','sortie')), qte INTEGER NOT NULL, solde INTEGER NOT NULL,
  patient TEXT, prescripteur TEXT, num_ordonnance TEXT, ref TEXT, user_nom TEXT);
CREATE TABLE IF NOT EXISTS inventaires (
  id TEXT PRIMARY KEY, nom TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'ouvert', ouvert_le TEXT NOT NULL, clos_le TEXT, user_nom TEXT);
CREATE TABLE IF NOT EXISTS lignes_inventaire (
  id INTEGER PRIMARY KEY AUTOINCREMENT, inventaire_id TEXT NOT NULL, lot_id TEXT NOT NULL, produit_id TEXT NOT NULL,
  produit_nom TEXT NOT NULL, lot_numero TEXT NOT NULL, qte_theorique INTEGER NOT NULL, qte_comptee INTEGER,
  UNIQUE (inventaire_id, lot_id));
CREATE TABLE IF NOT EXISTS bordereaux (
  id TEXT PRIMARY KEY, numero TEXT NOT NULL, organisme_id TEXT NOT NULL, organisme_nom TEXT, du TEXT, au TEXT,
  nb_ventes INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, statut TEXT NOT NULL DEFAULT 'emis',
  created_at TEXT NOT NULL, paye_le TEXT, maj TEXT NOT NULL DEFAULT '');
`

const AJOUTS = {
  produits: [
    ['dosage', 'TEXT'], ['labo', 'TEXT'], ['famille', 'TEXT'], ['prix_achat', 'INTEGER NOT NULL DEFAULT 0'],
    ['stock_max', 'INTEGER NOT NULL DEFAULT 0'], ['emplacement', 'TEXT'], ['ordonnance', 'INTEGER NOT NULL DEFAULT 0'],
    ['stupefiant', 'INTEGER NOT NULL DEFAULT 0'], ['generique', 'INTEGER NOT NULL DEFAULT 0'], ['fournisseur_id', 'TEXT'],
    ['maj', "TEXT NOT NULL DEFAULT ''"]
  ],
  lots: [['prix_achat', 'INTEGER NOT NULL DEFAULT 0'], ['maj', "TEXT NOT NULL DEFAULT ''"]],
  organismes: [['maj', "TEXT NOT NULL DEFAULT ''"]],
  ventes: [
    ['type', "TEXT NOT NULL DEFAULT 'vente'"], ['client_id', 'TEXT'], ['client_nom', 'TEXT'], ['prescripteur', 'TEXT'],
    ['num_ordonnance', 'TEXT'], ['num_adherent', 'TEXT'], ['organisme_id', 'TEXT'], ['remise', 'INTEGER NOT NULL DEFAULT 0'],
    ['part_organisme', 'INTEGER NOT NULL DEFAULT 0'], ['credit', 'INTEGER NOT NULL DEFAULT 0'], ['session_id', 'TEXT'],
    ['bordereau_id', 'TEXT'], ['retour_de', 'TEXT'], ['maj', "TEXT NOT NULL DEFAULT ''"]
  ],
  lignes_vente: [['pa', 'INTEGER NOT NULL DEFAULT 0'], ['retourne', 'INTEGER NOT NULL DEFAULT 0']]
}

const colonnes = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
const HORODATAGE = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"

export function migrer(db) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)')
  const version = Number(db.prepare("SELECT v FROM meta WHERE k='schema_version'").get()?.v ?? 0)
  if (version >= 2) return
  db.exec('PRAGMA foreign_keys=OFF')
  db.exec('BEGIN')
  try {
    db.exec(V1)
    // La table users n'acceptait que 2 rôles : on la reconstruit sans cette contrainte
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get()?.sql ?? ''
    if (/CHECK\s*\(\s*role/i.test(sql)) {
      db.exec(`CREATE TABLE users_new (
        id TEXT PRIMARY KEY, nom TEXT NOT NULL, role TEXT NOT NULL, email TEXT UNIQUE, mdp_hash TEXT, pin_hash TEXT,
        totp_secret TEXT, actif INTEGER NOT NULL DEFAULT 1, echecs INTEGER NOT NULL DEFAULT 0,
        bloque_jusqua INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
        INSERT INTO users_new SELECT id,nom,role,email,mdp_hash,pin_hash,totp_secret,actif,echecs,bloque_jusqua,created_at FROM users;
        DROP TABLE users; ALTER TABLE users_new RENAME TO users;`)
    }
    db.exec(V2_TABLES)
    for (const [t, cols] of Object.entries(AJOUTS)) {
      const existantes = colonnes(db, t)
      for (const [c, def] of cols) if (!existantes.includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`)
    }
    // Reprise des anciennes ventes : un paiement unique et la part organisme
    db.exec(`INSERT INTO paiements (id,vente_id,mode,montant,statut,created_at)
      SELECT lower(hex(randomblob(16))), id, mode, part_patient, paiement_statut, created_at FROM ventes
      WHERE id NOT IN (SELECT vente_id FROM paiements) AND part_patient > 0;
      UPDATE ventes SET part_organisme = total - part_patient WHERE part_organisme = 0 AND total <> part_patient;`)
    // Index et déclencheurs de « maj »
    for (const t of TABLES_MAJ) {
      db.exec(`CREATE INDEX IF NOT EXISTS ix_${t}_maj ON ${t}(maj);
        UPDATE ${t} SET maj = ${HORODATAGE} WHERE maj = '';
        DROP TRIGGER IF EXISTS maj_ins_${t}; DROP TRIGGER IF EXISTS maj_upd_${t};
        CREATE TRIGGER maj_ins_${t} AFTER INSERT ON ${t} WHEN NEW.maj = '' BEGIN UPDATE ${t} SET maj = ${HORODATAGE} WHERE rowid = NEW.rowid; END;
        CREATE TRIGGER maj_upd_${t} AFTER UPDATE ON ${t} WHEN NEW.maj = OLD.maj BEGIN UPDATE ${t} SET maj = ${HORODATAGE} WHERE rowid = NEW.rowid; END;`)
    }
    db.exec(`CREATE INDEX IF NOT EXISTS ix_lignes_vente_vente ON lignes_vente(vente_id);
      CREATE INDEX IF NOT EXISTS ix_lignes_vente_produit ON lignes_vente(produit_id);
      CREATE INDEX IF NOT EXISTS ix_lots_produit ON lots(produit_id);
      CREATE INDEX IF NOT EXISTS ix_mouvements_produit ON mouvements(produit_id);
      CREATE INDEX IF NOT EXISTS ix_produits_code ON produits(code);
      CREATE INDEX IF NOT EXISTS ix_produits_dci ON produits(dci);`)
    db.exec("INSERT OR REPLACE INTO meta (k,v) VALUES ('schema_version','2')")
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  } finally {
    db.exec('PRAGMA foreign_keys=ON')
  }
}
