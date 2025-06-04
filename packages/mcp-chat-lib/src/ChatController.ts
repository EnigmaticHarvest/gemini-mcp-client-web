// packages/mcp-chat-lib/src/ChatController.ts
import {
    McpServerConfig,
    addServer as addMcpServerConfig,
    listServers as listMcpServersConfig,
    removeServer as removeMcpServerConfig,
    setDefaultServer as setDefaultMcpServerConfig,
    getDefaultServer as getDefaultMcpServerConfig,
    getServer as getMcpServerConfig
} from './configService.js';
// import { McpClientAdapter } from './mcpClientAdapter.js'; // REMOVING McpClientAdapter
import { discoverAndMapAllMcpTools, DynamicGeminiToolMapping } from './mcpToolMapper.js';
import { GeminiWebService } from './geminiWebService.js';
import { processWebUserInput } from './userInputProcessor.js';
// import { ChatMessage, ChatControllerOptions, ChatEvent, ListenerType, Part, ChatSession } from './types.js'; // MODIFYING THIS LINE
import { ChatMessage, ChatControllerOptions, ChatEvent, ListenerType, ChatSession } from './types.js'; // REMOVING Part
import chalk from 'chalk'; // For logging
import { FunctionCall, Content } from '@google/generative-ai';

export class ChatController {
    private geminiService: GeminiWebService;
    private currentMcpTools: DynamicGeminiToolMapping[] = [];
    private chatHistory: Content[] = []; // Gemini SDK specific history
    public messages: ChatMessage[] = []; // User-facing messages
    private currentChatSession?: ChatSession;

    private listeners: { [K in ChatEvent]?: Array<ListenerType<K>> } = {};

    constructor(options: ChatControllerOptions) {
        if (!options.geminiApiKey) {
            throw new Error("Gemini API Key is required for ChatController.");
        }
        this.geminiService = new GeminiWebService({
            apiKey: options.geminiApiKey,
            modelName: options.geminiModelName
        });
        this.initialize();
    }

    private async initialize(): Promise<void> {
        console.log(chalk.bgBlueBright.white('[ChatController] Initializing...'));
        await this.rediscoverMcpTools(); // Discover tools on init
    }

    public on<E extends ChatEvent>(event: E, listener: ListenerType<E>): void {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        (this.listeners[event] as Array<ListenerType<E>>).push(listener);
    }

    public off<E extends ChatEvent>(event: E, listener: ListenerType<E>): void {
        if (!this.listeners[event]) return;
        this.listeners[event] = ((this.listeners[event] as Array<ListenerType<E>>).filter(l => l !== listener)) as any;
    }

    private emit<E extends ChatEvent>(event: E, ...args: Parameters<ListenerType<E>>): void {
        if (!this.listeners[event]) return;
        (this.listeners[event] as Array<ListenerType<E>>).forEach(listener => {
            try {
                (listener as any)(...args);
            } catch (e) {
                console.error(chalk.red(`[ChatController] Error in listener for event "${event}":`), e);
            }
        });
    }

    private addMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): ChatMessage {
        const fullMessage: ChatMessage = {
            ...message,
            id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            timestamp: new Date(),
        };
        this.messages.push(fullMessage);
        this.emit('message', fullMessage);
        return fullMessage;
    }

    // MCP Server Management - Wraps configService and triggers rediscovery
    public async addMcpServer(name: string, url: string): Promise<{ success: boolean, message: string }> {
        const result = addMcpServerConfig(name, url);
        if (result.success) {
            await this.rediscoverMcpTools();
        }
        return result;
    }

    public listMcpServers(): McpServerConfig[] {
        return listMcpServersConfig();
    }

    public async removeMcpServer(name: string): Promise<{ success: boolean, message: string }> {
        const result = removeMcpServerConfig(name);
        if (result.success) {
            await this.rediscoverMcpTools();
        }
        return result;
    }

    public async setDefaultMcpServer(name: string): Promise<{ success: boolean, message: string }> {
        // Note: Default server concept is more for UI hinting; tool discovery hits all servers.
        const result = setDefaultMcpServerConfig(name);
        // No need to rediscover tools just for setting a default unless logic changes
        return result;
    }
    public getDefaultMcpServer(): McpServerConfig | undefined {
        return getDefaultMcpServerConfig();
    }
    public getMcpServer(name: string): McpServerConfig | undefined {
        return getMcpServerConfig(name);
    }


    public async rediscoverMcpTools(): Promise<DynamicGeminiToolMapping[]> {
        const configuredServers = this.listMcpServers();
        if (configuredServers.length === 0) {
            console.log(chalk.yellow("[ChatController] No MCP servers configured. Tool discovery skipped."));
            this.currentMcpTools = [];
        } else {
            const { allMappings } = await discoverAndMapAllMcpTools(configuredServers, []); // Fresh discovery
            this.currentMcpTools = allMappings;
        }
        this.geminiService.initializeModelWithTools(this.currentMcpTools); // Re-initialize model with new/updated tools
        this.emit('toolDiscoveryUpdate', this.currentMcpTools);
        return this.currentMcpTools;
    }

    public getDiscoveredTools(): DynamicGeminiToolMapping[] {
        return this.currentMcpTools;
    }
    
    public getChatHistory(): ReadonlyArray<ChatMessage> {
        return [...this.messages];
    }

    public async sendMessage(userInputText: string, attachedFiles: File[] = []): Promise<void> {
        if (!this.currentChatSession) {
            console.log(chalk.blue("[ChatController] Starting new Gemini chat session..."));
            // Pass existing SDK-compatible history if any. For simplicity, start fresh or manage history carefully.
            // For now, we build history from `this.messages` if needed, or rely on geminiService's session state.
            // Let's keep chatHistory for the Gemini SDK's format.
            this.currentChatSession = this.geminiService.startChatSession(this.chatHistory);
        }

        const userMessageContent = await processWebUserInput(userInputText, attachedFiles);
        
        this.addMessage({ role: 'user', content: userInputText, parts: Array.isArray(userMessageContent) ? userMessageContent : [{text: userMessageContent}] });
        
        // Add to Gemini SDK history
        if (Array.isArray(userMessageContent)) {
            this.chatHistory.push({ role: "user", parts: userMessageContent });
        } else {
            this.chatHistory.push({ role: "user", parts: [{ text: userMessageContent }] });
        }


        try {
            const { textResponse, fullResponse } = await this.geminiService.sendMessage(
                this.currentChatSession,
                userMessageContent,
                (toolCall: FunctionCall) => { // onToolCallStart
                    this.addMessage({
                        role: 'system',
                        content: `Attempting to call tool: ${toolCall.name} with args: ${JSON.stringify(toolCall.args)}`,
                        toolCall: { id: `tc-${Date.now()}`, name: toolCall.name, args: toolCall.args, status: 'pending' }
                    });
                    this.emit('toolCallStart', toolCall.name, toolCall.args);
                },
                (toolName: string, result: any, success: boolean) => { // onToolCallEnd
                     this.addMessage({
                        role: 'tool',
                        content: `Tool ${toolName} ${success ? 'succeeded' : 'failed'}. Result: ${JSON.stringify(result)}`,
                        toolCall: { id: `tc-${Date.now()}`, name: toolName, args: {}, result: result, status: success ? 'success' : 'error' } // Args might not be available here easily
                    });
                    this.emit('toolCallEnd', toolName, result, success);
                }
            );

            if (textResponse !== null) {
                this.addMessage({ role: 'assistant', content: textResponse });
                // Add AI response to Gemini SDK history
                this.chatHistory.push({ role: "model", parts: [{ text: textResponse }] });

                // If the response included function calls that were handled, and then a final text response,
                // the `fullResponse.functionCalls()` would be empty here, but the history would contain the tool interaction.
                // We need to ensure the `chatHistory` gets the `role: "function"` (or "tool" in v1) parts.
                // The current structure sends tool responses back to Gemini within `geminiWebService.sendMessage`.
                // So `this.chatHistory` must also receive those `role: "function"` parts.

            } else if (fullResponse && fullResponse.promptFeedback?.blockReason) {
                const blockMessage = `Assistant's response was blocked: ${fullResponse.promptFeedback.blockReason}. ${fullResponse.promptFeedback.blockReasonMessage || ''}`;
                this.addMessage({ role: 'system', content: blockMessage, isError: true });
                 // Add to SDK history as well, so context isn't lost
                this.chatHistory.push({ role: "model", parts: [{ text: `[Blocked Response: ${blockMessage}]`}] });
            } else {
                this.addMessage({ role: 'system', content: "Assistant did not provide a text response.", isError: true });
                this.chatHistory.push({ role: "model", parts: [{ text: `[Empty Response]`}] });
            }
            
            // Sync history after turn
            if (this.currentChatSession) {
                 this.chatHistory = await this.currentChatSession.getHistory(); // Update local history from session
            }


        } catch (error: any) {
            console.error(chalk.redBright(`[ChatController] Error sending message: ${error.message}`), error);
            this.addMessage({ role: 'system', content: `Error: ${error.message}`, isError: true });
            this.emit('error', error);
        }
    }

    // Method to update API key if needed
    public updateGeminiApiKey(apiKey: string) {
        if (!apiKey) {
            console.error(chalk.red("[ChatController] Attempted to update with an empty API key."));
            return;
        }
        // Re-initialize GeminiWebService with the new key
        this.geminiService = new GeminiWebService({
            apiKey: apiKey,
            modelName: (this.geminiService as any).modelName // Access private modelName if possible, or store it
        });
        // Re-initialize model with current tools
        this.geminiService.initializeModelWithTools(this.currentMcpTools);
        // Existing chat session might become invalid, so clear it.
        this.currentChatSession = undefined;
        this.chatHistory = []; // Clear history as session context is lost
        this.messages = this.messages.filter(m => m.role !== 'assistant' && m.role !== 'tool' && m.role !== 'system'); // Keep user messages? Or clear all.
        this.addMessage({role: 'system', content: 'Gemini API Key updated. Chat session reset.'});
        console.log(chalk.blue("[ChatController] Gemini API Key updated. Session and history reset."));
    }
}

