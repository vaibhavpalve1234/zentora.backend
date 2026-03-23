# 💰 Money Control Pro — Production Backend

> **AI-powered personal finance OS** — Node.js + MySQL + Gemini 2.5 Flash + ChromaDB

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Mobile/Web)                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS + JWT
┌──────────────────────────▼──────────────────────────────────────┐
│               EXPRESS API  (Port 3000)                           │
│  Helmet │ CORS │ Compression │ Morgan │ Rate Limiter             │
├──────────────────────────────────────────────────────────────────┤
│                      ROUTES  /api/v1                             │
│  /auth  /transactions  /investments  /loans  /budgets  /ai      │
├──────────────────────────────────────────────────────────────────┤
│              MIDDLEWARE CHAIN                                     │
│  requestId → authenticate (JWT) → validate (Joi) → controller   │
├──────────────────────────────────────────────────────────────────┤
│              CONTROLLERS  (thin, no business logic)              │
├────────────────┬─────────────────────────┬───────────────────────┤
│   SERVICES     │    AI INSIGHT SERVICE   │   AUTH SERVICE        │
│  Transaction   │  (Orchestration Layer)  │  bcrypt + JWT rotate  │
│  Investment    │                         │                        │
│  Loan          │  1. Load data (repos)   │                        │
│  Budget        │  2. RAG (ChromaDB)      │                        │
│                │  3. Build context       │                        │
│                │  4. Prompt (factory)    │                        │
│                │  5. Gemini 2.5 Flash    │                        │
│                │  6. Parse JSON          │                        │
│                │  7. Persist insight     │                        │
│                │  8. Embed → ChromaDB    │                        │
├────────────────┴─────────────────────────┴───────────────────────┤
│                    REPOSITORY LAYER                               │
│   BaseRepository → Transaction / Investment / Loan / Budget      │
├──────────┬──────────────────┬────────────────────────────────────┤
│  MySQL 8 │  Redis 7 (cache) │  ChromaDB (vector embeddings)      │
│  (source │  analytics cache │  Gemini text-embedding-004 (768d)  │
│  of truth│  insight cache   │  RAG retrieval for AI context      │
└──────────┴──────────────────┴────────────────────────────────────┘
```

---

## SOLID Principles Applied

| Principle | Implementation |
|-----------|---------------|
| **S**ingle Responsibility | Controllers extract params only; Services contain business logic only; Repositories do data access only |
| **O**pen/Closed | BaseRepository is closed for modification — extend by subclassing. Add new AI providers without touching InsightService |
| **L**iskov Substitution | All repositories substitute BaseRepository. GeminiProvider can be swapped with OllamaProvider |
| **I**nterface Segregation | ILLMProvider defines only `generate()` and `embed()` — no fat interface |
| **D**ependency Inversion | InsightService depends on ILLMProvider abstraction, not GeminiProvider directly; AIProviderFactory returns the configured provider |

---

## Design Patterns Used

| Pattern | Where |
|---------|-------|
| **Repository** | BaseRepository + domain repositories |
| **Strategy** | AIProviderFactory — swap LLM providers at config time |
| **Factory Method** | PromptFactory — each insight type has its factory method |
| **Builder** | ContextBuilder — fluent API for assembling AI context |
| **Facade** | EmbeddingService — hides embed + ChromaDB complexity |
| **Template Method** | InsightService._generate() — fixed pipeline, steps customised by sub-call |
| **Singleton** | All services and repositories are module-level singletons |
| **Cache-aside** | Redis.getOrSet() — check cache → miss → fetch → populate |

---

## AI Pipeline (Deep Dive)

```
User requests insight
       │
       ▼
InsightService._generate()
       │
       ├─ 1. Parallel MySQL fetch (Promise.all):
       │       users, transactions, investments, loans, budgets
       │
       ├─ 2. ChromaDB RAG query:
       │       "monthly_summary financial analysis"
       │       → Gemini embeds query (768 dims)
       │       → ChromaDB cosine similarity search
       │       → top-5 historical financial documents
       │
       ├─ 3. ContextBuilder (Builder Pattern):
       │       .withUserProfile()
       │       .withMonthlySummary()
       │       .withSavingsMetrics()
       │       .withCategoryBreakdown()
       │       .withRecentTransactions()
       │       .withPortfolio()
       │       .withLoans()
       │       .withBudgets()
       │       .withRAGContext(ragDocs)   ◄─── enriched with history
       │       .build() → { context, hash }
       │
       ├─ 4. Dedup check (SHA-256 of context):
       │       Redis cache → MySQL ai_insights table
       │       If same context hash exists → return cached insight
       │
       ├─ 5. PromptFactory.monthlySummary(context, year, month):
       │       { systemPrompt, userPrompt }
       │       systemPrompt = FINANCIAL_ADVISOR persona (static)
       │       userPrompt   = structured context + JSON schema to return
       │
       ├─ 6. GeminiProvider.generate():
       │       model: gemini-2.5-flash
       │       temperature: 0.2 (deterministic for finance)
       │       jsonMode: true (responseMimeType: application/json)
       │
       ├─ 7. JSON parse + validate → AppError on parse failure
       │
       ├─ 8. Persist to ai_insights table (MySQL)
       │
       ├─ 9. Background: embed insight → ChromaDB
       │       (future RAG will retrieve this insight as context)
       │
       └─ 10. Cache in Redis (30 min TTL)
              Return to controller
```

---

## API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Register new user |
| POST | `/api/v1/auth/login` | Login (returns JWT + sets HttpOnly cookie) |
| POST | `/api/v1/auth/refresh` | Rotate refresh token |
| POST | `/api/v1/auth/logout` | Revoke refresh token |

### Transactions
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/transactions` | Create transaction |
| GET | `/api/v1/transactions` | List with filters |
| GET | `/api/v1/transactions/analytics` | Monthly analytics |
| GET | `/api/v1/transactions/:id` | Get by ID |
| PATCH | `/api/v1/transactions/:id` | Update |
| DELETE | `/api/v1/transactions/:id` | Delete |

### Investments
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/investments` | Create investment |
| GET | `/api/v1/investments` | List all |
| GET | `/api/v1/investments/portfolio` | Portfolio summary + P&L |
| PATCH | `/api/v1/investments/:id` | Update (price/value) |
| DELETE | `/api/v1/investments/:id` | Delete |

### Loans
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/loans` | Create loan (borrowed/lent) |
| GET | `/api/v1/loans` | List all loans |
| GET | `/api/v1/loans/dashboard` | Summary + overdue + due soon |
| POST | `/api/v1/loans/:id/payments` | Record payment + reduce outstanding |

### Budgets
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/budgets` | Create budget |
| GET | `/api/v1/budgets` | List with utilization % |
| PATCH | `/api/v1/budgets/:id` | Update |
| DELETE | `/api/v1/budgets/:id` | Delete |

### AI Insights (rate limited: 20 req/15 min)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/ai/summary?year=&month=` | Monthly AI summary |
| GET | `/api/v1/ai/anomalies` | Spending anomaly detection |
| GET | `/api/v1/ai/investments` | Investment advice |
| GET | `/api/v1/ai/savings` | Savings optimisation tips |
| GET | `/api/v1/ai/loans` | Debt management advice |
| POST | `/api/v1/ai/ask` | Custom question (body: `{question}`) |
| GET | `/api/v1/ai/history` | Past insights |

---

## Sample API Calls

### Register
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"SecurePass123!","full_name":"Rahul Sharma"}'
```

### Add Expense
```bash
curl -X POST http://localhost:3000/api/v1/transactions \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "expense",
    "amount": 1500,
    "category_id": null,
    "description": "Swiggy lunch",
    "transaction_date": "2025-01-15",
    "payment_method": "upi"
  }'
```

### Get AI Monthly Summary
```bash
curl "http://localhost:3000/api/v1/ai/summary?year=2025&month=1" \
  -H "Authorization: Bearer <access_token>"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "title": "Monthly Summary — January 2025",
    "overall_health": "fair",
    "health_score": 62,
    "key_metrics": {
      "income": 85000,
      "expenses": 67000,
      "savings": 18000,
      "savings_rate": 21.18
    },
    "highlights": [
      "Savings rate of 21% exceeds the healthy 20% benchmark — great discipline!",
      "Investment portfolio grew 3.2% this month"
    ],
    "concerns": [
      "Food & Dining spend (₹12,400) is 18.5% of income — above the recommended 15%"
    ],
    "recommendations": [
      {
        "priority": "high",
        "action": "Reduce food delivery apps — cook at home 3 days/week",
        "expected_impact": "Save ₹3,000-4,000/month in Food & Dining"
      }
    ],
    "investment_insight": "SIP contributions are consistent — consider increasing by ₹2,000/month",
    "next_month_goal": "Keep Food & Dining under ₹10,000 and achieve 25% savings rate"
  }
}
```

### Ask Custom Question
```bash
curl -X POST http://localhost:3000/api/v1/ai/ask \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"question": "Am I spending too much on entertainment compared to last month?"}'
```

---

## Setup Guide

### Prerequisites
- Node.js 18+
- Docker + Docker Compose
- Gemini API key (Google AI Studio)

### 1. Clone & Install
```bash
git clone https://github.com/yourorg/money-control-pro
cd money-control-pro
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env — set GEMINI_API_KEY, JWT secrets (use: openssl rand -hex 32)
```

### 3. Start Infrastructure
```bash
docker-compose up mysql redis chromadb -d
```

### 4. Run Migrations
```bash
npm run db:migrate
```

### 5. Start API
```bash
npm run dev    # development
npm start      # production
```

### 6. Full Docker Stack
```bash
docker-compose up -d
```

---

## Security Checklist

- [x] Passwords hashed with bcrypt (12 rounds)
- [x] JWT access tokens: 15 min expiry, in-memory client storage
- [x] Refresh tokens: 7-day expiry, HttpOnly cookie, DB-stored (hashed), rotation on each use
- [x] SQL injection: parameterised queries everywhere, column whitelisting in BaseRepository
- [x] Input validation: Joi schemas, `stripUnknown: true`
- [x] Rate limiting: 100 req/15min global, 20 req/15min for AI endpoints
- [x] Sensitive fields scrubbed from logs (passwords, tokens, API keys)
- [x] Helmet security headers (CSP, HSTS, X-Frame-Options, etc.)
- [x] CORS with explicit origin whitelist
- [x] Non-root Docker user
- [x] Error messages don't leak internals in production

---

## Scalability Path

```
Current (small project):
  Single Node process → MySQL + Redis + ChromaDB

Phase 2 (growing traffic):
  PM2 cluster mode (multi-core) → Read replicas for analytics queries

Phase 3 (scale-out):
  Horizontal scaling → Load balancer → Stateless API nodes
  BullMQ job queue for AI insight generation (async)
  MySQL → AWS RDS Aurora (auto-scaling)
  Redis → AWS ElastiCache cluster
  ChromaDB → Qdrant Cloud / Pinecone

Phase 4 (microservices):
  Split by domain:
    finance-api (transactions/budgets)
    investment-api
    ai-insight-service (heavy Gemini calls)
    auth-service
  Inter-service: gRPC or NATS
```

---

## Project Structure

```
money-control-pro/
├── server.js                      # Entry point + graceful shutdown
├── src/
│   ├── app.js                     # Express app factory
│   ├── config/
│   │   ├── database.js            # MySQL pool + query/transaction helpers
│   │   ├── redis.js               # Redis client + cache-aside helpers
│   │   └── logger.js              # Winston structured logging
│   ├── repositories/
│   │   ├── base.repository.js     # Generic CRUD (Repository Pattern)
│   │   ├── transaction.repository.js
│   │   └── index.js               # All other repositories
│   ├── services/
│   │   ├── auth.service.js        # JWT + bcrypt + refresh rotation
│   │   └── index.js               # Transaction/Investment/Loan/Budget
│   ├── ai/
│   │   ├── providers/
│   │   │   └── gemini.provider.js # Strategy Pattern (ILLMProvider)
│   │   ├── prompts/
│   │   │   └── prompt.system.js   # SystemPrompts + ContextBuilder + PromptFactory
│   │   ├── vector/
│   │   │   ├── vector.store.js    # ChromaDB client
│   │   │   └── embedding.service.js # RAG pipeline (embed + retrieve)
│   │   └── insight.service.js     # AI orchestration (10-step pipeline)
│   ├── controllers/index.js       # Thin controllers (all domains)
│   ├── routes/index.js            # Express router
│   ├── middleware/index.js        # requestId, authenticate, errorHandler
│   ├── validators/schemas.js      # Joi validation schemas
│   └── utils/
│       ├── app.error.js           # AppError class
│       └── respond.js             # Consistent response helpers
├── database/
│   ├── schema.sql                 # Full MySQL schema (11 tables)
│   └── migrate.js                 # Migration runner
├── docker-compose.yml             # MySQL + Redis + ChromaDB + API
├── Dockerfile                     # Multi-stage production image
└── .env.example                   # Environment template
```
