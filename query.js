// api/docs.js — MIPI POWER HOUSE Document Intelligence API
//
// Handles three actions:
//   stats  → returns doc counts from document_chunks table
//   query  → embeds the user question, searches pgvector, GPT-4o answers
//
// Architecture:
//   1. User question → OpenAI text-embedding-3-small → 1536-dim vector
//   2. pgvector cosine similarity search → top 5 most relevant chunks
//   3. Chunks + question → GPT-4o → answer with citations
//
// Prerequisites in Supabase:
//   - pgvector extension enabled
//   - document_chunks table (see db/schema_docs.sql)
//   - Documents ingested via scripts/ingest_docs.js

export const config = { api: { bodyParser: true } };

const EMBED_MODEL = "text-embedding-3-small";
const CHAT_MODEL  = "gpt-4o";
const TOP_K       = 5;   // chunks to retrieve per query
const MAX_CHUNK   = 800; // chars shown in citation preview

// ── Helpers ───────────────────────────────────────────────────────────────────
function getEnv() {
  const openaiKey  = process.env.OPENAI_API_KEY;
  const supaUrl    = process.env.SUPABASE_URL;
  const supaKey    = process.env.SUPABASE_SERVICE_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY not set");
  if (!supaUrl || !supaKey)
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  return { openaiKey, supaUrl, supaKey };
}

// Embed a text string using OpenAI
async function embed(text, apiKey) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": "Bearer " + apiKey,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!res.ok) {
    const e = await res.json();
    throw new Error("Embedding failed: " + (e.error?.message || res.status));
  }
  const d = await res.json();
  return d.data[0].embedding; // float[] length 1536
}

// Vector similarity search via Supabase RPC
async function searchChunks(embedding, docType, supaUrl, supaKey) {
  const body = {
    query_embedding: embedding,
    match_count:     TOP_K,
    doc_type_filter: docType === "all" ? null : docType,
  };
  const res = await fetch(
    supaUrl + "/rest/v1/rpc/match_document_chunks",
    {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        supaKey,
        "Authorization": "Bearer " + supaKey,
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const e = await res.json();
    throw new Error("Vector search failed: " + JSON.stringify(e));
  }
  return res.json(); // array of matching chunk rows
}

// Build the GPT-4o prompt from retrieved chunks
function buildPrompt(question, chunks) {
  const context = chunks.map(function(c, i) {
    return [
      "--- Source " + (i+1) + " ---",
      "Document: " + c.doc_name,
      "Type: "     + c.doc_type.toUpperCase(),
      "Plan: "     + (c.plan_name || "N/A"),
      "Payor: "    + (c.parent_org || "N/A"),
      "Page: "     + (c.page_number || "?"),
      "Section: "  + (c.section || "General"),
      "",
      c.chunk_text,
    ].join("\n");
  }).join("\n\n");

  return [
    "You are an expert Medicare Advantage plan document analyst for HealthWorksAI.",
    "Answer the user's question using ONLY the document excerpts provided below.",
    "Rules:",
    "- Ground every claim in a specific source excerpt.",
    "- Always cite: document name, page number, and section.",
    "- If the answer is not in the excerpts, say so clearly.",
    "- Flag exclusions, limitations, waiting periods, and prior auth requirements.",
    "- Be concise and specific. Use bullet points for lists of terms.",
    "- Do not invent or extrapolate beyond what the documents say.",
    "",
    "DOCUMENT EXCERPTS:",
    context,
    "",
    "USER QUESTION: " + question,
  ].join("\n");
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function handleStats(supaUrl, supaKey) {
  const res = await fetch(
    supaUrl + "/rest/v1/document_chunks"
      + "?select=doc_type&limit=1000",
    {
      headers: {
        "apikey":        supaKey,
        "Authorization": "Bearer " + supaKey,
      },
    }
  );
  if (!res.ok) return { eoc:0, dental:0, total:0, ready:false };
  const rows = await res.json();

  // Count unique documents (not chunks)
  const eocDocs    = new Set();
  const dentalDocs = new Set();
  const allDocs    = new Set();

  // Need doc_name too — re-fetch with doc_name
  const res2 = await fetch(
    supaUrl + "/rest/v1/document_chunks"
      + "?select=doc_name,doc_type&limit=5000",
    {
      headers: {
        "apikey":        supaKey,
        "Authorization": "Bearer " + supaKey,
      },
    }
  );
  const chunks = res2.ok ? await res2.json() : [];
  chunks.forEach(function(c) {
    allDocs.add(c.doc_name);
    if (c.doc_type === "eoc")    eocDocs.add(c.doc_name);
    if (c.doc_type === "dental") dentalDocs.add(c.doc_name);
  });

  return {
    total:  allDocs.size,
    eoc:    eocDocs.size,
    dental: dentalDocs.size,
    ready:  allDocs.size > 0,
  };
}

async function handleQuery(question, docType, openaiKey, supaUrl, supaKey) {
  if (!question || question.trim().length < 3) {
    throw new Error("Question is too short");
  }

  // 1. Embed the question
  const questionEmbedding = await embed(question, openaiKey);

  // 2. Retrieve relevant chunks
  const chunks = await searchChunks(
    questionEmbedding, docType, supaUrl, supaKey
  );

  if (!chunks || chunks.length === 0) {
    return {
      answer: "No relevant document passages found for your question. "
        + "This may mean the documents have not been loaded yet, "
        + "or the topic is not covered in the available EOC/Dental files.",
      sources: [],
      doc_count: 0,
    };
  }

  // 3. Build prompt and call GPT-4o
  const systemPrompt = buildPrompt(question, chunks);
  const chatRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": "Bearer " + openaiKey,
    },
    body: JSON.stringify({
      model:      CHAT_MODEL,
      max_tokens: 1500,
      messages: [
        { role: "user", content: systemPrompt },
      ],
    }),
  });

  if (!chatRes.ok) {
    const e = await chatRes.json();
    throw new Error("GPT-4o error: " + (e.error?.message || chatRes.status));
  }

  const chatData = await chatRes.json();
  const answer   = chatData.choices[0].message.content.trim();

  // 4. Format sources for UI citation chips
  const sources = chunks.map(function(c) {
    return {
      doc_name:   c.doc_name,
      doc_type:   c.doc_type,
      plan_name:  c.plan_name  || null,
      parent_org: c.parent_org || null,
      page:       c.page_number,
      section:    c.section || "General",
      similarity: parseFloat((c.similarity * 100).toFixed(1)) + "%",
      chunk_text: c.chunk_text.length > MAX_CHUNK
        ? c.chunk_text.slice(0, MAX_CHUNK) + "..."
        : c.chunk_text,
    };
  });

  return { answer, sources, doc_count: chunks.length };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { action, question, doc_type = "all" } = req.body || {};
  if (!action) return res.status(400).json({ error: "action required" });

  try {
    const { openaiKey, supaUrl, supaKey } = getEnv();

    if (action === "stats") {
      const stats = await handleStats(supaUrl, supaKey);
      return res.status(200).json(stats);
    }

    if (action === "query") {
      if (!question)
        return res.status(400).json({ error: "question required" });
      const result = await handleQuery(
        question, doc_type, openaiKey, supaUrl, supaKey
      );
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: "unknown action: " + action });

  } catch (err) {
    console.error("[docs/" + action + "]", err.message);
    return res.status(500).json({ error: err.message });
  }
}
