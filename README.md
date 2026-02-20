# Assure Code — Monorepo

**Automated Regulatory Compliance Platform**

This monorepo contains the complete source code for the Assure Code platform, an AI-powered compliance engine that uses RAG, Generative AI, and adversarial scanning to generate and maintain regulatory-compliant technical specifications.

## Repository Structure

### `apps/`

- **`api-gateway`** (`apps/api-gateway`)
  - NestJS backend handling Authentication, Workspaces, Billing, and Job Orchestration.
  - Connects to Supabase, Redis (BullMQ), and Stripe.

- **`dashboard`** (`apps/dashboard`)
  - Next.js 14 application providing the user interface.
  - Features: Mission Control, Spec Viewer, Workspace Management.

- **`orchestrator`** (`apps/orchestrator`)
  - Event-driven service (Node.js) listening to Kafka topics.
  - Handles Regulation Ingestion events and automated GitHub PR creation.

### `packages/`

- **`compliance-engine`** (`packages/compliance-engine`)
  - The core domain logic library.
  - Contains: RAG pipeline (OpenAI Embeddings), Vector Store (pgvector), Draft Engine (Gemini), Scanner (OpenAI), and Arbitration (Claude).

### `infrastructure/`

- **`db/migrations`**
  - SQL files for Supabase/Postgres schema setup.

## Getting Started

1. **Environment Setup**
   - Copy `.env.example` in each app to `.env`.
   - Ensure Docker is running.

2. **Database**
   - Apply migrations from `infrastructure/db/migrations` to your Supabase instance.

3. **Run via Docker**
   ```bash
   docker-compose up --build
   ```

4. **Access**
   - Dashboard: `http://localhost:3000`
   - API Gateway: `http://localhost:4000`
