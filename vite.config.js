import { defineConfig } from 'vite';
import sitemap from 'vite-plugin-sitemap';

export default defineConfig({
  plugins: [
    // other plugins like react()
    sitemap({ 
      hostname: 'https://www.stageprophi.app',
      dynamicRoutes: ['/events', '/about', '/contact'] 
    }),
  ],
});