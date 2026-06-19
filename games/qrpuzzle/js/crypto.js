// AES-GCM level decryption. Mirrors build/build.mjs: key = SHA-256(numberString),
// blob layout = [12-byte IV][ciphertext+tag]. Decryption failure (wrong number)
// throws, which the game treats as an incorrect answer.

async function deriveKey(num) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(num));
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['decrypt']);
}

// Returns the parsed level object, or throws on a wrong code / corrupt blob.
export async function decryptLevel(num, blob) {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const key = await deriveKey(num);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt)); // trailing pad is whitespace, ignored
}

// Fetch and decrypt the next level blob from the levels/ directory.
export async function fetchAndDecrypt(filename, num) {
  const res = await fetch('levels/' + filename, { cache: 'no-store' });
  if (!res.ok) throw new Error('could not load level data (' + res.status + ')');
  const buf = await res.arrayBuffer();
  return decryptLevel(num, buf);
}
