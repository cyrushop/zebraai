import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE=1 builds one self-contained HTML file (easy to email or open offline).
export default defineConfig({
  base: './',
  plugins: [react(), ...(process.env.SINGLE ? [viteSingleFile()] : [])],
  build: { outDir: process.env.SINGLE ? 'dist-single' : 'dist' },
});
