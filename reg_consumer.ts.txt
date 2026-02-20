// ============================================================
// ASSURE CODE — Regulation Event Consumer
// Listens on Kafka for "regulation.new" events published by
// the scraper service. Fans out to per-spec patch jobs via
// BullMQ after determining which workspaces are affected.
// ============================================================

import { createConsumer, publishEvent, TOPICS } from './kafka.client';
import { RegulationNewEvent, SpecUpdatedEvent } from '../types';
import { findAffectedSpecs } from '../scanner/impactAnalyzer';
import { enqueueSpecPatchJob } from '../queue/specPatchQueue';
import { v4 as uuidv4 } from 'uuid';

const CONSUMER_GROUP = 'assure-regulation-impact-group';

/**
 * Start the regulation event consumer.
 * Called once at application startup.
 */
export async function startRegulationConsumer(): Promise<void> {
  console.log('[RegulationConsumer] Starting...');

  await createConsumer(
    CONSUMER_GROUP,
    [TOPICS.REGULATION_NEW, TOPICS.REGULATION_UPDATED],
    {
      [TOPICS.REGULATION_NEW]: handleRegulationNew,
      [TOPICS.REGULATION_UPDATED]: handleRegulationNew, // Same logic for updates
    },
  );

  console.log('[RegulationConsumer] Ready — listening for new regulations.');
}

// ── Handler ────────────────────────────────────────────────────

async function handleRegulationNew(event: RegulationNewEvent): Promise<void> {
  const { regulation } = event;

  console.log(
    `[RegulationConsumer] Received: ${regulation.framework} ${regulation.article} ` +
    `(jurisdiction: ${regulation.jurisdiction}, severity: ${regulation.severity})`,
  );

  // 1. Find all active specs in workspaces that use this framework + jurisdiction
  const affectedSpecs = await findAffectedSpecs(
    regulation.framework,
    regulation.jurisdiction,
  );

  if (affectedSpecs.length === 0) {
    console.log(
      `[RegulationConsumer] No active specs found for ${regulation.framework} / ${regulation.jurisdiction}. Skipping.`,
    );
    return;
  }

  console.log(
    `[RegulationConsumer] ${affectedSpecs.length} specs affected. Enqueuing patch jobs...`,
  );

  // 2. Enqueue a BullMQ patch job for each affected spec
  //    Each job runs independently — one spec failure doesn't block others
  const jobPromises = affectedSpecs.map(async (spec) => {
    const jobId = uuidv4();

    await enqueueSpecPatchJob({
      jobId,
      specVersionId: spec.specId,
      workspaceId: spec.workspaceId,
      regulation: {
        id: regulation.id,
        framework: regulation.framework,
        article: regulation.article,
        title: regulation.title,
        content: regulation.content,
        jurisdiction: regulation.jurisdiction,
        severity: regulation.severity as any,
      },
    });

    console.log(
      `[RegulationConsumer] Enqueued patch job ${jobId} for spec ${spec.specId} (workspace: ${spec.workspaceId})`,
    );
  });

  await Promise.allSettled(jobPromises);

  console.log(
    `[RegulationConsumer] All patch jobs enqueued for ${regulation.framework} ${regulation.article}.`,
  );
}
