import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'

export function ouvrirBase(fichier) {
  const db = new DatabaseSync(fichier)
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
  db.exec(`
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
`)
  return db
}

export const maintenant = () => new Date().toISOString()
export const uuid = () => crypto.randomUUID()
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

// Hachage scrypt (natif Node : aucune dépendance à installer)
export function hacher(secret) {
  const sel = crypto.randomBytes(16).toString('hex')
  return `scrypt$${sel}$${crypto.scryptSync(secret, sel, 32).toString('hex')}`
}
export function verifier(secret, hash) {
  if (!hash) return false
  const [, sel, h] = hash.split('$')
  const calc = crypto.scryptSync(secret, sel, 32)
  const ref = Buffer.from(h, 'hex')
  return ref.length === calc.length && crypto.timingSafeEqual(calc, ref)
}

// TOTP (RFC 6238) : application d'authentification, aucun SMS
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function b32enc(buf) {
  let bits = '', out = ''
  for (const b of buf) bits += b.toString(2).padStart(8, '0')
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]
  return out
}
export function b32dec(s) {
  let bits = ''
  for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, '0')
  const o = []
  for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(o)
}
export const nouveauSecretTotp = () => b32enc(crypto.randomBytes(20))
export function hotp(secret, compteur) {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(compteur))
  const h = crypto.createHmac('sha1', b32dec(secret)).update(b).digest()
  const o = h[19] & 15
  const n = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000
  return String(n).padStart(6, '0')
}
export function totpValide(secret, code, now = Date.now()) {
  const c = Math.floor(now / 30000)
  return [-1, 0, 1].some((d) => hotp(secret, c + d) === String(code).trim())
}

export function dernierJourDuMois(ym) {
  const [a, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`
}
export function normaliserPeremption(p) {
  if (/^\d{4}-\d{2}$/.test(p)) return dernierJourDuMois(p)
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p
  throw new Erreur(400, 'Date de péremption invalide (AAAA-MM ou AAAA-MM-JJ)')
}

export class Erreur extends Error {
  constructor(code, message) { super(message); this.code = code }
}
