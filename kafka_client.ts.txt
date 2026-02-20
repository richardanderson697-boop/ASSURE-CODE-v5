// ============================================================
// ASSURE CODE — Kafka Event Bus
// Bidirectional event backbone for the entire ecosystem.
// Topics:
//   regulation.new       → scraped regulation arrives
//   regulation.updated   → existing regulation amended
//   spec.created         → new spec created by user
//   spec.updated         → spec auto-patched by regulation update
//   spec.pr_requested    → GitHub PR creation requested
//   spec.pr_created      → GitHub PR successfully opened
// ============================================================

import { Kafka, Producer, Consumer, EachMessagePayload, logLevel } from 'kafkajs';

// ── Topic Registry ────────────────────────────────────────────
export const TOPICS = {
  REGULATION_NEW: 'regulation.new',
  REGULATION_UPDATED: 'regulation.updated',
  SPEC_CREATED: 'spec.created',
  SPEC_UPDATED: 'spec.updated',
  SPEC_PR_REQUESTED: 'spec.pr_requested',
  SPEC_PR_CREATED: 'spec.pr_created',
} as const;

export type KafkaTopic = typeof TOPICS[keyof typeof TOPICS];

// ── Client Factory ─────────────────────────────────────────────
function createKafkaClient(): Kafka {
  const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');

  return new Kafka({
    clientId: 'assure-code-api-gateway',
    brokers,
    logLevel: process.env.NODE_ENV === 'production' ? logLevel.WARN : logLevel.INFO,
    retry: {
      initialRetryTime: 300,
      retries: 10,
    },
    ...(process.env.KAFKA_SASL_USERNAME && {
      ssl: true,
      sasl: {
        mechanism: 'plain',
        username: process.env.KAFKA_SASL_USERNAME,
        password: process.env.KAFKA_SASL_PASSWORD!,
      },
    }),
  });
}

// ── Singleton Instances ────────────────────────────────────────
let _kafka: Kafka | null = null;
let _producer: Producer | null = null;
const _consumers: Map<string, Consumer> = new Map();

function getKafka(): Kafka {
  if (!_kafka) _kafka = createKafkaClient();
  return _kafka;
}

// ── Producer ──────────────────────────────────────────────────

export async function getProducer(): Promise<Producer> {
  if (!_producer) {
    _producer = getKafka().producer({
      idempotent: true, // Exactly-once delivery
      transactionTimeout: 30000,
    });
    await _producer.connect();
    console.log('[Kafka] Producer connected.');
  }
  return _producer;
}

/**
 * Publish an event to a Kafka topic.
 * All events are JSON serialized with standard envelope.
 */
export async function publishEvent<T extends object>(
  topic: KafkaTopic,
  payload: T,
  key?: string,
): Promise<void> {
  const producer = await getProducer();

  const envelope = {
    ...payload,
    _meta: {
      topic,
      publishedAt: new Date().toISOString(),
      source: 'assure-code-api-gateway',
    },
  };

  await producer.send({
    topic,
    messages: [
      {
        key: key ?? null,
        value: JSON.stringify(envelope),
        headers: { 'content-type': 'application/json' },
      },
    ],
  });

  console.log(`[Kafka] Published to ${topic}${key ? ` (key: ${key})` : ''}`);
}

// ── Consumer ───────────────────────────────────────────────────

export type MessageHandler<T = any> = (
  payload: T,
  rawMessage: EachMessagePayload,
) => Promise<void>;

/**
 * Create and start a Kafka consumer for a set of topics.
 * Each consumer group gets its own independent offset tracking.
 */
export async function createConsumer(
  groupId: string,
  topics: KafkaTopic[],
  handlers: Partial<Record<KafkaTopic, MessageHandler>>,
): Promise<Consumer> {
  if (_consumers.has(groupId)) {
    console.warn(`[Kafka] Consumer group ${groupId} already registered.`);
    return _consumers.get(groupId)!;
  }

  const consumer = getKafka().consumer({
    groupId,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
  });

  await consumer.connect();
  await consumer.subscribe({ topics, fromBeginning: false });

  await consumer.run({
    autoCommit: true,
    eachMessage: async (messagePayload) => {
      const { topic, message } = messagePayload;

      if (!message.value) return;

      let parsed: any;
      try {
        parsed = JSON.parse(message.value.toString());
      } catch (err) {
        console.error(`[Kafka] Failed to parse message on ${topic}:`, err);
        return;
      }

      const handler = handlers[topic as KafkaTopic];
      if (!handler) {
        console.warn(`[Kafka] No handler registered for topic: ${topic}`);
        return;
      }

      try {
        await handler(parsed, messagePayload);
      } catch (err: any) {
        // Log but don't crash the consumer — dead letter handling TBD
        console.error(`[Kafka] Handler error on ${topic}: ${err.message}`);
      }
    },
  });

  _consumers.set(groupId, consumer);
  console.log(`[Kafka] Consumer group "${groupId}" subscribed to: ${topics.join(', ')}`);

  return consumer;
}

// ── Graceful Shutdown ──────────────────────────────────────────

export async function disconnectAll(): Promise<void> {
  if (_producer) {
    await _producer.disconnect();
    _producer = null;
  }
  for (const [groupId, consumer] of _consumers) {
    await consumer.disconnect();
    console.log(`[Kafka] Consumer ${groupId} disconnected.`);
  }
  _consumers.clear();
}

process.on('SIGTERM', disconnectAll);
process.on('SIGINT', disconnectAll);
