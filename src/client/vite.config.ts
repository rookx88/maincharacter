import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000'
    }
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          auth: ['./src/context/AuthContext.tsx']
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'crypto': path.resolve(__dirname, 'empty-module.js'),
      'stream': path.resolve(__dirname, 'empty-module.js'),
      'util': path.resolve(__dirname, 'empty-module.js')
    }
  },
  define: {
    'process.env': {}
  }
}); 