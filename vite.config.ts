import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      // the game, plus the dev sound board (soundboard.html) and anim lab (animlab.html)
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        soundboard: fileURLToPath(new URL('./soundboard.html', import.meta.url)),
        animlab: fileURLToPath(new URL('./animlab.html', import.meta.url)),
      },
    },
  },
});
