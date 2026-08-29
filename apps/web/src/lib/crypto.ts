import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Get the encryption key from environment variable.
 * In production, ENCRYPTION_SECRET MUST be set to a random 32-byte string.
 * In development, we use a fallback (with a warning) for convenience.
 */
function getSecretKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;

  if (!secret || secret === 'codeon-secret-key-32-bytes-long!!') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ENCRYPTION_SECRET is not set or is using the default value. ' +
        'Generate a random key: openssl rand -hex 32, and set it in your environment.'
      );
    }
    // Development fallback
    console.warn('[Crypto] Using default encryption key. Set ENCRYPTION_SECRET in .env for production.');
    return Buffer.from('codeon-secret-key-32-bytes-long!!'.slice(0, 32));
  }

  // Use first 32 bytes of the hex-encoded secret
  const key = Buffer.from(secret, 'hex');
  if (key.length < 32) {
    // If it's not hex, use raw bytes (padded/truncated to 32)
    return Buffer.from(secret.padEnd(32, '0').slice(0, 32));
  }
  return key.slice(0, 32);
}

export function encryptKey(text: string): string {
  if (!text) return '';
  const key = getSecretKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decryptKey(text: string): string {
  if (!text) return '';
  try {
    const key = getSecretKey();
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch {
    return '';
  }
}
