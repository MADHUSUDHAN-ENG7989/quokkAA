const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

let mcpClient = null;

async function initMcpClient() {
    if (mcpClient) return mcpClient;
    console.log("DEBUG: Initializing Arxiv MCP Client...");
    const transport = new StdioClientTransport({
        command: "npx",
        args: ["-y", "@fre4x/arxiv"],
        env: process.env
    });
    mcpClient = new Client(
        { name: "quokka-backend", version: "1.0.0" },
        { capabilities: { tools: {} } }
    );
    await mcpClient.connect(transport);
    console.log("✅ Arxiv MCP Client connected successfully.");
    return mcpClient;
}

async function searchArxiv(query, maxResults = 3) {
    try {
        const client = await initMcpClient();
        console.log(`DEBUG: Calling search_papers tool for query: "${query}"`);
        const result = await client.callTool({
            name: "search_papers",
            arguments: { query: query }
        });
        
        if (result && result.content && result.content.length > 0) {
            let text = result.content[0].text;
            // Best effort to limit to maxResults
            try {
                let parsed = JSON.parse(text);
                if (Array.isArray(parsed)) {
                    parsed = parsed.slice(0, maxResults);
                    text = JSON.stringify(parsed, null, 2);
                } else if (parsed.papers && Array.isArray(parsed.papers)) {
                    parsed.papers = parsed.papers.slice(0, maxResults);
                    text = JSON.stringify(parsed, null, 2);
                }
            } catch (e) {
                // If it's not JSON, just return the text
            }
            return text;
        }
        return "No results found on Arxiv.";
    } catch (e) {
        console.error("❌ Arxiv MCP Error:", e);
        return `Failed to fetch Arxiv articles: ${e.message}`;
    }
}

module.exports = { initMcpClient, searchArxiv };
