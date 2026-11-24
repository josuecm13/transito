import { defineConfig } from 'vite';
import { isthmusBake } from './tools/vite-isthmus.ts';

export default defineConfig({
  plugins: [isthmusBake()],
});
