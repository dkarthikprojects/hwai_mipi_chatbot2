-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Run this in Supabase SQL Editor
-- Sets up the vector database for EOC & Dental Playground
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable vector extension (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop and recreate document_chunks cleanly
DROP TABLE IF EXISTS document_chunks;

CREATE TABLE document_chunks (
  id          BIGSERIAL PRIMARY KEY,
  doc_name    TEXT        NOT NULL,
  doc_type    TEXT        NOT NULL DEFAULT 'eoc',  -- 'eoc' or 'dental'
  page_number INTEGER,
  section     TEXT,
  chunk_index INTEGER,
  chunk_text  TEXT        NOT NULL,
  embedding   vector(1536),                        -- OpenAI text-embedding-3-small
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast vector similarity search
CREATE INDEX ON document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- Index for filtering by doc type
CREATE INDEX ON document_chunks (doc_type);
CREATE INDEX ON document_chunks (doc_name);

-- Disable RLS so the API can read/write
ALTER TABLE document_chunks DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Function: match_chunks
-- Called by api/docs.js to find relevant chunks for a user question
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1536),
  match_count     integer DEFAULT 5,
  filter_doc_type text    DEFAULT NULL
)
RETURNS TABLE (
  id          bigint,
  doc_name    text,
  doc_type    text,
  page_number integer,
  section     text,
  chunk_text  text,
  similarity  float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    doc_name,
    doc_type,
    page_number,
    section,
    chunk_text,
    1 - (embedding <=> query_embedding) AS similarity
  FROM document_chunks
  WHERE
    embedding IS NOT NULL
    AND (filter_doc_type IS NULL OR doc_type = filter_doc_type)
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Verify setup
SELECT 'Setup complete ✅' AS status,
       COUNT(*) AS chunks_in_table
FROM document_chunks;
