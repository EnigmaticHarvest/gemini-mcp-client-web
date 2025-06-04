// packages/mcp-chat-webapp/src/App.tsx
import React, { useState, useEffect, useRef } from 'react';
import { ChatController, ChatMessage, McpServerConfig, DynamicGeminiToolMapping } from 'mcp-chat-lib';

const App: React.FC = () => {
    const [apiKey, setApiKey] = useState<string>(localStorage.getItem('geminiApiKey') || '');
    const [isApiKeySet, setIsApiKeySet] = useState<boolean>(!!localStorage.getItem('geminiApiKey'));
    const [chatController, setChatController] = useState<ChatController | null>(null);
    
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [userInput, setUserInput] = useState<string>('');
    const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
    const [newServerName, setNewServerName] = useState<string>('');
    const [newServerUrl, setNewServerUrl] = useState<string>('');

    const [discoveredTools, setDiscoveredTools] = useState<DynamicGeminiToolMapping[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    const handleApiKeySubmit = () => {
        if (apiKey.trim()) {
            localStorage.setItem('geminiApiKey', apiKey.trim());
            try {
                const controller = new ChatController({ geminiApiKey: apiKey.trim() });
                setChatController(controller);
                setIsApiKeySet(true);
            } catch (error: any) {
                 alert(`Error initializing ChatController: ${error.message}`);
                 setIsApiKeySet(false);
            }
        } else {
            alert("Please enter a Gemini API Key.");
        }
    };
    
    const handleApiKeyChange = () => {
        localStorage.removeItem('geminiApiKey');
        setIsApiKeySet(false);
        setChatController(null);
        setMessages([]);
        setDiscoveredTools([]);
        // Optionally clear apiKey from state too if you want the input field to clear
        // setApiKey(''); 
    };

    // Effect for ChatController listeners
    useEffect(() => {
        if (!chatController) return;

        setMcpServers(chatController.listMcpServers());
        setDiscoveredTools(chatController.getDiscoveredTools());
        setMessages([...chatController.getChatHistory()]);

        const messageListener = (message: ChatMessage) => {
            setMessages(prev => [...prev, message]);
            setIsLoading(false); // Assume loading stops when a new message (esp. assistant's) arrives
        };
        const toolDiscoveryListener = (mappings: DynamicGeminiToolMapping[]) => {
            setDiscoveredTools(mappings);
        };
        const errorListener = (error: Error) => {
            console.error("ChatController Error:", error);
            // Could add an error message to UI here
            setMessages(prev => [...prev, {
                id: `err-${Date.now()}`,
                role: 'system',
                content: `An error occurred: ${error.message}`,
                timestamp: new Date(),
                isError: true
            }]);
            setIsLoading(false);
        };
        const toolCallStartListener = (toolName: string, _args: any) => {
            setMessages(prev => [...prev, {
                id: `tcstart-${Date.now()}`,
                role: 'system',
                content: `Calling tool: ${toolName}...`,
                timestamp: new Date()
            }]);
            setIsLoading(true); // Show loading during tool call
        };
        const toolCallEndListener = (toolName: string, _result: any, success: boolean) => {
             setMessages(prev => [...prev, {
                id: `tcend-${Date.now()}`,
                role: 'system',
                content: `Tool ${toolName} execution ${success ? 'finished' : 'failed'}. Waiting for AI summary...`,
                timestamp: new Date()
            }]);
            // setIsLoading(false); // AI will provide final response, loading should continue
        };


        chatController.on('message', messageListener);
        chatController.on('toolDiscoveryUpdate', toolDiscoveryListener);
        chatController.on('error', errorListener);
        chatController.on('toolCallStart', toolCallStartListener);
        chatController.on('toolCallEnd', toolCallEndListener);

        return () => {
            chatController.off('message', messageListener);
            chatController.off('toolDiscoveryUpdate', toolDiscoveryListener);
            chatController.off('error', errorListener);
            chatController.off('toolCallStart', toolCallStartListener);
            chatController.off('toolCallEnd', toolCallEndListener);
        };
    }, [chatController]);

    const handleSendMessage = async () => {
        if (!chatController || (!userInput.trim() && attachedFiles.length === 0)) return;
        setIsLoading(true);
        const textToSend = userInput;
        const filesToSend = [...attachedFiles];
        
        setUserInput(''); // Clear input field
        setAttachedFiles([]); // Clear selected files
        if(fileInputRef.current) fileInputRef.current.value = ""; // Reset file input

        await chatController.sendMessage(textToSend, filesToSend);
        // setIsLoading(false); // Loading will be managed by message/error events
    };

    const handleAddServer = async () => {
        if (!chatController || !newServerName.trim() || !newServerUrl.trim()) return;
        setIsLoading(true);
        const result = await chatController.addMcpServer(newServerName, newServerUrl);
        if (result.success) {
            setMcpServers(chatController.listMcpServers()); // Refresh server list
            setNewServerName('');
            setNewServerUrl('');
        } else {
            alert(`Failed to add server: ${result.message}`);
        }
        setIsLoading(false);
    };

    const handleRemoveServer = async (name: string) => {
        if (!chatController) return;
        setIsLoading(true);
        const result = await chatController.removeMcpServer(name);
        if (result.success) {
            setMcpServers(chatController.listMcpServers());
        } else {
            alert(`Failed to remove server: ${result.message}`);
        }
        setIsLoading(false);
    };
    
    const handleSetDefaultServer = async (name: string) => {
        if (!chatController) return;
        setIsLoading(true);
        const result = await chatController.setDefaultMcpServer(name);
         if (result.success) {
            setMcpServers(chatController.listMcpServers()); // Re-render to show new default
        } else {
            alert(`Failed to set default server: ${result.message}`);
        }
        setIsLoading(false);
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            setAttachedFiles(prevFiles => [...prevFiles, ...Array.from(event.target.files!)]);
        }
    };
    
    const removeAttachedFile = (fileNameToRemove: string) => {
        setAttachedFiles(prevFiles => prevFiles.filter(file => file.name !== fileNameToRemove));
         if(fileInputRef.current && attachedFiles.length === 1 && attachedFiles[0].name === fileNameToRemove) {
            fileInputRef.current.value = ""; // Reset if last file removed
        }
    };


    if (!isApiKeySet) {
        return (
            <div className="app-container">
                <div className="config-section">
                    <h2>Setup Gemini API Key</h2>
                    <label htmlFor="apiKey">Gemini API Key:</label>
                    <input
                        type="password"
                        id="apiKey"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Enter your Gemini API Key"
                    />
                    <button onClick={handleApiKeySubmit}>Set API Key</button>
                </div>
            </div>
        );
    }

    return (
        <div className="app-container">
            <h1>MCP Gemini Chat Web</h1>
            <button onClick={handleApiKeyChange} style={{backgroundColor: '#ffc107', color: 'black', maxWidth: '200px'}}>Change API Key</button>

            <div className="config-section">
                <h2>MCP Server Configuration</h2>
                <div>
                    <label htmlFor="serverName">Server Name:</label>
                    <input type="text" id="serverName" value={newServerName} onChange={(e) => setNewServerName(e.target.value)} placeholder="e.g., my-tools-server"/>
                    <label htmlFor="serverUrl">Server URL:</label>
                    <input type="url" id="serverUrl" value={newServerUrl} onChange={(e) => setNewServerUrl(e.target.value)} placeholder="e.g., http://localhost:8080"/>
                    <button onClick={handleAddServer} disabled={isLoading}>Add MCP Server</button>
                </div>
                <div className="server-list">
                    <h3>Configured Servers:</h3>
                    {mcpServers.length === 0 ? <p>No servers configured.</p> : (
                        <ul>
                            {mcpServers.map(server => (
                                <li key={server.name}>
                                    <span>{server.name} ({server.url})</span>
                                    <div>
                                        {server.default && <span className="default-indicator">(Default)</span>}
                                        {!server.default && <button className="default-btn" onClick={() => handleSetDefaultServer(server.name)} disabled={isLoading}>Set Default</button>}
                                        <button onClick={() => handleRemoveServer(server.name)} disabled={isLoading}>Remove</button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                 <div className="discovered-tools">
                    <h3>Discovered Gemini Tools (from MCP Servers):</h3>
                    {discoveredTools.length === 0 ? <p>No tools discovered or mapped.</p> : (
                        <ul>
                            {discoveredTools.map(tool => (
                                <li key={tool.geminiFunctionDeclaration.name}>
                                    {tool.geminiFunctionDeclaration.name} (from {tool.mcpServerName} - {tool.mcpToolName})
                                    <small style={{display: 'block', color: '#555'}}>{tool.geminiFunctionDeclaration.description}</small>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            <div className="chat-section">
                <h2>Chat</h2>
                <div className="messages-window">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`message ${msg.role} ${msg.isError ? 'error' : ''}`}>
                            <strong>{msg.role === 'assistant' ? 'AI' : msg.role === 'user' ? 'You' : msg.role.toUpperCase()}: </strong>
                            {msg.content}
                            {msg.toolCall && (
                                <div style={{fontSize: '0.8em', opacity: 0.8, marginTop: '5px', borderTop: '1px dashed #ccc', paddingTop: '5px'}}>
                                    Tool: {msg.toolCall.name} <br/>
                                    Args: {JSON.stringify(msg.toolCall.args)} <br/>
                                    {msg.toolCall.status && `Status: ${msg.toolCall.status}`} <br/>
                                    {msg.toolCall.result && `Result: ${JSON.stringify(msg.toolCall.result)}`}
                                </div>
                            )}
                        </div>
                    ))}
                    <div ref={messagesEndRef} /> {/* For scrolling */}
                </div>
                <div className="chat-input-area">
                    <textarea
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        placeholder="Type your message or drop files..."
                        onKeyPress={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }}}
                        disabled={isLoading}
                    />
                    <div>
                        <label htmlFor="file-input" className="file-input-label">Attach Files</label>
                        <input 
                            id="file-input" 
                            type="file" 
                            multiple 
                            onChange={handleFileChange}
                            ref={fileInputRef}
                            disabled={isLoading}
                        />
                        <button onClick={handleSendMessage} disabled={isLoading || (!userInput.trim() && attachedFiles.length === 0)}>
                            {isLoading ? 'Sending...' : 'Send'}
                        </button>
                    </div>
                </div>
                {attachedFiles.length > 0 && (
                    <div className="selected-files">
                        <p>Attached files:</p>
                        {attachedFiles.map(file => (
                            <span key={file.name} style={{marginRight: '10px', display: 'inline-block'}}>
                                {file.name} ({ (file.size / 1024).toFixed(1) } KB)
                                <button onClick={() => removeAttachedFile(file.name)} disabled={isLoading}>X</button>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;

