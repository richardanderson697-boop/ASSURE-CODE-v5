// ============================================================
// ASSURE CODE — Embeddings (OpenAI)
// Responsible for converting text into vector representations
// ============================================================

import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-small'; // 1536 dimensions, matches SQL schema
const MAX_BATCH_SIZE = 100; // OpenAI batch limit

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set in environment variables.');
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

/**
 * Generate a single embedding for a query string.
 * Used at query time (not ingestion).
 */
export async function embedQuery(text: string): Promise<number[]> {
  const client = getClient();

  // Sanitize: strip newlines which can degrade embedding quality
  const sanitized = text.replace(/\n+/g, ' ').trim();

  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: sanitized,
  });

  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple documents in batches.
 * Used during regulation ingestion.
 *
 * @param texts - Array of strings to embed
 * @returns Array of embeddings in the same order as input
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const client = getClient();
  const results: number[][] = [];

  // Process in batches to respect API limits
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE).map(t =>
      t.replace(/\n+/g, ' ').trim()
    );

    console.log(`[Embeddings] Processing batch ${Math.floor(i / MAX_BATCH_SIZE) + 1} / ${Math.ceil(texts.length / MAX_BATCH_SIZE)}`);

    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });

    // OpenAI returns embeddings in the same order as input
    const batchEmbeddings = response.data
      .sort((a, b) => a.index - b.index)
      .map(item => item.embedding);

    results.push(...batchEmbeddings);

    // Respect rate limits between batches
    if (i + MAX_BATCH_SIZE < texts.length) {
      await sleep(200);
    }
  }

  return results;
}

/**
 * Build a rich text representation of a regulation for embedding.
 * Combining multiple fields improves retrieval relevance.
 */
export function buildRegulationEmbeddingText(regulation: {
  framework: string;
  article: string;
  title: string;
  content: string;
  tags: string[];
}): string {
  return [
    `Framework: ${regulation.framework}`,
    `Article: ${regulation.article}`,
    `Title: ${regulation.title}`,
    `Tags: ${regulation.tags.join(', ')}`,
    `Content: ${regulation.content}`,
  ].join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
