// packages/mcp-chat-lib/src/configService.ts
import chalk from 'chalk'; // For console logging, won't show colors in browser console by default

export interface McpServerConfig {
    name: string;
    url: string;
    default?: boolean;
}

interface ConfigStore {
    servers: McpServerConfig[];
    defaultServerName: string | null;
}

const CONFIG_KEY = 'mcp-chat-web-config';

function getConfig(): ConfigStore {
    try {
        const storedConfig = localStorage.getItem(CONFIG_KEY);
        if (storedConfig) {
            const parsed = JSON.parse(storedConfig) as ConfigStore;
            // Basic validation / ensure defaults
            return {
                servers: Array.isArray(parsed.servers) ? parsed.servers : [],
                defaultServerName: typeof parsed.defaultServerName === 'string' ? parsed.defaultServerName : null,
            };
        }
    } catch (error) {
        console.error(chalk.red('[ConfigService] Error reading from localStorage:'), error);
    }
    return { servers: [], defaultServerName: null }; // Default empty config
}

function setConfig(configStore: ConfigStore): void {
    try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(configStore));
    } catch (error) {
        console.error(chalk.red('[ConfigService] Error writing to localStorage:'), error);
    }
}

export function addServer(name: string, url: string): { success: boolean, message: string } {
    const currentConfig = getConfig();
    if (currentConfig.servers.some(s => s.name === name)) {
        const message = `Server with name "${name}" already exists.`;
        console.warn(chalk.yellow(`[ConfigService] ${message}`));
        return { success: false, message };
    }
    try {
        new URL(url); // Validate URL format
    } catch (error) {
        const message = `Invalid URL format: ${url}`;
        console.error(chalk.red(`[ConfigService] ${message}`));
        return { success: false, message };
    }
    currentConfig.servers.push({ name, url });
    setConfig(currentConfig);
    const message = `Server "${name}" (${url}) added.`;
    console.log(chalk.green(`[ConfigService] ${message}`));

    if (currentConfig.servers.length === 1 && !currentConfig.defaultServerName) {
        setDefaultServer(name); // Make the first server added the default
    }
    return { success: true, message };
}

export function listServers(): McpServerConfig[] {
    const currentConfig = getConfig();
    return currentConfig.servers.map(s => ({
        ...s,
        default: s.name === currentConfig.defaultServerName
    }));
}

export function getServer(name: string): McpServerConfig | undefined {
    return listServers().find(s => s.name === name);
}

export function removeServer(name: string): { success: boolean, message: string } {
    let currentConfig = getConfig();
    const serverExists = currentConfig.servers.some(s => s.name === name);
    if (!serverExists) {
        const message = `Server "${name}" not found.`;
        console.warn(chalk.yellow(`[ConfigService] ${message}`));
        return { success: false, message };
    }
    currentConfig.servers = currentConfig.servers.filter(s => s.name !== name);
    
    let message = `Server "${name}" removed.`;

    if (currentConfig.defaultServerName === name) {
        currentConfig.defaultServerName = currentConfig.servers.length > 0 ? currentConfig.servers[0].name : null;
        if (currentConfig.defaultServerName) {
            message += ` New default set to "${currentConfig.defaultServerName}".`;
        } else {
            message += ` No servers left to set as default.`;
        }
    }
    setConfig(currentConfig);
    console.log(chalk.green(`[ConfigService] ${message}`));
    return { success: true, message };
}

export function setDefaultServer(name: string): { success: boolean, message: string } {
    const currentConfig = getConfig();
    if (!currentConfig.servers.some(s => s.name === name)) {
        const message = `Server "${name}" not found. Cannot set as default.`;
        console.error(chalk.red(`[ConfigService] ${message}`));
        return { success: false, message };
    }
    currentConfig.defaultServerName = name;
    setConfig(currentConfig);
    const message = `Server "${name}" is now the default.`;
    console.log(chalk.green(`[ConfigService] ${message}`));
    return { success: true, message };
}

export function getDefaultServer(): McpServerConfig | undefined {
    const currentConfig = getConfig();
    if (!currentConfig.defaultServerName) return undefined;
    return getServer(currentConfig.defaultServerName);
}

