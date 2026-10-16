# AGENTS.md: rules for every agent working in this repo

## Design freeze (highest priority)
- The UI exported from AI Studio is the approved design. It is the single source of truth for layout, components, colors, typography, icons, spacing, motion and 3D scenes.
- Never modify: src/index.css, index.html (fonts and meta), src/components/ui/**, src/components/Navigation.tsx, src/components/LandingPage.tsx, src/components/Hero3DScene.tsx, src/components/RedGlassPanel.tsx, src/components/academy/MachineScene.tsx, src/components/calculator/Calculator3DView.tsx.
- In all other components you may change: data sources, event handlers, API calls, state logic, and visible text that is factually wrong. You may NOT change, remove or reorder any existing className string, JSX structure, icon name, or animation.
- New UI is allowed only where a task names an exact "UI slot". Build it only from components in src/components/ui/ and by copying className strings from the nearest existing sibling element on the same screen. No new colors, no hex values, no new fonts, no new icon sets, no new UI libraries.
- Never add or switch libraries for UI (no shadcn, MUI, Chakra, lucide replacement of Material Symbols, Tailwind version change).
- After any change to a .tsx file, run `npm run guard:design`. If it fails, undo the change.

## Honesty rules (no fabrication)
- Never hard-code or generate fake data in the UI or API: no invented documents, manual quotes, page numbers, citations, statistics, machine status, telemetry, operator names, latency numbers, or Math.random() values presented as results.
- Citations shown to users come only from Gemini File Search grounding metadata. If retrieval returns nothing, the answer starts with "Not found in your uploaded manuals." Never invent a page number; if the API gives no page, show the document name only.
- When an AI call fails, show an honest error in the user's language with a Retry button. Never return pre-written answers.
- Empty data shows the existing EmptyState component.

## Security rules
- GEMINI_API_KEY and all secrets exist only on the server, read from environment variables. Never in client code, never committed, never logged.
- Every /api route except GET /api/health uses requireAuth. Every route that calls Gemini also uses rateLimitAI. Admin routes also use requireAdmin.
- The server re-computes anything that grants XP, badges, roles or quotas. Never trust values sent by the browser for these.
- No empty catch blocks. Every catch logs one structured line with the route and error message (never user content).
- Uploaded files: validate type and size on the server. Store files in Cloud Storage, never as base64 inside Firestore.

## Engineering rules
- Do not upgrade, downgrade or add dependencies unless the task says so. Never run npm audit fix --force.
- Keep the Firestore named database ID and the Firebase project cnc-copilot-abc26 unchanged.
- Gemini model IDs live only in server/config.ts. Verify any model ID with the list-models check (scripts/check-models.mjs) before using it.
- Before writing code against @google/genai features (File Search, function calling, TTS), read the type definitions in node_modules/@google/genai and the official docs at ai.google.dev. Do not guess method names or response fields.
- One task per commit. Commit message format: "<area>: <what changed>". Run npm run lint and npm test before every commit.
- Write in English. No em dash characters in code comments, UI text or docs.
