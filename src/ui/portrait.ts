// Bust portraits for the ledger pages (public/art/port_<sprite>.jpg, cut by tools/make-portraits.py).
// A survivor whose sprite has no portrait falls back to the full-body sprite, framed the same way.
import { spriteUrl } from '../assets';

export function portraitUrl(sprite: string) {
  return `${import.meta.env.BASE_URL}art/port_${sprite}.jpg`;
}

/** An <img> of a survivor's bust. cls styles the frame (e.g. 'portrait', 'dead'). */
export function portraitImg(sprite: string, cls = 'portrait') {
  const fb = spriteUrl(sprite).replace(/'/g, '%27');
  return `<img class="${cls}" src="${portraitUrl(sprite)}" alt="" loading="lazy" onerror="this.onerror=null;this.classList.add('fallback');this.src='${fb}'">`;
}
