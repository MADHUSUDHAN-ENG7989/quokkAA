require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pinecone } = require('@pinecone-database/pinecone');
const { HfInference } = require('@huggingface/inference');
const Groq = require('groq-sdk');
const QueryLog = require('./models/QueryLog');

const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || "rag-materials";

class RAGPipeline {
    constructor() {
        console.log("DEBUG: Initializing Node.js RAGPipeline...");
        
        // HuggingFace client
        const hfToken = process.env.HF_TOKEN || "";
        this.hf = new HfInference(hfToken);
        
        // Pinecone connect
        const pineconeKey = process.env.PINECONE_API_KEY;
        if (!pineconeKey) {
            console.log("❌ WARNING: PINECONE_API_KEY not found in environment.");
            this.index = null;
        } else {
            try {
                const pc = new Pinecone({ apiKey: pineconeKey });
                this.index = pc.index(PINECONE_INDEX_NAME);
                const masked = pineconeKey.substring(0, 5) + "..." + pineconeKey.substring(pineconeKey.length - 5);
                console.log(`🚀 Found Pinecone API Key: ${masked}`);
                console.log(`✅ Successfully connected to Pinecone index: ${PINECONE_INDEX_NAME}`);
            } catch (e) {
                console.log(`❌ Error connecting to Pinecone: ${e.message}`);
                this.index = null;
            }
        }
        
        // Groq connect
        const groqKey = process.env.GROQ_API_KEY;
        if (groqKey) {
            this.groq = new Groq({ apiKey: groqKey });
        } else {
            this.groq = null;
        }
    }

    async getEmbedding(text) {
        // Embed using BAAI/bge-small-en-v1.5
        const output = await this.hf.featureExtraction({
            model: "BAAI/bge-small-en-v1.5",
            inputs: text
        });
        return output;
    }

    async query(queryText) {
        if (!this.index) {
            return {
                answer: "The Material Science database is currently empty. Please ingest your specialized datasets first.",
                sources: []
            };
        }
        
        console.log(`DEBUG: Performing similarity search for: ${queryText}`);
        let docs = [];
        try {
            const queryEmbedding = await this.getEmbedding(queryText);
            const response = await this.index.query({
                vector: queryEmbedding,
                topK: 10,
                includeMetadata: true
            });
            const allDocs = response.matches || [];
            const RELEVANCE_THRESHOLD = 0.75;
            docs = allDocs.filter(d => d.score >= RELEVANCE_THRESHOLD);
        } catch(e) {
            console.error("Error searching pinecone:", e);
        }
        
        console.log(`DEBUG: Found ${docs.length} relevant documents.`);
        if (docs.length === 0) {
            return {
                answer: "I am sorry, but that question is out of the RAG context. Please ask a question related to the uploaded materials science datasets. 🧠🔬",
                sources: []
            };
        }
        
        const context = docs.map(d => d.metadata.text || "").join("\n\n");
        const sources = [...new Set(docs.map(d => (d.metadata && d.metadata.source) ? d.metadata.source : "Unknown"))];
        
        const messages = [
            {
                role: "system",
                content: `You are a professional AI assistant for material science researchers.

Instructions:
- Answer exactly according to the user’s question depth.
- Give concise answers for simple questions.
- Give detailed, structured, technical explanations only when required.
- Do not add unrelated information, assumptions, warnings, history, or extra context unless asked.
- Prioritize accuracy, clarity, and relevance.
- Use scientific terminology correctly but explain complex concepts simply when needed.
- If the question is ambiguous, ask a short clarifying question before answering.
- Prefer direct answers over long introductions.
- Use bullet points, tables, equations, or stepwise explanations only when they improve understanding.
- For research questions, include mechanisms, properties, equations, comparisons, applications, and limitations only if relevant.
- Never hallucinate data, citations, or experimental results.
- If unsure, clearly state uncertainty instead of guessing.
- Maintain a professional and research-oriented tone.

Retrieved Scientific Context to help answer the question:
${context}`
            },
            {
                role: "user",
                content: `Context:\n${context}\n\nQuestion: ${queryText}`
            }
        ];

        let answer = "";
        try {
            console.log("DEBUG: Sending request to Groq API...");
            const response = await this.groq.chat.completions.create({
                model: "llama-3.1-8b-instant",
                messages: messages,
                max_tokens: 1024,
                temperature: 0.7
            });
            console.log("DEBUG: Successfully received response from Groq.");
            
            let generated_text = response.choices[0].message.content || "";
            if (generated_text.includes("[INTERNAL_KNOWLEDGE]")) {
                generated_text = generated_text.replace("[INTERNAL_KNOWLEDGE]", "");
                sources.length = 0;
            }
            generated_text = generated_text.replace(/\[INTERNAL_KNOWLEDGE\]/g, "").trim();
            answer = `**Answer:**\n${generated_text}`;
        } catch (e) {
            console.log(`LLM synthesis failed: ${e.message}.`);
            const sourceList = sources.length > 0 
                ? `\n\n**Relevant Reference Documents Found:**\n` + sources.map(s => `📄 *${s}*`).join('\n')
                : '';
            answer = `**AI Synthesis Service Offline** 🧠🔌\n\nThe AI model is temporarily busy or unavailable. ${sourceList}\n\nPlease try again in a few moments! ✨`;
        }

        return { answer, sources };
    }

    async *queryStream(queryText, history = [], user = null, model = 'rag') {
        const startTime = Date.now();

        // ROUTE: Fine-tuned Qwen Model (via Hugging Face Space llama.cpp API)
        if (model === 'finetuned') {
            console.log("DEBUG: Routing to Fine-tuned Qwen Model API...");
            const apiUrl = process.env.FINETUNED_API_URL || 'http://localhost:8080/v1/chat/completions';
            
            try {
                yield `data: ${JSON.stringify({ type: 'sources', sources: [] })}\n\n`;

                const system_prompt = `You are a professional AI assistant for material science researchers.

Instructions:
- Answer exactly according to the user’s question depth.
- Give concise answers for simple questions.
- Give detailed, structured, technical explanations only when required.
- Do not add unrelated information, assumptions, warnings, history, or extra context unless asked.
- Prioritize accuracy, clarity, and relevance.
- Use scientific terminology correctly but explain complex concepts simply when needed.
- If the question is ambiguous, ask a short clarifying question before answering.
- Prefer direct answers over long introductions.
- Use bullet points, tables, equations, or stepwise explanations only when they improve understanding.
- For research questions, include mechanisms, properties, equations, comparisons, applications, and limitations only if relevant.
- Never hallucinate data, citations, or experimental results.
- If unsure, clearly state uncertainty instead of guessing.
- Maintain a professional and research-oriented tone.`;
                
                const recentHistory = history.slice(-4); // Only keep the last 4 messages
                const fetchMessages = [
                    { role: "system", content: system_prompt },
                    ...recentHistory
                        .map(msg => ({ role: msg.role || "user", content: msg.content || "" }))
                        .filter(msg => msg.content.trim() !== ""),
                    { role: "user", content: queryText }
                ];

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: "qwen2.5-0.5b",
                        messages: fetchMessages,
                        stream: true,
                        temperature: 0.7,
                        max_tokens: 512
                    })
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`API error: ${response.status}. Details: ${errText}`);
                }
                
                // Read the stream
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8");
                let done = false;
                let buffer = "";

                while (!done) {
                    const { value, done: readerDone } = await reader.read();
                    done = readerDone;
                    if (value) {
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop(); // keep the last potentially incomplete line in buffer

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const dataStr = line.replace('data: ', '').trim();
                                if (dataStr === '[DONE]') continue;
                                if (!dataStr) continue;
                                try {
                                    const data = JSON.parse(dataStr);
                                    if (data.choices && data.choices.length > 0) {
                                        const delta = data.choices[0].delta.content || "";
                                        if (delta) {
                                            yield `data: ${JSON.stringify({ type: 'chunk', content: delta })}\n\n`;
                                        }
                                    }
                                } catch (err) {
                                    // ignore parse errors for incomplete chunks
                                }
                            }
                        }
                    }
                }

                yield `data: ${JSON.stringify({ type: 'done' })}\n\n`;
                return;
            } catch (e) {
                console.error("Fine-tuned API failed:", e);
                yield `data: ${JSON.stringify({ type: 'chunk', content: `*(Error: ${e.message}. Please ensure the HF Space API is running at ${apiUrl})*` })}\n\n`;
                yield `data: ${JSON.stringify({ type: 'done' })}\n\n`;
                return;
            }
        }

        // DEFAULT: RAG Pipeline logic
        const greetings = ["hello", "hi", "hey", "hola", "greetings", "good morning", "good afternoon", "good evening"];
        const queryLower = queryText.toLowerCase().trim();
        const isGreeting = greetings.some(g => queryLower === g || queryLower.startsWith(g + ' ') || queryLower.startsWith(g + ','));
        
        let context = "";
        let sources = [];
        let fullResponseContent = '';
        
        if (isGreeting) {
            console.log(`DEBUG: Detected greeting: ${queryText}`);
            context = "N/A (Greeting detected)";
        } else if (!this.index) {
            yield `data: ${JSON.stringify({ type: 'error', content: 'The Material Science database is currently empty. Please ingest your specialized datasets first.' })}\n\n`;
            return;
        } else {
            try {
                console.log(`DEBUG: Performing streaming similarity search for: ${queryText}`);
                const queryEmbedding = await this.getEmbedding(queryText);
                const response = await this.index.query({
                    vector: queryEmbedding,
                    topK: 10,
                    includeMetadata: true
                });
                const allDocs = response.matches || [];
                // Only keep documents with a relevance score above the threshold
                const RELEVANCE_THRESHOLD = 0.75;
                const docs = allDocs.filter(d => d.score >= RELEVANCE_THRESHOLD);
                console.log(`DEBUG: Found ${allDocs.length} documents, ${docs.length} above relevance threshold (${RELEVANCE_THRESHOLD}).`);
                
                if (docs.length === 0) {
                    const outOfContextMsg = "I am sorry, but that question is out of the RAG context. Please ask a question related to the uploaded materials science datasets. 🧠🔬";
                    yield `data: ${JSON.stringify({ type: 'sources', sources: [] })}\n\n`;
                    yield `data: ${JSON.stringify({ type: 'chunk', content: outOfContextMsg })}\n\n`;
                    
                    try {
                        await QueryLog.create({
                            userId: user ? user.id : null,
                            userEmail: user ? user.email : 'guest',
                            query: queryText,
                            answer: outOfContextMsg,
                            sources: [],
                            responseTimeMs: Date.now() - startTime,
                            usedRagContext: false,
                        });
                    } catch (logErr) {
                        console.warn('Failed to save query log:', logErr.message);
                    }
                    
                    yield `data: ${JSON.stringify({ type: 'done' })}\n\n`;
                    return;
                }
                
                context = docs.map(d => {
                    const title = d.metadata ? (d.metadata.title || 'Unknown') : 'Unknown';
                    const year = d.metadata ? (d.metadata.year || 'Unknown') : 'Unknown';
                    const content = d.metadata ? (d.metadata.text || '') : '';
                    return `### Source: ${title} (${year})\n${content}`;
                }).join("\n\n");
                
                const rawSources = docs.map(d => {
                    const title = d.metadata ? (d.metadata.title || 'Unknown') : 'Unknown';
                    const year = d.metadata ? (d.metadata.year || 'Unknown') : 'Unknown';
                    return `${title} (${year})`;
                });
                sources = [...new Set(rawSources)].sort();
            } catch (e) {
                console.error(`❌ Error during similarity search (HF/Pinecone): ${e.message}`);
                // Don't yield technical errors to the user, just fallback to internal knowledge
                context = "Context unavailable due to a temporary search error.";
                sources = [];
            }
        }

        const userGreeting = user ? `\n\nADDITIONAL INFO: The user you are talking to is named ${user.name}. Feel free to greet them by name!` : '';

        const messages = [
            {
                role: "system",
                content: `You are a professional AI assistant for material science researchers.

Instructions:
- Answer exactly according to the user’s question depth.
- Give concise answers for simple questions.
- Give detailed, structured, technical explanations only when required.
- Do not add unrelated information, assumptions, warnings, history, or extra context unless asked.
- Prioritize accuracy, clarity, and relevance.
- Use scientific terminology correctly but explain complex concepts simply when needed.
- If the question is ambiguous, ask a short clarifying question before answering.
- Prefer direct answers over long introductions.
- Use bullet points, tables, equations, or stepwise explanations only when they improve understanding.
- For research questions, include mechanisms, properties, equations, comparisons, applications, and limitations only if relevant.
- Never hallucinate data, citations, or experimental results.
- If unsure, clearly state uncertainty instead of guessing.
- Maintain a professional and research-oriented tone.

Retrieved Scientific Context to help answer the question:
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

    async generateTitle(query, response) {
        if (!this.groq) {
            return "New Chat";
        }
        try {
            const prompt = `
            Summarize this chat interaction into a short, catchy, professional title (max 4-5 words).
            User Query: ${query}
            AI Response excerpt: ${response.substring(0, 300)}
            
            Title (no quotes, just the text):
            `;
            
            console.log(`DEBUG: Requesting title from Groq for query: ${query.substring(0, 50)}...`);
            const completion = await this.groq.chat.completions.create({
                model: "llama-3.1-8b-instant",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.7,
                max_tokens: 20
            });
            const title = completion.choices[0].message.content.trim();
            console.log(`✅ Groq generated title: ${title}`);
            return title;
        } catch (e) {
            console.log(`Groq title generation failed: ${e.message}`);
            return "New Chat";
        }
    }
}

const rag = new RAGPipeline();
module.exports = { rag };
