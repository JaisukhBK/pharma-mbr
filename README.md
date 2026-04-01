# Pharma-MBR

ISA-88 / ISA-95 compliant Master Batch Record Designer with AI Co-Designer Agent, backed by Neon PostgreSQL and deployable on Kubernetes.

## Quick Start

### 1. Server setup

```bash
cd server
cp .env.example .env
# Edit .env — paste your Neon PostgreSQL connection string from console.neon.tech
npm install
npm run dev
```

The server auto-creates all 16 tables and seeds Metformin HCl 500mg demo data on first run.

### 2. Client setup

```bash
cd client
npm install
npm run dev
```

Open http://localhost:5174 — login with any demo account.

### Demo Accounts (password: `pharma123`)

| Email | Role |
|---|---|
| jaisukh.patel@pharmambr.com | Admin |
| priya.singh@pharmambr.com | QA Reviewer |
| wei.chen@pharmambr.com | Designer |
| raj.kumar@pharmambr.com | Production Operator |

---

## Architecture

```
Client (React 18 + Vite)                Server (Express + Neon PostgreSQL)
┌────────────────────────┐              ┌──────────────────────────────┐
│ App.jsx                │              │ /api/auth    → authRoutes    │
│  ├─ Login Screen       │   REST API   │ /api/mbr     → mbrRoutes     │
│  ├─ MBR List Screen    │ ──────────── │ /api/co-designer → cdRoutes  │
│  └─ MBR Designer       │              │ /api/audit   → global audit  │
│     ├─ CoDesignerPanel │              │ /health      → status        │
│     └─ (uploaded JSX)  │              └────────┬─────────────────────┘
└────────────────────────┘                       │
                                         Neon PostgreSQL (16 tables)
```

## Compliance Coverage

| Standard | Implementation |
|---|---|
| 21 CFR Part 11 §11.10(d) | JWT auth, 5-role RBAC, account lockout after 5 failed attempts |
| 21 CFR Part 11 §11.10(e) | Append-only audit_trail table, every mutation logged |
| 21 CFR Part 11 §11.50 | E-signatures with role + meaning + SHA-256 content hash |
| 21 CFR Part 11 §11.70 | Signature cryptographically bound to MBR state |
| 21 CFR Part 11 §11.200 | Password re-entry for e-signatures and Co-Design mode |
| GAMP5 Category 5 | Immutable container images, version-pinned deploys |
| ISA-88 (S88) | Procedure → Unit Procedure → Operation → Parameters |
| ISA-95 | Level 3 MES positioning, K8s namespace isolation |

## Database Schema (16 tables)

users, mbrs, mbr_versions, mbr_phases, mbr_steps, mbr_step_parameters, mbr_step_materials, mbr_step_equipment, mbr_ipc_checks, mbr_bom_items, mbr_signatures, audit_trail, co_designer_sessions, co_designer_proposals, ebrs, ebr_step_executions

## Co-Designer Modes

| Mode | Behavior | Auth Required |
|---|---|---|
| Off | Pure manual design | None |
| Assist | AI suggests, flags issues | Toggle permission |
| Co-Design | AI proposes full MBR from PDF | Password (Part 11 §11.200) |

Every AI proposal goes through: `pending → review → accept/modify/reject`, flagged `ai_generated: true` in audit trail.

## Kubernetes

The `k8s/pharma-mbr.yaml` manifest creates:
- `mbr-core` namespace — server pods with HPA (2-8 replicas)
- `co-designer` namespace — isolated AI agent (NetworkPolicy restricts to mbr-core API only)
- Ingress with TLS and rate limiting

Deploy: `kubectl apply -f k8s/pharma-mbr.yaml`

## Project Structure

```
pharma-mbr/
├── server/
│   ├── db/          pool.js, schema.sql, seed.sql
│   ├── middleware/   auth.js, auditTrail.js
│   ├── routes/       authRoutes.js, mbrRoutes.js, coDesignerRoutes.js
│   ├── index.js
│   ├── Dockerfile
│   └── package.json
├── client/
│   └── src/
│       ├── services/    authService.js, mbrService.js, coDesignerService.js
│       ├── components/
│       │   └── MBRDesigner/
│       │       ├── MBRDesigner.jsx      (uploaded 1237-line component)
│       │       ├── CoDesignerPanel.jsx  (Co-Designer 3-mode switch)
│       │       └── mbrDemoData.js       (Metformin seed for standalone use)
│       ├── App.jsx     (Login + MBR List + Designer wrapper)
│       └── main.jsx
├── k8s/             pharma-mbr.yaml
└── docker-compose.yml
```
