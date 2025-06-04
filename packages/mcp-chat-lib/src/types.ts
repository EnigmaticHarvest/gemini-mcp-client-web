// packages/mcp-chat-lib/src/types.ts
import { Part, FunctionDeclaration } from "@google/generative-ai";
import { ToolSchema as McpToolSchemaInternal } from "@modelcontextprotocol/sdk/types.js"; // Assuming this is the Zod schema type
import { z } from "zod";

// Re-export McpToolSchema from SDK for use within the lib
export type McpToolSchema = z.infer<typeof McpToolSchemaInternal>;

// McpJsonSchema is the type of the inputSchema within an McpToolSchema
export type McpJsonSchema = NonNullable<McpToolSchema["inputSchema"]>;

// McpJsomSchemaType is the 'type' property within an McpJsonSchema
export type McpJsomSchemaType = McpJsonSchema extends { type: infer T; } ? T :
    McpJsonSchema extends boolean ? "boolean" :
    any;

export interface DynamicGeminiToolMapping {
    geminiFunctionDeclaration: FunctionDeclaration;
    mcpServerName: string;
    mcpServerUrl: string;
    mcpToolName: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string; // For text messages or descriptions of tool calls/results
    parts?: Part[]; // For multimodal user input or tool responses
    timestamp: Date;
    toolCall?: {
        id: string; // Corresponds to Gemini's function call ID if applicable
        name: string;
        args: any;
        status?: 'pending' | 'success' | 'error';
        result?: any;
    };
    isError?: boolean;
}

export interface ChatControllerOptions {
    geminiApiKey: string;
    geminiModelName?: string;
}

// Event types for ChatController
export type ChatEvent = 
    | 'message' // New message added to chat (user, assistant, system, error)
    | 'toolDiscoveryUpdate' // Tool mappings have been updated
    | 'toolCallStart'       // Gemini requests a tool call
    | 'toolCallEnd'         // Tool call completed (success or error)
    | 'error';              // General error in ChatController

export type MessageListener = (message: ChatMessage) => void;
export type ToolDiscoveryListener = (mappings: DynamicGeminiToolMapping[]) => void;
export type ToolCallStartListener = (toolName: string, args: any) => void;
export type ToolCallEndListener = (toolName: string, result: any, success: boolean) => void;
export type ErrorListener = (error: Error) => void;

export type ListenerType<E extends ChatEvent> =
    E extends 'message' ? MessageListener :
    E extends 'toolDiscoveryUpdate' ? ToolDiscoveryListener :
    E extends 'toolCallStart' ? ToolCallStartListener :
    E extends 'toolCallEnd' ? ToolCallEndListener :
    E extends 'error' ? ErrorListener :
    never;


export type { McpServerConfig } from './configService'; // Re-export
export type { Part, ChatSession } from "@google/generative-ai"; // Re-export from Gemini

