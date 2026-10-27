import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(frontendRoot, '..');

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(frontendRoot, 'src'),
      '@assets': path.resolve(frontendRoot, 'public'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: frontendRoot,
  build: {
    outDir: path.resolve(frontendRoot, 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { allow: [projectRoot] },
  },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
});
