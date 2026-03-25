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
            docs = response.matches || [];
        } catch(e) {
            console.error("Error searching pinecone:", e);
        }
        
        console.log(`DEBUG: Found ${docs.length} relevant documents.`);
        const context = docs.map(d => d.metadata.text || "").join("\n\n");
        const sources = [...new Set(docs.map(d => (d.metadata && d.metadata.source) ? d.metadata.source : "Unknown"))];
        
        const messages = [
            {
                role: "system",
                content: "You are a SUPER ENTHUSIASTIC and HYPERACTIVE expert Material Scientist assistant! 🌟 Formulate your answer using the provided scientific context first. If the context does not contain the answer, use your own expert internal knowledge to provide a highly detailed, accurate, and efficient response. IMPORTANT INSTRUCTION: If you rely on your internal knowledge because the context was insufficient, you MUST start your response with the exact string '[INTERNAL_KNOWLEDGE]'. Do not include this string if you used the provided context. This string is for system orchestration only; DO NOT include it anywhere else in your response text. Do not mention whether the information came from the context or your internal knowledge in the readable text. CRITICAL: Provide your answers with EXCELLENT data presentation! 🎉 Use tables for structured data, bold text for emphasis and titles, bullet points or numbered lists where appropriate, and lots of relevant emojis to keep the energy high! ✨"
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
            console.log(`LLM synthesis failed: ${e.message}. Falling back to raw RAG.`);
            answer = `*(Notice: LLM Generator unavailable, showing raw RAG context below)*\n\n${context}`;
        }

        return { answer, sources };
    }

    async *queryStream(queryText, history = [], user = null) {
        const startTime = Date.now();
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
                console.log(`❌ Error during similarity search: ${e.message}`);
                yield `data: ${JSON.stringify({ type: 'chunk', content: `*(Error during search: ${e.message})*` })}\n\n`;
                context = "No context available due to search error.";
                sources = [];
            }
        }

        const userGreeting = user ? `\n\nADDITIONAL INFO: The user you are talking to is named ${user.name}. Feel free to greet them by name!` : '';

        const messages = [
            {
                role: "system",
                content: "You are a professional, accurate, and concise expert Material Scientist assistant. 🔬 Your goal is to provide high-quality scientific information.\n\nSTRICT RULES:\n1. If the provided context is relevant, use it to formulate your answer. Focus on factual accuracy.\n2. If the user's question is a simple greeting, respond naturally and professionally without referencing scientific context unless asked.\n3. Never mention whether the information came from a document or your own knowledge.\n4. Use LaTeX for math/chemistry: `$formula$` for inline, `$$formula$$` for blocks.\n5. For images, use Markdown ONLY: `![Description](https://dummyimage.com/800x400/202123/ffffff&text=description+with+plus+signs)` (replace spaces with +).\n6. Maintain a professional tone. Use formatting (tables, bold text, lists) for clarity, and use emojis sparingly only when appropriate for technical emphasis 🚀." + userGreeting
            },
            {
                role: "system",
                content: `Here is the retrieved scientific context:\n${context}`
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
            console.log(`LLM synthesis failed: ${e.message}. Falling back.`);
            const rawText = `*(Notice: LLM Generator unavailable, showing raw RAG context below)*\n\n${context}`;
            yield `data: ${JSON.stringify({ type: 'chunk', content: rawText })}\n\n`;
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
