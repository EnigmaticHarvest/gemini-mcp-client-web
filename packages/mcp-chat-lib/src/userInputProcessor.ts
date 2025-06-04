// packages/mcp-chat-lib/src/userInputProcessor.ts
import { Part } from "@google/generative-ai";
import chalk from 'chalk';

export function determineMimeType(fileNameOrPath: string): string {
    const extension = fileNameOrPath.split('.').pop()?.toLowerCase();
    switch (extension) {
        case 'txt': return 'text/plain';
        case 'json': return 'application/json';
        case 'xml': return 'application/xml';
        case 'csv': return 'text/csv';
        case 'md': return 'text/markdown';
        case 'html': return 'text/html';
        case 'css': return 'text/css';
        case 'js': return 'application/javascript';
        case 'ts': return 'application/typescript';
        case 'png': return 'image/png';
        case 'jpg': case 'jpeg': return 'image/jpeg';
        case 'gif': return 'image/gif';
        case 'webp': return 'image/webp';
        case 'svg': return 'image/svg+xml';
        case 'heic': return 'image/heic';
        case 'heif': return 'image/heif';
        case 'pdf': return 'application/pdf';
        // Add more common types as needed
        default: return 'application/octet-stream';
    }
}

function fileToGenerativePart(file: File, base64Data: string): Part {
    const mimeType = file.type || determineMimeType(file.name); // Prefer File.type if available
    console.log(chalk.blue(`  [UserInputProc] Processed file: ${file.name} as ${mimeType}`));
    return { inlineData: { mimeType, data: base64Data } };
}

async function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                // result is data:mime/type;base64,ENCODED_DATA
                resolve(reader.result.split(',')[1]);
            } else {
                reject(new Error('Failed to read file as base64 string.'));
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
}


export async function processWebUserInput(
    userInputText: string,
    attachedFiles: File[] = []
): Promise<string | Part[]> {
    const parts: Part[] = [];
    
    // Add the text part first, if any
    if (userInputText.trim().length > 0) {
        parts.push({ text: userInputText });
    }

    // Process each attached file
    for (const file of attachedFiles) {
        try {
            console.log(chalk.blue(`  [UserInputProc] Processing attached file: ${file.name} (${file.size} bytes)`));
            const base64Data = await readFileAsBase64(file);
            parts.push(fileToGenerativePart(file, base64Data));
        } catch (error: any) {
            console.error(chalk.red(`  [UserInputProc] Error reading file ${file.name}: ${error.message}`), error);
            // Include an error message as a text part for Gemini to see
            parts.push({ text: `[File Error: Could not load file '${file.name}'. Reason: ${error.message}]` });
        }
    }

    if (parts.length === 0 && userInputText.trim().length > 0) {
        // This case should ideally not happen if userInputText is not empty,
        // but as a fallback if all files failed and text was empty.
        return userInputText;
    }
    if (parts.length === 0 && userInputText.trim().length === 0) {
        return ""; // Empty input gives empty message
    }

    return parts;
}

