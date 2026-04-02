# PharmaMES.AI

**Pharmaceutical Manufacturing Execution System** — AI-powered, 21 CFR Part 11 compliant

[![Live API](https://img.shields.io/badge/API-Live-green)](https://pharma-mbr-api.vercel.app/api/health)
[![Live Client](https://img.shields.io/badge/Client-Live-blue)](https://pharma-mbr-client.vercel.app)

## Overview

PharmaMES.AI is a full-stack Manufacturing Execution System (MES) for pharmaceutical manufacturing. It manages the complete lifecycle of Master Batch Records (MBRs), Electronic Batch Records (EBRs), deviations, CAPAs, equipment, training, and change control — all compliant with FDA 21 CFR Part 11 and GAMP5 Category 5 requirements.

The system features an AI Co-Designer that can parse legacy MBR PDFs and decompose them into ISA-88 compliant recipe structures using LLM technology.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Lucide Icons |
| Backend | Node.js, Express.js |
| Database | PostgreSQL (Neon serverless) |
| AI/LLM | Groq API (Llama 3.3 70B) |
| Auth | JWT, bcrypt, 21 CFR Part 11 e-signatures |
| Security | Helmet, express-rate-limit, express-validator, CORS |
| Deployment | Vercel (serverless API + static frontend) |
| VCS | Git, GitHub |

## Compliance Standards

- **21 CFR Part 11** — Electronic records, electronic signatures, audit trail
- **GAMP5 Category 5** — Custom application with full validation lifecycle
- **ISA-88 (S88)** — Recipe hierarchy: Procedure → Unit Procedure → Operation
- **ISA-95** — Integration platform for enterprise connectivity
- **ICH Q10** — Pharmaceutical Quality System
- **ICH Q9** — Quality Risk Management (FMEA)

## Features

### Manufacturing
- **MBR Designer** — ISA-88 recipe hierarchy editor with phases, steps, parameters, BOM, IPC checks
- **AI Co-Designer** — Upload legacy MBR PDF → AI decomposes into structured proposals → human review → apply
- **Batch Scaling** — Change batch size → all BOM quantities auto-recalculate
- **PDF Export** — Generate print-ready MBR documents for shop floor use
- **EBR Execution** — Electronic batch record execution engine

### Quality
- **Deviations & CAPA** — Full deviation lifecycle with CAPA linkage
- **Change Control** — Change request lifecycle with approval chains
- **Training** — Curriculum management, training records, compliance gating

### Compliance
- **Electronic Signatures** — 21 CFR Part 11 §11.200 with password re-verification
- **Approval Workflow** — Author → Reviewer → Approver → QA Approver chain
- **Version History** — Every change tracked with snapshots and change reasons
- **Audit Trail** — Immutable, SHA-256 integrity-checked, ALCOA+ compliant
- **Role-Based Access** — Admin, Designer, QA Reviewer, Production Operator, Viewer

### Equipment & Integration
- **Equipment Registry** — Master list with qualification status
- **Equipment QM** — Qualification and maintenance tracking
- **Integration Platform** — ISA-95 connector management

## Project Structure

```
pharma-mbr/
├── client/                    # React frontend (Vite)
│   ├── src/
│   │   ├── App.jsx           # Main app with routing, sidebar, all views
│   │   ├── components/
│   │   │   └── MBRDesigner/  # MBR Designer components
│   │   │       ├── MBRDesigner.jsx         # Main designer (ISA-88)
│   │   │       ├── CoDesignerPanel.jsx     # AI Co-Designer
│   │   │       ├── ApprovalWorkflowBar.jsx # Signature chain UI
│   │   │       ├── VersionHistoryPanel.jsx # Version timeline
│   │   │       └── OperationFormulaPanel.jsx
│   │   └── services/
│   │       └── apiService.js  # API client
│   └── vercel.json
├── server/                    # Express API (serverless)
│   ├── api/index.js          # Vercel entry point
│   ├── app.js                # Express app config
│   ├── index.js              # Local dev server
│   ├── db/
│   │   ├── pool.js           # DB connection + 7 migrations
│   │   ├── seed-all.js       # Comprehensive seeder
│   │   └── block-carlos.js   # User suspension demo
│   ├── middleware/
│   │   └── middleware.js      # Auth, audit, JWT, RBAC
│   ├── routes/               # API routes
│   │   ├── authRoutes.js
│   │   ├── mbrRoutes.js
│   │   ├── coDesignerRoutes.js
│   │   ├── ebrRoutes.js
│   │   ├── equipmentRoutes.js
│   │   ├── devcapaRoutes.js
│   │   ├── trainingRoutes.js
│   │   └── ...
│   ├── services/             # Business logic
│   │   ├── coDesignerAgent.js # AI pipeline
│   │   ├── stateMachine.js    # MBR lifecycle
│   │   └── ...
│   └── vercel.json
└── README.md
```

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL (or Neon account)
- Groq API key (for AI features)

### Local Development

```bash
# Clone
git clone https://github.com/JaisukhBK/pharma-mbr.git
cd pharma-mbr

# Server setup
cd server
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT_SECRET, GROQ_API_KEY
npm install
npm install pdf-parse@1.1.1
node db/seed-all.js    # Seed demo data
node index.js          # Starts on http://localhost:3004

# Client setup (new terminal)
cd client
npm install
npm run dev            # Starts on http://localhost:5176
```

### Environment Variables

| Variable | Description |
|----------|------------|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `JWT_SECRET` | 64+ char random string for JWT signing |
| `GROQ_API_KEY` | Groq API key for AI Co-Designer |
| `NODE_ENV` | `development` or `production` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |
| `VITE_API_URL` | API base URL (client-side) |

### Demo Accounts

All accounts use password: `pharma123`

| Role | Email |
|------|-------|
| System Administrator | jaisukh.patel@pharmambr.com |
| QA Reviewer | priya.singh@pharmambr.com |
| Production Operator | raj.kumar@pharmambr.com |
| Supervisor (Suspended) | carlos.martinez@pharmambr.com |
| Systems Engineer | wei.chen@pharmambr.com |

## Deployment

### Vercel (Production)

**API:** https://pharma-mbr-api.vercel.app
**Client:** https://pharma-mbr-client.vercel.app

```bash
# Deploy API
cd pharma-mbr
vercel --prod

# Deploy Client
cd client
vercel --prod
```

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/login` | Login |
| GET | `/api/mbr` | List MBRs |
| GET | `/api/mbr/:id` | Get MBR with full hierarchy |
| POST | `/api/mbr` | Create MBR |
| POST | `/api/mbr/:id/sign` | E-signature (Part 11) |
| POST | `/api/mbr/:id/new-version` | Create new version |
| GET | `/api/mbr/:id/versions` | Version history |
| POST | `/api/co-designer/:id/upload` | Upload MBR PDF for AI |
| GET | `/api/equipment` | List equipment |
| GET | `/api/devcapa/deviations` | List deviations |
| GET | `/api/training/matrix` | Training matrix |

## License

Proprietary — Jaisukh Patel / Northeastern University MSBA

## Author

**Jaisukh (Vihaan) Patel**
Master of Science in Business Analytics, Northeastern University
