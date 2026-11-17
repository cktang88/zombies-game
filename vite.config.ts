import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

// the generated sprites on disk (ids), so the preload skips world props not generated yet
const spriteDir = fileURLToPath(new URL('./public/sprites', import.meta.url));
const spriteFiles = fs.existsSync(spriteDir) ? fs.readdirSync(spriteDir).filter((f) => /\.(png|jpg)$/.test(f)).map((f) => f.replace(/\.\w+$/, '')) : [];
export default defineConfig({
  base: './',
  define: { __SPRITE_FILES__: JSON.stringify(spriteFiles) },
  build: {
    rollupOptions: {
      // the game, plus the dev sound board (soundboard.html) and anim lab (animlab.html) and fx lab (fxlab.html)
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        soundboard: fileURLToPath(new URL('./soundboard.html', import.meta.url)),
        animlab: fileURLToPath(new URL('./animlab.html', import.meta.url)),
        fxlab: fileURLToPath(new URL('./fxlab.html', import.meta.url)),
      },
    },
  },
});
