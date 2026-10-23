// Password hashing — PBKDF2-SHA256 (Web Crypto), salted, iteration-counted.
// No plaintext passwords anywhere. Mirrors backend security module which uses
// bcrypt; both are adaptive one-way hashes. Dev seed passwords are documented
// in README and are hashed at seed time.

const DEFAULT_ITERATIONS = 120_000;

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

export async function hashPassword(password: string, saltHex?: string, iterations = DEFAULT_ITERATIONS) {
  const salt = saltHex ? hexToBuffer(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return { hash: bufferToHex(bits), salt: bufferToHex(salt.buffer as ArrayBuffer), iterations };
}

export async function verifyPassword(password: string, salt: string, iterations: number, expectedHash: string): Promise<boolean> {
  const { hash } = await hashPassword(password, salt, iterations);
  // Constant-time comparison
  if (hash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return diff === 0;
}

export function randomToken(): string {
  return bufferToHex(crypto.getRandomValues(new Uint8Array(24)).buffer as ArrayBuffer);
}

export function describePasswordPolicy(password: string): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (password.length < 8) problems.push('At least 8 characters');
  if (!/[A-Z]/.test(password)) problems.push('One uppercase letter');
  if (!/[a-z]/.test(password)) problems.push('One lowercase letter');
  if (!/[0-9]/.test(password)) problems.push('One digit');
  return { ok: problems.length === 0, problems };
}
