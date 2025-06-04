# MCP Chat Web Monorepo

This project is a monorepo for a chat application that interacts with the Model Context Protocol (MCP).
It includes a reusable chat library and a web application demonstrating its use.

## Monorepo Structure

This project is managed using pnpm workspaces. The main packages are:

- `packages/mcp-chat-lib`: A TypeScript library providing core chat functionalities, including:
  - Interaction with Gemini models.
  - Integration with MCP-compliant tool servers.
  - User input processing and chat history management.
- `packages/mcp-chat-webapp`: A React-based web application that uses `mcp-chat-lib` to provide a user interface for the chat.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18.x or later recommended)
- [pnpm](https://pnpm.io/) (v8.x or later recommended)

## Setup

1.  **Clone the repository** (if you haven't already).
2.  **Install dependencies** from the root of the monorepo:
    ```bash
    pnpm install
    ```
    This command will install dependencies for all packages in the workspace.

## Development

### Building the Chat Library (`mcp-chat-lib`)

To build the `mcp-chat-lib` package, run the following command from the monorepo root:

```bash
pnpm run lib:build
```
This will compile the TypeScript source code in `packages/mcp-chat-lib/src` to JavaScript in `packages/mcp-chat-lib/dist`.

### Running the Web Application (`mcp-chat-webapp`)

To run the web application in development mode (with hot reloading), run the following command from the monorepo root:

```bash
pnpm run webapp:dev
```
This will typically start a development server (e.g., Vite) accessible at `http://localhost:5173`.

### Building the Web Application for Production

To build the web application for production, run the following command from the monorepo root:

```bash
pnpm run webapp:build
```
This will create an optimized production build in the `packages/mcp-chat-webapp/dist` directory (or as configured by the bundler).

## Key Technologies

- **TypeScript**: For type safety and modern JavaScript features.
- **React**: For building the user interface of the web application.
- **Vite**: As the build tool and development server for the web application.
- **pnpm**: For efficient package management in the monorepo.
- **@google/generative-ai**: For interacting with Google's Gemini models.
- **@modelcontextprotocol/sdk**: For communication with MCP tool servers.

## Notes on Local SDK Development

Your current `packages/mcp-chat-webapp/vite.config.ts` includes aliases that may point to local source directories for `mcp-chat-lib` and potentially for a local checkout of the `@modelcontextprotocol/sdk` (e.g., `/Users/mbiswas/Downloads/typescript-sdk-main/src`).

This setup is beneficial for simultaneous development and debugging of these libraries alongside the web application.

- **`mcp-chat-lib` alias**: Ensures that the web app uses the live source code from `packages/mcp-chat-lib/src` during development, providing immediate feedback for changes in the library.
- **`@modelcontextprotocol/sdk` alias**: If you are actively developing or debugging a local version of this SDK, this alias directs Vite to use your local copy instead of the version from `node_modules`.

**Important Considerations for the SDK Alias:**
- The path `/Users/mbiswas/Downloads/typescript-sdk-main/src` is specific to your local machine. If others collaborate on this project or if you deploy it, this alias will need to be removed or made conditional to avoid build failures in other environments.
- When aliasing to a local SDK like this, ensure that the local SDK's source code is compatible with how it's being imported and used in `mcp-chat-lib`.
- You may need to adjust build configurations or ensure the local SDK is built if it requires a compilation step for its `src` directory to be consumable.

For general development or if not working on the SDK itself, you would typically remove the alias for `@modelcontextprotocol/sdk` to use the version installed via pnpm in `node_modules`.

## Source Maps and Debugging

Source maps are configured for both `mcp-chat-lib` (via `tsconfig.json`) and `mcp-chat-webapp` (via `vite.config.ts`) to facilitate debugging of the original TypeScript code in the browser.

- Debugging for `mcp-chat-lib` and `mcp-chat-webapp` should work as expected.
- Debugging for `@modelcontextprotocol/sdk` might show compiled JavaScript if its published source maps have issues or if you are not using the local alias with source code correctly mapped.

---

This README provides a starting point. Feel free to expand it with more details about your project's architecture, deployment, testing, or specific features. 