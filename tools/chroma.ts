// Soft magenta (#FF00FF) chroma key + despill, same as tools/gen-sprites.ts.
import sharp from 'sharp';

export async function chromaKey(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const mag = Math.min(r, b) - g; // how "magenta" the pixel is
    if (mag > 90 && r > 120 && b > 120) data[i + 3] = 0;
    else if (mag > 35) {
      const a = 1 - (mag - 35) / 55;
      data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, a)));
      data[i] = Math.min(r, g + 25);
      data[i + 2] = Math.min(b, g + 25);
    } else if (mag > 8) {
      data[i] = r - (mag >> 1);
      data[i + 2] = b - (mag >> 1);
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}
