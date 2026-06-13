import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
    rollupOptions: {
      external: [
        /^@solana\//,
        /^@solana-program\//,
        '@solana/kit',
        '@solana-program/system',
        '@solana/web3.js',
        '@solana/wallet-adapter-base'
      ]
    },
    rolldownOptions: {
      external: [
        /^@solana\//,
        /^@solana-program\//,
        '@solana/kit',
        '@solana-program/system',
        '@solana/web3.js',
        '@solana/wallet-adapter-base'
      ]
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})

