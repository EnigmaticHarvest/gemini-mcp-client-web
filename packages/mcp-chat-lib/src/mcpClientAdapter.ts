// packages/mcp-chat-lib/src/mcpClientAdapter.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolSchema as McpToolSchemaZod } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import chalk from 'chalk';

export type McpToolSchema = z.infer<typeof McpToolSchemaZod>;

type CallToolFnReturnType = ReturnType<Client["callTool"]>;
export type CallToolResponse = CallToolFnReturnType extends Promise<infer R> ? R : CallToolFnReturnType;
type ListToolsFnReturnType = ReturnType<Client["listTools"]>;
export type ListToolsResponse = ListToolsFnReturnType extends Promise<infer R> ? R : ListToolsFnReturnType;

export class McpClientAdapter {
    private client: Client;
    private transport: StreamableHTTPClientTransport;
    private serverUrl: URL;
    private connected: boolean = false;
    private clientName: string;
    private clientVersion: string;

    constructor(serverUrlString: string, clientName: string = "mcp-chat-web-agent", clientVersion: string = "1.0.0") {
        this.serverUrl = new URL(serverUrlString);
        this.clientName = clientName;
        this.clientVersion = clientVersion;
        // Client and transport are initialized in connect() to allow re-init if needed
        this.client = new Client({ name: this.clientName, version: this.clientVersion, id: this.clientName });
        this.transport = new StreamableHTTPClientTransport(this.serverUrl);
    }

    async connect(): Promise<void> {
        if (this.connected) {
            console.warn(chalk.yellow(`[MCP Client Adapter] Already connected to ${this.serverUrl.href}. Attempting to re-initialize client and transport.`));
            // Explicitly close existing connection if any, before re-initializing
            await this.disconnectQuietly();
        }
        
        this.client = new Client({ name: this.clientName, version: this.clientVersion });
        this.transport = new StreamableHTTPClientTransport(this.serverUrl);

        try {
            await this.client.connect(this.transport);
            this.connected = true;
            console.log(chalk.blue(`[MCP Client Adapter] Successfully connected to ${this.serverUrl.href}`));
        } catch (error: any) {
            this.connected = false;
            console.error(chalk.red(`[MCP Client Adapter] Connect Error to ${this.serverUrl.href}: ${error.message}`), error);
            // Check for CORS issues specifically, as this is common in web
            if (error.message.toLowerCase().includes('failed to fetch') || error.message.toLowerCase().includes('networkerror')) {
                 console.warn(chalk.yellowBright(`[MCP Client Adapter] This might be a CORS issue. Ensure the MCP server at ${this.serverUrl.href} has appropriate CORS headers (e.g., Access-Control-Allow-Origin).`));
            }
            throw error;
        }
    }
    
    private async disconnectQuietly(): Promise<void> {
        if (this.connected) {
            try {
                await this.client.close();
            } catch (e) {
                // ignore errors during quiet disconnect
            }
        }
        this.connected = false;
    }


    async disconnect(): Promise<void> {
        if (!this.connected) {
            console.log(chalk.yellow(`[MCP Client Adapter] Not connected to ${this.serverUrl.href}, or already disconnected.`));
            return;
        }
        try {
            await this.client.close();
            console.log(chalk.blue(`[MCP Client Adapter] Successfully disconnected from ${this.serverUrl.href}`));
        } catch (error: any) {
            console.error(chalk.red(`[MCP Client Adapter] Disconnect Error from ${this.serverUrl.href}: ${error.message}`), error);
        } finally {
            this.connected = false;
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    async callMcpTool(mcpToolName: string, mcpArguments: any): Promise<CallToolResponse> {
        if (!this.isConnected()) {
            const errMsg = `[MCP Client Adapter] Not connected to MCP server ${this.serverUrl.href}. Cannot call tool "${mcpToolName}".`;
            console.error(chalk.red(errMsg));
            throw new Error(errMsg);
        }
        console.log(chalk.blue(`  [MCP Client Adapter] Calling MCP tool "${mcpToolName}" on ${this.serverUrl.href}`));
        try {
            return await this.client.callTool({
                name: mcpToolName,
                arguments: mcpArguments,
            });
        } catch (error: any) {
            console.error(chalk.red(`  [MCP Client Adapter] Error calling MCP tool "${mcpToolName}": ${error.message}`), error);
            // Return an error structure compatible with Gemini's expected tool response format
            return {
                toolCallId: `error-${mcpToolName}-${Date.now()}`, // Ensure a unique ID for the error response
                isError: true,
                content: [{ type: "text", text: `Error calling MCP tool ${mcpToolName}: ${error.message}` }],
            };
        }
    }

    async listMcpTools(): Promise<McpToolSchema[]> {
        if (!this.isConnected()) {
             const errMsg = `[MCP Client Adapter] Not connected to ${this.serverUrl.href}. Cannot list tools.`;
             console.error(chalk.red(errMsg));
             return []; // Return empty array or throw error, consistent with consumer
        }
        try {
            console.log(chalk.dim(`  [MCP Client Adapter] Listing tools from ${this.serverUrl.href}...`));
            const response: ListToolsResponse = await this.client.listTools();
            return response.tools || [];
        } catch (error: any) {
            console.error(chalk.red(`  [MCP Client Adapter] Error listing tools from ${this.serverUrl.href}: ${error.message}`), error);
            return []; // Return empty array on error
        }
    }
}

