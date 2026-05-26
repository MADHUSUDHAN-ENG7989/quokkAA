const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function test() {
    const transport = new StdioClientTransport({
        command: "npx",
        args: ["-y", "@fre4x/arxiv"],
        env: process.env
    });
    const client = new Client(
        { name: "quokka-backend", version: "1.0.0" },
        { capabilities: { tools: {} } }
    );
    await client.connect(transport);
    const tools = await client.listTools();
    console.log("TOOL NAMES:", tools.tools.map(t => t.name).join(", "));
    process.exit(0);
}
test().catch(console.error);
