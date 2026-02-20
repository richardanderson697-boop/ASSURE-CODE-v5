// ============================================================
// ASSURE CODE — Vector Store (Supabase + pgvector)
// Handles storage and retrieval of regulatory embeddings
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Regulation, RetrievedRegulation } from '../types';
import { embedQuery, buildRegulationEmbeddingText, embedDocuments } from './embeddings';

// Tune these for your precision/recall tradeoff
const DEFAULT_MATCH_THRESHOLD = 0.70; // Minimum cosine similarity
const DEFAULT_TOP_K = 15;             // Max regulations returned

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service role for server-side operations
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    _client = createClient(url, key);
  }
  return _client;
}

// ============================================================
// RETRIEVAL
// ============================================================

/**
 * Core RAG retrieval function.
 * Converts a query to an embedding and performs a filtered
 * similarity search against the regulations table.
 *
 * @param query        - The project idea or spec text to search against
 * @param frameworks   - e.g. ['GDPR', 'SOC2']
 * @param jurisdictions - e.g. ['EU', 'US']
 * @param topK         - Number of results to retrieve
 * @param threshold    - Minimum similarity score (0.0–1.0)
 */
export async function retrieveRegulations(
  query: string,
  frameworks: string[],
  jurisdictions: string[],
  topK: number = DEFAULT_TOP_K,
  threshold: number = DEFAULT_MATCH_THRESHOLD
): Promise<RetrievedRegulation[]> {
  const supabase = getClient();

  console.log(`[VectorStore] Retrieving regulations for frameworks=${frameworks} jurisdictions=${jurisdictions}`);

  // 1. Embed the query
  const queryEmbedding = await embedQuery(query);

  // 2. Call the match_regulations RPC defined in the SQL migration
  const { data, error } = await supabase.rpc('match_regulations', {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: topK,
    filter_frameworks: frameworks,
    filter_jurisdictions: jurisdictions,
  });

  if (error) {
    throw new Error(`[VectorStore] Retrieval failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    console.warn(`[VectorStore] No regulations found above threshold ${threshold}. Consider lowering it.`);
    return [];
  }

  console.log(`[VectorStore] Retrieved ${data.length} regulations.`);

  return data.map((row: any): RetrievedRegulation => ({
    id: row.id,
    framework: row.framework,
    article: row.article,
    title: row.title,
    content: row.content,
    jurisdiction: row.jurisdiction,
    severity: row.severity,
    tags: row.tags,
    similarity: row.similarity,
  }));
}

// ============================================================
// INGESTION (upsert)
// ============================================================

/**
 * Upsert a batch of regulations into Supabase.
 * Generates embeddings and stores the full record.
 * Called by the ingestion pipeline.
 */
export async function upsertRegulations(
  regulations: Omit<Regulation, 'id' | 'embedding' | 'createdAt' | 'updatedAt'>[]
): Promise<{ succeeded: number; failed: number; errors: string[] }> {
  const supabase = getClient();
  const errors: string[] = [];
  let succeeded = 0;

  // Build embedding text for each regulation
  const embeddingTexts = regulations.map(buildRegulationEmbeddingText);

  // Batch embed all regulations
  let embeddings: number[][];
  try {
    embeddings = await embedDocuments(embeddingTexts);
  } catch (err: any) {
    throw new Error(`[VectorStore] Embedding generation failed: ${err.message}`);
  }

  // Build upsert records
  const records = regulations.map((reg, i) => ({
    framework: reg.framework,
    article: reg.article,
    title: reg.title,
    content: reg.content,
    jurisdiction: reg.jurisdiction,
    severity: reg.severity,
    tags: reg.tags,
    embedding: embeddings[i],
    updated_at: new Date().toISOString(),
  }));

  // Upsert in chunks of 50 (Supabase row limit per request)
  const CHUNK_SIZE = 50;
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);

    const { error } = await supabase
      .from('regulations')
      .upsert(chunk, {
        onConflict: 'framework,article,jurisdiction', // Deduplicate by these fields
        ignoreDuplicates: false,                       // Update existing records
      });

    if (error) {
      const msg = `Chunk ${i / CHUNK_SIZE + 1}: ${error.message}`;
      errors.push(msg);
      console.error(`[VectorStore] Upsert error: ${msg}`);
    } else {
      succeeded += chunk.length;
      console.log(`[VectorStore] Upserted chunk ${i / CHUNK_SIZE + 1} (${chunk.length} records)`);
    }
  }

  return { succeeded, failed: errors.length, errors };
}

/**
 * Fetch all regulations for a given framework (for debugging/audit).
 */
export async function listRegulationsByFramework(
  framework: string,
  limit: number = 100
): Promise<Regulation[]> {
  const supabase = getClient();

  const { data, error } = await supabase
    .from('regulations')
    .select('id, framework, article, title, content, jurisdiction, severity, tags, created_at, updated_at')
    .eq('framework', framework)
    .limit(limit);

  if (error) throw new Error(`[VectorStore] List failed: ${error.message}`);
  return data ?? [];
}
