import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: { runes: true },
      adapter: adapter({ pages: 'build', assets: 'build', fallback: 'index.html', strict: false })
    })
  ],
  resolve: {
    alias: {
      $lib: '/src/lib'
    }
  },
  clearScreen: false,
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  build: { target: 'chrome110', sourcemap: false, chunkSizeWarningLimit: 700 }
});
