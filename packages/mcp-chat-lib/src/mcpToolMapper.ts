// packages/mcp-chat-lib/src/mcpToolMapper.ts
import { FunctionDeclaration, SchemaType, Schema, StringSchema, ArraySchema, ObjectSchema } from "@google/generative-ai";
import { McpToolSchema, McpJsonSchema, McpJsomSchemaType } from './types'; // Define these in a central types file
import { McpClientAdapter } from './mcpClientAdapter.js';
import { McpServerConfig } from './configService.js';
import chalk from 'chalk';

export interface DynamicGeminiToolMapping {
    geminiFunctionDeclaration: FunctionDeclaration;
    mcpServerName: string;
    mcpServerUrl: string;
    mcpToolName: string;
}

// This will be managed by ChatController instance
// let currentSessionTools: DynamicGeminiToolMapping[] = []; 

function mcpSchemaTypeToGeminiSchemaType(mcpType: McpJsomSchemaType | McpJsomSchemaType[] | undefined): SchemaType | undefined {
    if (Array.isArray(mcpType)) {
        const nonNullType = mcpType.find(t => t !== null && t !== undefined && (t as string) !== "null");
        return nonNullType ? mcpSchemaTypeToGeminiSchemaType(nonNullType as McpJsomSchemaType) : undefined;
    }
    switch (mcpType as string) {
        case "string": return SchemaType.STRING;
        case "number": return SchemaType.NUMBER;
        case "integer": return SchemaType.INTEGER;
        case "boolean": return SchemaType.BOOLEAN;
        case "array": return SchemaType.ARRAY;
        case "object": return SchemaType.OBJECT;
        // "null" type in an array (e.g. ["string", "null"]) is handled by taking the non-null type.
        // If "null" is the only type, it means the property is always null, which isn't directly representable as a distinct type in Gemini FunctionDeclarationSchema.
        // It's better to make it optional or handle it via description. For simplicity, we'll return undefined.
        case "null": return undefined; 
        default:
            console.warn(chalk.yellow(`  [Schema Xlate] Unsupported MCP schema type: ${mcpType}. Treating as undefined.`));
            return undefined;
    }
}

function translateMcpPropertiesToGeminiProperties(
    mcpProperties: Record<string, McpJsonSchema> | undefined
): Record<string, Schema> | undefined {
    if (!mcpProperties) return undefined;

    const geminiProperties: Record<string, Schema> = {};
    for (const key in mcpProperties) {
        const mcpPropSchema = mcpProperties[key];
        if (typeof mcpPropSchema === 'boolean') {
            // console.warn(chalk.yellow(`  [Schema Xlate] Boolean schema for property "${key}" is not directly translatable to Gemini. Skipping.`));
            // For boolean schemas (e.g. "additionalProperties": false), it's not a parameter, so skip.
            continue;
        }

        const geminiType = mcpSchemaTypeToGeminiSchemaType(mcpPropSchema.type);
        if (!geminiType) {
            // If a type can't be mapped (e.g. "null" only, or truly unknown), skip this property for Gemini.
            // It's better than failing the whole tool or assigning a wrong type.
            console.warn(chalk.yellow(`  [Schema Xlate] Could not map MCP type "${JSON.stringify(mcpPropSchema.type)}" for property "${key}" to a Gemini type. Skipping property.`));
            continue;
        }

        const geminiProp: Schema = {
            type: geminiType,
            description: mcpPropSchema.description || `Parameter ${key}`,
        } as Schema;

        if (mcpPropSchema.enum && Array.isArray(mcpPropSchema.enum) && geminiType === SchemaType.STRING) {
            (geminiProp as StringSchema).enum = mcpPropSchema.enum.map(String);
        }

        if (geminiType === SchemaType.ARRAY && mcpPropSchema.items) {
            if (typeof mcpPropSchema.items === 'object' && !Array.isArray(mcpPropSchema.items)) {
                // Assuming items describe a single schema for all array elements
                const itemSchemaInternal = mcpPropSchema.items as McpJsonSchema;
                 if (typeof itemSchemaInternal === 'boolean') {
                    console.warn(chalk.yellow(`  [Schema Xlate] Array property "${key}" has boolean 'items' schema. Items will be generic.`));
                 } else {
                    const itemGeminiType = mcpSchemaTypeToGeminiSchemaType(itemSchemaInternal.type);
                    if(itemGeminiType) {
                        const translatedItemSchema = translateMcpSchemaToGeminiSchema(itemSchemaInternal, true); // translate as an item, not a top-level object param
                        if (translatedItemSchema) (geminiProp as ArraySchema).items = translatedItemSchema as Schema; // Cast needed as translateMcpSchemaToGeminiSchema returns ObjectSchema for top level
                    } else {
                        console.warn(chalk.yellow(`  [Schema Xlate] Array property "${key}" has 'items' with unmappable type. Items will be generic.`));
                    }
                 }
            } else if (Array.isArray(mcpPropSchema.items)) {
                 console.warn(chalk.yellow(`  [Schema Xlate] Array property "${key}" has an array for 'items' (tuple validation), which is not directly supported. Items will be generic.`));
            } else {
                console.warn(chalk.yellow(`  [Schema Xlate] Array property "${key}" has complex/unsupported 'items' schema. Items will be generic.`));
            }
        } else if (geminiType === SchemaType.OBJECT && mcpPropSchema.properties) {
            const nestedProperties = translateMcpPropertiesToGeminiProperties(mcpPropSchema.properties as Record<string, McpJsonSchema>);
            if (nestedProperties) (geminiProp as ObjectSchema).properties = nestedProperties;
            if (mcpPropSchema.required && Array.isArray(mcpPropSchema.required)) {
                (geminiProp as ObjectSchema).required = mcpPropSchema.required;
            }
        }
        geminiProperties[key] = geminiProp;
    }
    return Object.keys(geminiProperties).length > 0 ? geminiProperties : undefined;
}

function translateMcpSchemaToGeminiSchema(mcpSchema: McpJsonSchema, isItemSchema: boolean = false): Schema | undefined {
    if (typeof mcpSchema === 'boolean') {
        // console.warn(chalk.yellow(`  [Schema Xlate] Boolean schema is not directly translatable to Gemini parameter schema. Skipping.`));
        return undefined; // Boolean schemas like "additionalProperties: false" are not parameters themselves
    }

    const mcpSchemaType = mcpSchema.type;
    
    // For top-level tool parameters, Gemini expects an OBJECT type.
    // For array items, it can be any valid SchemaType.
    if (!isItemSchema && mcpSchemaType !== "object") {
        console.warn(chalk.yellow(`  [Schema Xlate] MCP tool inputSchema is type "${mcpSchemaType}" not "object". Gemini tools require top-level parameters to be an object. Creating empty object schema if possible, else skipping.`));
        // If we absolutely must provide an object schema:
        // return { type: SchemaType.OBJECT, properties: {}, required: [] };
        // However, it's better to skip if the schema fundamentally doesn't map.
        // For now, let's try to adapt if it's simple, or return undefined if complex.
        // This case should ideally be caught by mcpToolToGeminiFunction.
        return { type: SchemaType.OBJECT, properties: {}, required: [] }; // Default empty object
    }

    const geminiType = mcpSchemaTypeToGeminiSchemaType(mcpSchemaType);
    if (!geminiType) {
        console.warn(chalk.yellow(`  [Schema Xlate] Could not determine Gemini type for MCP schema type: ${JSON.stringify(mcpSchemaType)}. Skipping schema.`));
        return undefined;
    }

    const geminiSchema: Schema = { type: geminiType } as Schema; // Base schema with type

    if (mcpSchema.description && typeof mcpSchema.description === 'string') {
        geminiSchema.description = mcpSchema.description;
    }

    if (geminiType === SchemaType.OBJECT) {
        const geminiProperties = translateMcpPropertiesToGeminiProperties(mcpSchema.properties as Record<string, McpJsonSchema>);
        (geminiSchema as ObjectSchema).properties = geminiProperties || {}; // Gemini expects properties to exist, even if empty
        if (mcpSchema.required && Array.isArray(mcpSchema.required)) {
            (geminiSchema as ObjectSchema).required = mcpSchema.required;
        }
    } else if (geminiType === SchemaType.ARRAY && mcpSchema.items) {
         if (typeof mcpSchema.items === 'object' && !Array.isArray(mcpSchema.items)) {
            const itemSchema = translateMcpSchemaToGeminiSchema(mcpSchema.items as McpJsonSchema, true);
            if (itemSchema) (geminiSchema as ArraySchema).items = itemSchema;
        } else {
            console.warn(chalk.yellow(`  [Schema Xlate] Array schema has complex/unsupported 'items'. Generic items assumed.`));
        }
    } else if (geminiType === SchemaType.STRING && mcpSchema.enum && Array.isArray(mcpSchema.enum)) {
        (geminiSchema as StringSchema).enum = mcpSchema.enum.map(String);
    }
    // Add other type-specific properties if necessary (e.g., format for string, min/max for number)

    return geminiSchema;
}


function mcpToolToGeminiFunction(mcpTool: McpToolSchema, mcpServerName: string): FunctionDeclaration | null {
    if (!mcpTool.inputSchema || typeof mcpTool.inputSchema === 'boolean') {
        console.warn(chalk.yellow(`  [Tool Xlate] Tool "${mcpTool.name}" from server "${mcpServerName}" has no inputSchema or it's a boolean schema. Skipping.`));
        return null;
    }
    
    const inputSchemaAsMcpJson = mcpTool.inputSchema as McpJsonSchema; // Already checked it's not boolean
    if (inputSchemaAsMcpJson.type !== "object") {
         console.warn(chalk.yellow(`  [Tool Xlate] Tool "${mcpTool.name}" from server "${mcpServerName}" has inputSchema type "${inputSchemaAsMcpJson.type}" instead of "object". Skipping, as Gemini requires object parameters for functions.`));
        return null;
    }

    const sanitizedServerName = mcpServerName.replace(/[^a-zA-Z0-9_]/g, '_');
    const sanitizedMcpToolName = mcpTool.name.replace(/[^a-zA-Z0-9_]/g, '_');
    let geminiFunctionName = `${sanitizedServerName}_${sanitizedMcpToolName}`;
    if (geminiFunctionName.length > 63) { // Adhere to Gemini's function name length limit
        geminiFunctionName = geminiFunctionName.substring(0, 63);
    }
     // Further sanitize to meet typical identifier patterns (start with letter/underscore, then letters/numbers/underscores)
    if (!/^[a-zA-Z_]/.test(geminiFunctionName)) {
        geminiFunctionName = "_" + geminiFunctionName;
    }
    geminiFunctionName = geminiFunctionName.replace(/[^a-zA-Z0-9_]/g, '_').substring(0,63);


    const geminiParameters = translateMcpSchemaToGeminiSchema(inputSchemaAsMcpJson) as ObjectSchema | undefined;
    if (!geminiParameters || geminiParameters.type !== SchemaType.OBJECT) { // Ensure it's an ObjectSchema
        console.warn(chalk.yellow(`  [Tool Xlate] Could not translate inputSchema for tool "${mcpTool.name}" from server "${mcpServerName}" into a valid Gemini ObjectSchema. Skipping.`));
        return null;
    }
    // Ensure properties exist, even if empty, as Gemini expects it.
    if (!geminiParameters.properties) {
        geminiParameters.properties = {};
    }


    return {
        name: geminiFunctionName,
        description: mcpTool.description || `Calls ${mcpTool.name} on MCP server ${mcpServerName}. ${(mcpTool.annotations as any)?.title || ''}`,
        parameters: geminiParameters,
    };
}

export async function discoverAndMapAllMcpTools(
    configuredServers: McpServerConfig[],
    currentMappings: DynamicGeminiToolMapping[] // Pass current mappings to avoid duplicates if called multiple times
): Promise<{ newMappings: DynamicGeminiToolMapping[], allMappings: DynamicGeminiToolMapping[] }> {
    console.log(chalk.cyanBright("\n[MCP Tool Mapper] Discovering tools from configured MCP servers..."));
    const newMappings: DynamicGeminiToolMapping[] = [];
    const existingGeminiFunctionNames = new Set(currentMappings.map(m => m.geminiFunctionDeclaration.name));

    for (const serverConfig of configuredServers) {
        console.log(chalk.blue(`[MCP Tool Mapper] Checking server: ${serverConfig.name} (${serverConfig.url})`));
        const mcpClient = new McpClientAdapter(serverConfig.url);
        try {
            await mcpClient.connect();
            if (mcpClient.isConnected()) {
                const mcpTools = await mcpClient.listMcpTools();
                if (mcpTools && mcpTools.length > 0) {
                    console.log(chalk.green(`  [MCP Tool Mapper] Found ${mcpTools.length} tools on ${serverConfig.name}:`));
                    for (const mcpTool of mcpTools) {
                        console.log(chalk.dim(`    - Mapping MCP tool: ${mcpTool.name}`));
                        const geminiFuncDecl = mcpToolToGeminiFunction(mcpTool, serverConfig.name);
                        if (geminiFuncDecl) {
                            if (existingGeminiFunctionNames.has(geminiFuncDecl.name)) {
                                console.warn(chalk.yellow(`      -> Gemini tool name "${geminiFuncDecl.name}" already exists (possibly from another server or previous mapping). Skipping duplicate for this session.`));
                                continue;
                            }
                            const mapping = {
                                geminiFunctionDeclaration: geminiFuncDecl,
                                mcpServerName: serverConfig.name,
                                mcpServerUrl: serverConfig.url,
                                mcpToolName: mcpTool.name,
                            };
                            newMappings.push(mapping);
                            existingGeminiFunctionNames.add(geminiFuncDecl.name); // Add to set to prevent duplicates in this discovery round
                            console.log(chalk.dim(`      -> Mapped to Gemini tool: ${geminiFuncDecl.name}`));
                        } else {
                             console.log(chalk.yellow(`      -> Failed to map MCP tool ${mcpTool.name} from ${serverConfig.name} to a Gemini tool.`));
                        }
                    }
                } else {
                    console.log(chalk.yellow(`  [MCP Tool Mapper] No tools found or an error occurred on ${serverConfig.name}.`));
                }
            }
        } catch (error: any) {
            console.error(chalk.red(`  [MCP Tool Mapper] Error connecting or listing tools for server ${serverConfig.name}: ${error.message}`));
            // Error already logged by mcpClientAdapter
        } finally {
            if (mcpClient.isConnected()) {
                await mcpClient.disconnect();
            }
        }
    }
    const allMappings = [...currentMappings, ...newMappings];
    console.log(chalk.cyanBright(`[MCP Tool Mapper] Tool discovery complete. ${newMappings.length} new MCP tools mapped. Total for session: ${allMappings.length}.\n`));
    return { newMappings, allMappings };
}

