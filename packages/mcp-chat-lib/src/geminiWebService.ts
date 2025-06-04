// packages/mcp-chat-lib/src/geminiWebService.ts
import {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
    Part,
    ChatSession,
    GenerativeModel,
    Tool,
    FunctionDeclaration,
    GenerateContentResponse,
    FunctionCall,
    Content,
} from "@google/generative-ai";
import chalk from 'chalk';
import { DynamicGeminiToolMapping } from './mcpToolMapper.js'; // Corrected import path
import { McpClientAdapter } from './mcpClientAdapter.js';

const DEFAULT_GEMINI_MODEL_NAME = "gemini-2.5-flash-preview-05-20"; // Default model

export interface GeminiWebServiceOptions {
    apiKey: string;
    modelName?: string;
}

export class GeminiWebService {
    private genAI: GoogleGenerativeAI;
    private modelName: string;
    private geminiModelWithTools?: GenerativeModel;
    private currentToolMappings: DynamicGeminiToolMapping[] = [];

    private generationConfig = {
        temperature: 0.7,
    };
    private safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ];

    constructor(options: GeminiWebServiceOptions) {
        if (!options.apiKey) {
            const errMsg = "FATAL ERROR: Gemini API Key is not provided.";
            console.error(chalk.red(`[GeminiWebService] ${errMsg}`));
            throw new Error(errMsg);
        }
        this.genAI = new GoogleGenerativeAI(options.apiKey);
        this.modelName = options.modelName || DEFAULT_GEMINI_MODEL_NAME;
        console.log(chalk.blue(`[GeminiWebService] Initialized for model: ${this.modelName}`));
    }

    public initializeModelWithTools(toolMappings: DynamicGeminiToolMapping[]): void {
        this.currentToolMappings = toolMappings;
        const dynamicDeclarations: FunctionDeclaration[] = toolMappings.map(tm => tm.geminiFunctionDeclaration);
        
        const toolsForGemini: Tool[] = dynamicDeclarations.length > 0
            ? [{ functionDeclarations: dynamicDeclarations }]
            : [];

        if (toolsForGemini.length > 0) {
            console.log(chalk.blue(`[GeminiWebService] Initializing Gemini model with ${dynamicDeclarations.length} dynamically discovered tools...`));
        } else {
            console.log(chalk.yellow("[GeminiWebService] No tools provided. Gemini will operate without tool calling capabilities for this session."));
        }

        this.geminiModelWithTools = this.genAI.getGenerativeModel({
            model: this.modelName,
            tools: toolsForGemini,
            safetySettings: this.safetySettings,
        });
        console.log(chalk.green(`[GeminiWebService] Model "${this.modelName}" initialized ${toolsForGemini.length > 0 ? 'with tools' : 'without tools'}.`));
    }

    public startChatSession(history: Content[] = []): ChatSession {
        if (!this.geminiModelWithTools) {
            console.warn(chalk.yellow("[GeminiWebService] Model not yet initialized with tools. Initializing with default (no tools). Call initializeModelWithTools first for tool support."));
            this.initializeModelWithTools([]); // Initialize without tools
        }
        // This check is now somewhat redundant due to the above, but good for type safety.
        if (!this.geminiModelWithTools) {
             const errMsg = "Gemini model is not available after attempting initialization.";
             console.error(chalk.red(`[GeminiWebService] ${errMsg}`));
             throw new Error(errMsg);
        }

        return this.geminiModelWithTools.startChat({
            history: history,
            generationConfig: this.generationConfig,
        });
    }
    
    private findDynamicallyMappedTool(geminiFunctionName: string): DynamicGeminiToolMapping | undefined {
        return this.currentToolMappings.find(tool => tool.geminiFunctionDeclaration.name === geminiFunctionName);
    }


    public async sendMessage(
        chatSession: ChatSession,
        processedMessage: string | Part[],
        onToolCallStart?: (call: FunctionCall) => void,
        onToolCallEnd?: (toolName: string, result: any, success: boolean) => void
    ): Promise<{textResponse: string | null, fullResponse: GenerateContentResponse | null}> {
        let currentMessageForGemini: string | Part[] = processedMessage;
        let attempt = 0;
        const maxAttempts = 5;

        while (attempt < maxAttempts) {
            attempt++;
            console.log(chalk.dim(`  [GeminiWebService] (Gemini Call - Attempt ${attempt})`));

            try {
                const result = await chatSession.sendMessage(currentMessageForGemini);
                const response = result.response;

                if (!response) {
                    console.error(chalk.red("[GeminiWebService] Gemini returned no response content."));
                    return { textResponse: "I'm sorry, I couldn't get a response.", fullResponse: null };
                }
                
                // Log candidate for debugging if needed
                // if (response.candidates && response.candidates.length > 0) {
                //     console.log(chalk.gray(`[GeminiWebService] Candidate finish reason: ${response.candidates[0].finishReason}`));
                //     if (response.candidates[0].finishMessage) {
                //          console.log(chalk.gray(`[GeminiWebService] Candidate finish message: ${response.candidates[0].finishMessage}`));
                //     }
                // }


                const candidate = response.candidates?.[0];
                const functionCallParts = candidate?.content?.parts?.filter(part => !!part.functionCall);

                if (functionCallParts && functionCallParts.length > 0) {
                    console.log(chalk.magenta("[GeminiWebService] Gemini wants to call functions:"));
                    if (functionCallParts[0]?.functionCall) {
                        onToolCallStart?.(functionCallParts[0].functionCall);
                    }

                    const toolResponses: Part[] = [];

                    for (const part of functionCallParts) {
                        if (!part.functionCall) continue;
                        const call = part.functionCall;
                        console.log(chalk.magenta(`    - Function: ${call.name}`));
                        
                        const mappedTool = this.findDynamicallyMappedTool(call.name);
                        if (!mappedTool) {
                            console.error(chalk.red(`    [GeminiWebService] Error: Dynamically mapped tool for Gemini function "${call.name}" not found.`));
                            toolResponses.push({
                                functionResponse: {
                                    name: call.name,
                                    response: { error: `Function ${call.name} is not implemented or mapped.` },
                                },
                            });
                            onToolCallEnd?.(call.name, { error: `Function ${call.name} is not implemented or mapped.` }, false);
                            continue;
                        }

                        const mcpClient = new McpClientAdapter(mappedTool.mcpServerUrl);
                        let mcpToolResult;
                        let success = false;
                        try {
                            await mcpClient.connect();
                            const mcpArgs = call.args; // Arguments from Gemini are passed directly
                            mcpToolResult = await mcpClient.callMcpTool(mappedTool.mcpToolName, mcpArgs);
                            success = !mcpToolResult.isError;

                            toolResponses.push({
                                functionResponse: {
                                    name: call.name,
                                    response: mcpToolResult, // Send the entire MCP CallToolResponse object
                                },
                            });
                            console.log(chalk.green(`    [GeminiWebService] MCP Tool "${mappedTool.mcpToolName}" on server "${mappedTool.mcpServerName}" executed.`));
                        } catch (e: any) {
                            mcpToolResult = { error: `Error executing MCP tool ${mappedTool.mcpToolName}: ${e.message}` };
                            console.error(chalk.red(`    [GeminiWebService] Error during MCP tool execution for ${call.name}: ${e.message}`));
                            toolResponses.push({
                                functionResponse: {
                                    name: call.name,
                                    response: mcpToolResult,
                                },
                            });
                        } finally {
                            if (mcpClient.isConnected()) {
                                await mcpClient.disconnect();
                            }
                            onToolCallEnd?.(call.name, mcpToolResult, success);
                        }
                    }
                    currentMessageForGemini = toolResponses; // Next message to Gemini is the list of tool results
                } else {
                    // No function call, just a text response
                    const text = response.text();
                     if (text === undefined || text === null) {
                        console.log(chalk.yellow("[GeminiWebService] AI: Received a response, but it has no text content. Check finishReason."));
                        // Check finishReason for safety blocks etc.
                        if (response.promptFeedback?.blockReason) {
                             const blockMessage = `Content blocked due to: ${response.promptFeedback.blockReason}. Details: ${response.promptFeedback.blockReasonMessage}`;
                             console.error(chalk.red(`[GeminiWebService] ${blockMessage}`));
                             return { textResponse: `I'm sorry, your request was blocked: ${response.promptFeedback.blockReason}.`, fullResponse: response };
                        }
                        return { textResponse: "I received a response, but it was empty.", fullResponse: response };
                    }
                    console.log(chalk.cyanBright(`\n[GeminiWebService] AI: ${text}`));
                    return { textResponse: text, fullResponse: response };
                }
            } catch (error: any) {
                 console.error(chalk.redBright(`[GeminiWebService] Error during sendMessage to Gemini: ${error.message}`), error);
                 let errorMessage = "An error occurred while communicating with the AI.";
                 if (error.message.includes("API key not valid")) {
                     errorMessage = "The Gemini API key is not valid. Please check your API key.";
                 } else if (error.message.toLowerCase().includes("quota") || error.message.toLowerCase().includes("rate limit")) {
                     errorMessage = "You may have exceeded your API quota or rate limit. Please check your Google AI Studio dashboard.";
                 } else if (error.message.toLowerCase().includes("fetch")) {
                     errorMessage = "A network error occurred. Please check your internet connection.";
                 }
                 // Potentially parse more specific errors from error.toString() or error.cause
                 return { textResponse: `Error: ${errorMessage}`, fullResponse: null };
            }
        }
        console.error(chalk.red("[GeminiWebService] Exceeded maximum tool call attempts."));
        return { textResponse: "I tried several times, but I'm having trouble completing your request with tools.", fullResponse: null };
    }
}

