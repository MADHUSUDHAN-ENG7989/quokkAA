require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { HfInference } = require('@huggingface/inference');
const Groq = require('groq-sdk');
const QueryLog = require('./models/QueryLog');
const { searchArxiv } = require('./mcp-client');

class LiveRAGPipeline {
    constructor() {
        console.log("DEBUG: Initializing Qdrant Live RAG Pipeline...");
        
        // HuggingFace client
        const hfToken = process.env.HF_TOKEN || "";
        this.hf = new HfInference(hfToken);
        
        // Groq client
        const groqKey = process.env.GROQ_API_KEY;
        this.groq = groqKey ? new Groq({ apiKey: groqKey }) : null;

        // Qdrant configurations
        const qdrantUrl = process.env.QDRANT_URL;
        const qdrantKey = process.env.QDRANT_API_KEY;
        const qdrantCollection = process.env.QDRANT_COLLECTION_NAME || "rag-materials";
        
        if (!qdrantUrl || !qdrantKey) {
            console.log("❌ WARNING: QDRANT_URL or QDRANT_API_KEY not found in environment.");
            this.qdrantEnabled = false;
        } else {
            this.qdrantUrl = qdrantUrl.endsWith('/') ? qdrantUrl.slice(0, -1) : qdrantUrl;
            this.qdrantKey = qdrantKey;
            this.qdrantCollection = qdrantCollection;
            this.qdrantEnabled = true;
            console.log(`🚀 Qdrant Cloud configured at: ${this.qdrantUrl}`);
            
            // Auto-initialize Qdrant collection
            this.initQdrantCollection().catch(err => {
                console.error("❌ Failed to auto-initialize Qdrant collection:", err.message);
            });
        }

        // Serper configurations
        this.serperKey = process.env.SERPER_API_KEY || "";
        if (!this.serperKey) {
            console.log("❌ WARNING: SERPER_API_KEY not found in environment.");
        }
    }

    async getEmbedding(text) {
        const output = await this.hf.featureExtraction({
            model: "BAAI/bge-small-en-v1.5",
            inputs: text
        });
        return output;
    }

    async initQdrantCollection() {
        if (!this.qdrantEnabled) return;
        
        try {
            console.log(`DEBUG: Checking if Qdrant collection '${this.qdrantCollection}' exists...`);
            const checkRes = await fetch(`${this.qdrantUrl}/collections/${this.qdrantCollection}`, {
                headers: { 'api-key': this.qdrantKey }
            });
            
            if (checkRes.status === 404 || !checkRes.ok) {
                console.log(`DEBUG: Creating Qdrant collection '${this.qdrantCollection}' with 384 dimensions (Cosine)...`);
                const createRes = await fetch(`${this.qdrantUrl}/collections/${this.qdrantCollection}`, {
                    method: 'PUT',
                    headers: {
                        'api-key': this.qdrantKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        vectors: {
                            size: 384,
                            distance: 'Cosine'
                        }
                    })
                });
                
                if (!createRes.ok) {
                    const errTxt = await createRes.text();
                    throw new Error(`Failed to create collection: ${errTxt}`);
                }
                console.log(`✅ Qdrant collection '${this.qdrantCollection}' created successfully.`);
            } else {
                console.log(`✅ Qdrant collection '${this.qdrantCollection}' already exists.`);
            }
        } catch (e) {
            console.error(`❌ Error initializing Qdrant: ${e.message}`);
        }
    }

    async webSearch(queryText) {
        if (!this.serperKey) {
            console.log("❌ Serper API key is missing. Skipping web search.");
            return [];
        }

        try {
            console.log(`DEBUG: Triggering Serper.dev web search for: "${queryText}"`);
            const res = await fetch('https://google.serper.dev/search', {
                method: 'POST',
                headers: {
                    'X-API-KEY': this.serperKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ q: queryText })
            });

            if (!res.ok) {
                const errTxt = await res.text();
                throw new Error(`Serper search failed: ${errTxt}`);
            }

            const searchData = await res.json();
            const organic = searchData.organic || [];
            console.log(`✅ Serper returned ${organic.length} results.`);
            return organic;
        } catch (err) {
            console.error("❌ Serper search error:", err.message);
            return [];
        }
    }

    async *queryStream(queryText, history = [], user = null, model = 'qdrant') {
        const startTime = Date.now();
        
        if (!this.qdrantEnabled) {
            yield `data: ${JSON.stringify({ type: 'error', content: 'Qdrant Cloud is not configured properly.' })}\n\n`;
            return;
        }

        const greetings = ["hello", "hi", "hey", "hola", "greetings", "good morning", "good afternoon", "good evening"];
        const queryLower = queryText.toLowerCase().trim();
        const isGreeting = greetings.some(g => queryLower === g || queryLower.startsWith(g + ' ') || queryLower.startsWith(g + ','));

        let context = "";
        let sources = [];
        let fullResponseContent = '';

        if (isGreeting) {
            context = "N/A (Greeting detected)";
        } else {
            try {
                console.log("DEBUG: Checking if Arxiv search is required...");
                const toolResponse = await this.groq.chat.completions.create({
                    model: "llama-3.1-8b-instant",
                    messages: [
                        { role: "system", content: "You are an intelligent router. Determine if the user's query requires searching academic papers on Arxiv (e.g. they ask about a specific paper, recent research, authors, deep science). If yes, call the arxiv_search tool with a concise search query. If no, just output 'NO'." },
                        { role: "user", content: queryText }
                    ],
                    tools: [
                        {
                            type: "function",
                            function: {
                                name: "arxiv_search",
                                description: "Search Arxiv for academic papers",
                                parameters: {
                                    type: "object",
                                    properties: {
                                        query: { type: "string", description: "Search query for Arxiv" }
                                    },
                                    required: ["query"]
                                }
                            }
                        }
                    ],
                    tool_choice: "auto",
                    temperature: 0.1,
                    max_tokens: 100
                });
                
                const message = toolResponse.choices[0].message;
                if (message.tool_calls && message.tool_calls.length > 0) {
                    const toolCall = message.tool_calls[0];
                    if (toolCall.function.name === "arxiv_search") {
                        const args = JSON.parse(toolCall.function.arguments);
                        console.log(`DEBUG: Arxiv search triggered by LLM: "${args.query}"`);
                        const arxivResults = await searchArxiv(args.query, 3);
                        
                        try {
                            const parsedArxiv = JSON.parse(arxivResults);
                            if (Array.isArray(parsedArxiv)) {
                                const arxivContextStr = parsedArxiv.map(p => `### Arxiv Source: ${p.title} (${p.published || 'Unknown'})\nAuthors: ${p.authors ? p.authors.join(', ') : 'Unknown'}\nAbstract: ${p.summary || p.abstract || ''}\nLink: ${p.id || p.link || ''}`).join("\n\n");
                                context += arxivContextStr + "\n\n";
                                sources.push(...parsedArxiv.map(p => `${p.title} (Arxiv)`));
                            } else {
                                context += `### Arxiv Results:\n${arxivResults}\n\n`;
                                sources.push("Arxiv Search Results");
                            }
                        } catch(e) {
                            context += `### Arxiv Results:\n${arxivResults}\n\n`;
                            sources.push("Arxiv Search Results");
                        }
                    }
                } else {
                    console.log("DEBUG: LLM determined Arxiv search is not required.");
                }
            } catch(e) {
                console.error("Arxiv tool-calling error:", e);
            }

            try {
                // 1. Perform Live Web Search
                const searchResults = await this.webSearch(queryText);
                
                // 2. Ingest Search Results into Qdrant dynamically in real-time
                if (searchResults.length > 0) {
                    console.log("DEBUG: Dynamically embedding and uploading search results to Qdrant Cloud...");
                    const points = await Promise.all(
                        searchResults.slice(0, 5).map(async (res, idx) => {
                            try {
                                const textToEmbed = `${res.title}: ${res.snippet}`;
                                const vector = await this.getEmbedding(textToEmbed);
                                const pointId = Math.floor(Math.random() * 1000000000) + idx;
                                return {
                                    id: pointId,
                                    vector,
                                    payload: {
                                        title: res.title,
                                        year: new Date().getFullYear().toString(),
                                        text: res.snippet,
                                        source: res.link
                                    }
                                };
                            } catch (embedErr) {
                                console.error(`Error embedding result [${idx}]:`, embedErr.message);
                                return null;
                            }
                        })
                    );

                    const validPoints = points.filter(p => p !== null);
                    if (validPoints.length > 0) {
                        const upsertRes = await fetch(`${this.qdrantUrl}/collections/${this.qdrantCollection}/points?wait=true`, {
                            method: 'PUT',
                            headers: {
                                'api-key': this.qdrantKey,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ points: validPoints })
                        });

                        if (upsertRes.ok) {
                            console.log(`✅ Ingested ${validPoints.length} web search results into Qdrant collection '${this.qdrantCollection}'.`);
                        } else {
                            const errTxt = await upsertRes.text();
                            console.error(`❌ Qdrant upsert failed: ${errTxt}`);
                        }
                    }
                }

                // 3. Perform Qdrant Vector Retrieval
                console.log(`DEBUG: Performing vector similarity search on Qdrant Cloud...`);
                const queryEmbedding = await this.getEmbedding(queryText);
                const searchRes = await fetch(`${this.qdrantUrl}/collections/${this.qdrantCollection}/points/search`, {
                    method: 'POST',
                    headers: {
                        'api-key': this.qdrantKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        vector: queryEmbedding,
                        limit: 5,
                        with_payload: true,
                        score_threshold: 0.65
                    })
                });

                if (!searchRes.ok) {
                    const errTxt = await searchRes.text();
                    throw new Error(`Qdrant vector search failed: ${errTxt}`);
                }

                const searchData = await searchRes.json();
                const hits = searchData.result || [];
                console.log(`DEBUG: Retrieved ${hits.length} matches from Qdrant vector space.`);

                if (hits.length === 0) {
                    const outOfContextMsg = "I am sorry, but that question is out of the RAG context. Please ask a question related to the uploaded materials science datasets or web search results. 🧠🔬";
                    yield `data: ${JSON.stringify({ type: 'sources', sources: [] })}\n\n`;
                    yield `data: ${JSON.stringify({ type: 'chunk', content: outOfContextMsg })}\n\n`;
                    yield `data: ${JSON.stringify({ type: 'done' })}\n\n`;
                    return;
                }

                const qdrantContext = hits.map(h => {
                    const p = h.payload || {};
                    return `### Source: ${p.title} (${p.year})\nSnippet: ${p.text}\nLink: ${p.source}`;
                }).join("\n\n");
                context += qdrantContext;

                const rawSources = hits.map(h => {
                    const p = h.payload || {};
                    return `${p.title} (${p.year})`;
                });
                sources = [...new Set([...sources, ...rawSources])].sort();

            } catch (e) {
                console.error(`❌ Live RAG pipeline retrieval error: ${e.message}`);
                // Don't overwrite the arxiv context if there is one
                if (!context) {
                    context = "Context unavailable due to retrieval issues.";
                }
            }
        }

        const userGreeting = user ? `\n\nADDITIONAL INFO: The user you are talking to is named ${user.name}. Feel free to greet them by name!` : '';

        const messages = [
            {
                role: "system",
                content: `You are a research-grade Live RAG assistant specialized in scientific and technical domains.

STRICT RULES:

1. Answer ONLY using the retrieved context and verified live search results.
2. Never invent facts, papers, citations, values, or explanations.
3. If sufficient information is not available in the retrieved context, respond with:
   "I could not find reliable information in the retrieved sources."
4. Prioritize accuracy, scientific correctness, and factual grounding over creativity.
5. Always provide concise but technically detailed answers.
6. Include numerical values, experimental details, and technical terminology when available.
7. Clearly distinguish between established facts, hypotheses, and ongoing research.
8. Do not repeat unnecessary information or generate generic filler content.
9. Prefer recent and authoritative scientific sources.
10. If multiple sources disagree, mention the disagreement explicitly.
11. Always cite the source/title/URL of retrieved documents used in the answer.
12. Do not answer from model memory when retrieval context is missing.
13. Maintain context across follow-up questions.
14. For ambiguous questions, ask a clarification question before answering.
15. CONCISENESS & DEPTH MATCHING RULE: Evaluate the user's query.
    - If the user's query is a simple, direct, or factual question (e.g., "What is the atomic weight of silicon?", "formula of quartz"), output ONLY the direct, concise answer in 1 or 2 sentences maximum. Do NOT generate any headers, sections, future research, or filler text. Give the exact factual answer instantly.
    - Only if the user's query is a complex, multi-faceted research or mechanism question, structure the answers professionally using:
       - Overview
       - Key Properties / Findings
       - Mechanism / Explanation
       - Applications / Implications
       - Sources

RESPONSE STYLE:
- Professional
- Research-oriented
- Precise
- Non-repetitive
- Evidence-based

BAD RESPONSE EXAMPLES:
- Generic explanations
- Unsupported claims
- Fake citations
- Broad assumptions
- Hallucinated scientific concepts

GOOD RESPONSE EXAMPLES:
- Grounded technical explanations
- Citation-backed claims
- Retrieval-based synthesis
- Scientifically accurate summaries

FINAL RULE:
If retrieved evidence is weak or insufficient, prioritize honesty over completeness.

Retrieved Scientific & Live Web Context to help answer the question:
${context}` + userGreeting
            }
        ];

        for (const msg of history) {
            messages.push({ role: msg.role || "user", content: msg.content || "" });
        }

        messages.push({ role: "user", content: queryText });

        try {
            console.log("DEBUG: Initiating streaming request to Groq...");
            const stream = await this.groq.chat.completions.create({
                model: "llama-3.1-8b-instant",
                messages: messages,
                max_tokens: 2048,
                temperature: 0.7,
                stream: true
            });
            
            // Send sources upfront (empty if no relevant docs found)
            yield `data: ${JSON.stringify({ type: 'sources', sources: sources })}\n\n`;
            
            for await (const chunk of stream) {
                if (chunk.choices && chunk.choices.length > 0) {
                    const delta = chunk.choices[0].delta.content || "";
                    if (delta) {
                        fullResponseContent += delta;
                        yield `data: ${JSON.stringify({ type: 'chunk', content: delta })}\n\n`;
                    }
                }
            }
            
            // Log query to MongoDB
            try {
                await QueryLog.create({
                    userId: user ? user.id : null,
                    userEmail: user ? user.email : 'guest',
                    query: queryText,
                    answer: fullResponseContent.substring(0, 1000),
                    sources,
                    responseTimeMs: Date.now() - startTime,
                    usedRagContext: sources.length > 0,
                });
            } catch (logErr) {
                console.warn('Failed to save query log:', logErr.message);
            }
            
            yield `data: ${JSON.stringify({ type: 'done' })}\n\n`;
            
        } catch (e) {
            console.log(`LLM synthesis failed: ${e.message}.`);
            const sourceList = sources.length > 0 
                ? `\n\n**Relevant Reference Documents Found:**\n` + sources.map(s => `📄 *${s}*`).join('\n')
                : '';
            const fallbackText = `**AI Synthesis Service Offline** 🧠🔌\n\nThe AI model is temporarily busy or unavailable. ${sourceList}\n\nPlease try again in a few moments! ✨`;
            yield `data: ${JSON.stringify({ type: 'chunk', content: fallbackText })}\n\n`;
            yield `data: ${JSON.stringify({ type: 'done' })}\n\n`;
        }
    }

    async query(queryText) {
        try {
            const searchResults = await this.webSearch(queryText);
            if (searchResults.length > 0) {
                const points = await Promise.all(
                    searchResults.slice(0, 5).map(async (res, idx) => {
                        try {
                            const textToEmbed = `${res.title}: ${res.snippet}`;
                            const vector = await this.getEmbedding(textToEmbed);
                            const pointId = Math.floor(Math.random() * 1000000000) + idx;
                            return {
                                id: pointId,
                                vector,
                                payload: {
                                    title: res.title,
                                    year: new Date().getFullYear().toString(),
                                    text: res.snippet,
                                    source: res.link
                                }
                            };
                        } catch (embedErr) {
                            return null;
                        }
                    })
                );
                const validPoints = points.filter(p => p !== null);
                if (validPoints.length > 0) {
                    await fetch(`${this.qdrantUrl}/collections/${this.qdrantCollection}/points?wait=true`, {
                        method: 'PUT',
                        headers: {
                            'api-key': this.qdrantKey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ points: validPoints })
                    });
                }
            }

            const queryEmbedding = await this.getEmbedding(queryText);
            const searchRes = await fetch(`${this.qdrantUrl}/collections/${this.qdrantCollection}/points/search`, {
                method: 'POST',
                headers: {
                    'api-key': this.qdrantKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    vector: queryEmbedding,
                    limit: 5,
                    with_payload: true,
                    score_threshold: 0.65
                })
            });

            if (!searchRes.ok) return { answer: "Qdrant query failed.", sources: [] };
            const searchData = await searchRes.json();
            const hits = searchData.result || [];
            if (hits.length === 0) return { answer: "No matching context found.", sources: [] };

            const context = hits.map(h => {
                const p = h.payload || {};
                return `### Source: ${p.title} (${p.year})\nSnippet: ${p.text}\nLink: ${p.source}`;
            }).join("\n\n");

            const rawSources = hits.map(h => {
                const p = h.payload || {};
                return `${p.title} (${p.year})`;
            });
            const sources = [...new Set(rawSources)].sort();

            const messages = [
                {
                    role: "system",
                    content: `You are a research-grade Live RAG assistant specialized in scientific and technical domains. Solve the query using retrieved context: ${context}`
                },
                { role: "user", content: queryText }
            ];

            const response = await this.groq.chat.completions.create({
                model: "llama-3.1-8b-instant",
                messages,
                max_tokens: 1024,
                temperature: 0.5
            });

            return {
                answer: response.choices[0].message.content || "",
                sources
            };
        } catch (err) {
            console.error("Live RAG query error:", err.message);
            return { answer: `Error during Live RAG retrieval: ${err.message}`, sources: [] };
        }
    }
}

const liveRag = new LiveRAGPipeline();
module.exports = { liveRag };
