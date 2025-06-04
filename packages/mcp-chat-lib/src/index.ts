// packages/mcp-chat-lib/src/index.ts
export { ChatController } from './ChatController.js';
export * from './types.js'; // Export all types

// Also export config service functions if they are to be used directly by the webapp
// though ChatController should ideally manage this.
export {
    addServer,
    listServers,
    removeServer,
    setDefaultServer,
    getDefaultServer,
    getServer
} from './configService.js';

