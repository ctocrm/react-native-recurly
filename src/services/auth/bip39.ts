/**
 * BIP-39 mnemonic codec (Phase A recovery phrase).
 *
 * generateRecoveryPhrase(): 128 random bits → 4-bit SHA-256 checksum →
 * 132 bits → 12 words from the canonical English list. Recovery is the
 * inverse: words → indices → entropy+checksum bits → checksum verify.
 *
 * Pure bit surgery over expo-crypto primitives — the phrase's KEY material
 * is derived natively (VaultModule.pbkdf2Sha256) with the space-joined
 * phrase as the password; this module never derives keys.
 */
import * as Crypto from "expo-crypto";

import { BIP39_ENGLISH } from "./bip39Wordlist";

const ENTROPY_BYTES = 16; // 128 bits → 12 words
const CS_BITS = (ENTROPY_BYTES * 8) / 32; // 4 bits (BIP-39: CS = ENT/32)
const TOTAL_BITS = ENTROPY_BYTES * 8 + CS_BITS; // 132
const WORD_BITS = 11;
const WORDS = TOTAL_BITS / WORD_BITS; // 12

const INDEX_BY_WORD = new Map<string, number>(
  BIP39_ENGLISH.map((word, index) => [word, index]),
);

function bytesToBits(bytes: Uint8Array): boolean[] {
  const bits: boolean[] = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i -= 1) bits.push((byte & (1 << i)) !== 0);
  }
  return bits;
}

function bitsToBytes(bits: boolean[]): Uint8Array {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, i) => {
    if (bit) out[Math.floor(i / 8)] |= 1 << (7 - (i % 8));
  });
  return out;
}

async function sha256Bits(bytes: Uint8Array): Promise<boolean[]> {
  const hash = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes as BufferSource,
  );
  return bytesToBits(new Uint8Array(hash));
}

/**
 * Deterministic encoding for tests + recovery tooling: canonical BIP-39
 * vector (all-zero entropy -> "abandon ability able ... about") proves the
 * bit surgery against the published spec, not just against itself.
 */
export async function mnemonicFromEntropy(
  entropy: Uint8Array,
): Promise<string[]> {
  if (entropy.length !== ENTROPY_BYTES) {
    throw new Error(`entropy must be ${ENTROPY_BYTES} bytes`);
  }
  const hashBits = (await sha256Bits(entropy)).slice(0, CS_BITS);
  const bits = [...bytesToBits(entropy), ...hashBits];
  const words: string[] = [];
  for (let w = 0; w < WORDS; w += 1) {
    let index = 0;
    for (let b = 0; b < WORD_BITS; b += 1) {
      index = (index << 1) | (bits[w * WORD_BITS + b] ? 1 : 0);
    }
    words.push(BIP39_ENGLISH[index]);
  }
  return words;
}

export async function generateRecoveryPhrase(): Promise<string[]> {
  const entropy = new Uint8Array(Crypto.getRandomBytes(ENTROPY_BYTES));
  return mnemonicFromEntropy(entropy);
}

/** Checksum-verified validation for the recovery entry flow. */
export async function validateRecoveryPhrase(
  words: string[],
): Promise<boolean> {
  if (words.length !== WORDS) return false;
  const indices: number[] = [];
  for (const word of words) {
    const index = INDEX_BY_WORD.get(word.trim().toLowerCase());
    if (index === undefined) return false;
    indices.push(index);
  }
  const bits: boolean[] = [];
  for (const index of indices) {
    for (let b = WORD_BITS - 1; b >= 0; b -= 1) bits.push((index >> b & 1) === 1);
  }
  const entropyBits = bits.slice(0, ENTROPY_BYTES * 8);
  const csBits = bits.slice(ENTROPY_BYTES * 8);
  const hashBits = await sha256Bits(bitsToBytes(entropyBits));
  return hashBits.slice(0, CS_BITS).every((bit, i) => bit === csBits[i]);
}
