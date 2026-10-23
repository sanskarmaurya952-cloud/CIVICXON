// Storage abstraction.
//
// DEVELOPMENT: LocalFileStorage keeps media as (compressed) data URLs inside the
// persisted database document — zero infra, works offline, survives reload.
// PRODUCTION:  swap in S3CompatibleStorage (see storage doc below / backend
// /backend/app/storage.py) backed by AWS S3 / MinIO / Cloudflare R2. Object
// keys are stored on Media.storageKey; bytes are never embedded in rows.
//
// The interface is intentionally minimal so the engine never cares which
// backend persists the bytes.

export interface FileStorage {
  save(input: { fileName: string; mimeType: string; dataUrl: string }): Promise<{ storageKey: string }>;
  url(storageKey: string): string;
  delete(storageKey: string): Promise<void>;
}

export const LOCAL_FILE_STORAGE: FileStorage = {
  async save({ dataUrl }) {
    // In local development the data URL *is* the object; key = content ref.
    return { storageKey: dataUrl };
  },
  url(storageKey: string) {
    return storageKey;
  },
  async delete() {
    // Data URL lives with the owning row; removing the row removes the bytes.
  },
};

/** Compress an uploaded/captured photo to a JPEG data URL (max dimension bound). */
export async function compressImage(file: File, maxDim = 960, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}

/** Average-hash (aHash) perceptual hash of an image data URL — real image similarity. Browser-only; returns null outside DOM. */
export async function perceptualHash(dataUrl: string): Promise<string | null> {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return null;
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  const S = 16;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.drawImage(img, 0, 0, S, S);
  const pixels = ctx.getImageData(0, 0, S, S).data;
  const gray: number[] = [];
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const g = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    gray.push(g);
    sum += g;
  }
  const avg = sum / gray.length;
  let bits = '';
  for (const g of gray) bits += g >= avg ? '1' : '0';
  // Pack 256 bits into 64 hex chars
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  const nib: Record<string, number> = {};
  let d = 0;
  const bitcount = (n: number) => {
    if (nib[n] !== undefined) return nib[n];
    let x = n, c = 0;
    while (x) { c += x & 1; x >>= 1; }
    return (nib[n] = c);
  };
  for (let i = 0; i < a.length; i++) {
    d += bitcount(parseInt(a[i], 16) ^ parseInt(b[i], 16));
  }
  return d;
}

/** 0..1 similarity from aHash hamming distance (256-bit hash). */
export function imageSimilarity(a?: string | null, b?: string | null): number {
  const d = hammingDistance(a ?? '', b ?? '');
  if (!Number.isFinite(d)) return 0;
  return Math.max(0, 1 - d / 256);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Fetch a same-origin asset (browser) or read from public/ (node/test) and return its data URL. */
export async function assetToDataUrl(path: string): Promise<string> {
  if (typeof window === 'undefined') {
    // Node test environment — read the file from ./public
    try {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const buf = readFileSync(join(process.cwd(), 'public', path));
      const ext = path.split('.').pop()?.toLowerCase() ?? 'jpg';
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      // Couldn't read the asset (tiny SVG placeholder keeps seeds working)
      return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23333"/></svg>';
    }
  }
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load asset ${path}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function uid(prefix = ''): string {
  const rnd = crypto.getRandomValues(new Uint8Array(9));
  const s = Array.from(rnd).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}${s}`;
}

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024; // 6 MB pre-compression
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
