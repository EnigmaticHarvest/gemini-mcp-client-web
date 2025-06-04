import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'; // Import for ESM __dirname equivalent

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // This ensures that imports from 'mcp-chat-lib' in the webapp
      // resolve to the source code of the library during development.
      // For production builds, it will use the built version from node_modules.
      // Adjust if your workspace setup handles this differently or if you prefer linking to dist.
      'mcp-chat-lib': path.resolve(__dirname, '../mcp-chat-lib/src'), 
      // '@modelcontextprotocol/sdk': path.resolve('/Users/mbiswas/Downloads/typescript-sdk-main/src')
    }
  },
  build: {
    sourcemap: true // Enable sourcemaps for production builds
  },
})

