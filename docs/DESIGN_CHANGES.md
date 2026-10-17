# Design Changes: Shopfloor Agent Natural Replies and Multimodal

This document records the approved design exceptions and UI updates applied to the Shopfloor Agent and related shell components.

## Approved UI Changes and Rationale

1. **Intent-based Message Rendering**
   - **Change:** Model replies for intents `greeting`, `general`, `calculation`, and `gcode` render as standard chat bubbles styled identically to user bubbles (matching text typography, spacing, and bubble rounding), aligned to the left and styled with the existing model surface color (`bg-surface-container-low`). Rendered via `react-markdown`.
   - **Rationale:** Prevents greetings, general questions, and code explanations from showing heavy, inappropriate diagnostic resolution layouts.
   - **Removed / Modified Classes:** Removed fixed diagnostic wrapper classes when rendering plain chat bubbles.

2. **Diagnostic Resolution Card Cleanup**
   - **Change:** Removed the "Fault Confidence" box completely from the Diagnostic Resolution card. Populated the card from structured diagnostic fields (`alarmCode`, `alarmText`, `likelyCauses`, `steps`, `safetyNote`).
   - **Rationale:** Complies with honesty rules prohibiting invented confidence percentages or fabricated telemetry scores.
   - **Removed Classes:**
     - `flex items-center gap-3 bg-surface-container-lowest px-4 py-2 rounded self-start md:self-auto flex-shrink-0` (Fault confidence container)
     - `font-headline-lg text-headline-lg text-secondary font-bold font-mono` (Fault confidence percentage score)
     - `font-label-sm text-label-sm text-tertiary font-mono border-l border-surface-container-high pl-3 leading-tight` (Fault confidence label)
     - `bg-surface-container p-3.5 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3` (Header flex layout adjusted)
     - `flex items-center gap-3 self-start md:self-auto flex-shrink-0` (Card actions flex container adjusted)
     - `font-body-sm text-body-sm text-tertiary mt-0.5 max-w-lg prose prose-invert prose-xs` (Safety note block updated)
     - `space-y-4 font-body-sm text-body-sm text-tertiary leading-relaxed prose prose-invert prose-sm max-w-none` (Diagnostic steps container updated)

3. **Diagnostic Reasoning Chain Visibility**
   - **Change:** Hidden by default; rendered only when real `toolCalls` are present and non-empty.
   - **Rationale:** Prevents fabricated, static reasoning steps when no tool calls were executed.

4. **Model Badge Verification**
   - **Change:** Replaced static "MITSUBISHI VERIFIED" badge with `{n} SOURCES` badge displayed only when real grounding citations are present (`citations.length > 0`). Otherwise hidden.
   - **Rationale:** Adheres to honesty rules preventing false verification claims without retrieved passages.

5. **Header Physics Chip Removal**
   - **Change:** Removed the "PHYSICS: High Precision" chip from the Shopfloor Agent header.
   - **Rationale:** Removed ungrounded simulation status badge.
   - **Removed Classes:**
     - `inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-primary-container/10 text-primary font-label-sm text-label-sm font-mono`
     - `w-2 h-2 rounded-full bg-secondary`

6. **Composer Material Footer Removal**
   - **Change:** Removed "Active Material: Inconel 718 (High-Temp Alloy)" from the composer footer strip.
   - **Rationale:** Removed hard-coded material presumption in the chat composer.
   - **Removed Classes:**
     - `flex items-center gap-2 text-tertiary`
     - `font-label-sm text-label-sm text-tertiary-container font-mono uppercase`
     - `text-error font-mono text-[10px] uppercase hover:underline ml-2`

7. **Shell Status Label Alignment (Approved Locked File Exceptions)**
   - **Change in `src/components/Navigation.tsx`:** Changed "Shop Net: {controller} ONLINE" to "Controller: {controller}".
   - **Change in `src/components/ui/AppShell.tsx`:** Removed "NODE ID: ..." text from footer.
   - **Rationale:** Eliminates simulated network connectivity and artificial node ID strings.

8. **Pendant Camera Modal and File Attachments**
   - **Change:** Integrated camera modal utilizing `getUserMedia({ video: { facingMode: { ideal: "environment" } } })` with live preview, canvas capture, max 2048px JPEG compression at 0.85 quality, and fallback file input. Added hidden file input for image attachments (JPEG, PNG, WebP) with client-side thumbnail chips and remove button.
   - **Rationale:** Enables shopfloor operators on desktop and mobile devices to upload control panel and workpiece photos directly into the diagnostic pipeline.

9. **Voice Recording via MediaRecorder and Inline Transcription**
   - **Change:** Replaced Web Speech API with `MediaRecorder` audio capture (supporting `audio/webm;codecs=opus`, `audio/mp4`, `audio/ogg`), active recording timer, and backend inline transcription via `POST /api/agent/transcribe` calling `MODEL_FLASH`.
   - **Rationale:** Ensures reliable cross-browser audio input on desktop Chrome, Safari, and mobile Android.

## Approved UI Changes: Academy Trainee DB, Live Stats, and Controls

1. **Live Global Stats Row**
   - **Change:** Added a 5-metric summary row ("Learners", "Active (7 days)", "Completions", "Avg crashes before pass", "Most common crash") backed by real-time subscription to `academy_stats/global`.
   - **Rationale:** Displays genuine aggregate operational metrics to all signed-in learners with zero fabricated data.

2. **Admin Trainee Roster Drawer**
   - **Change:** Added a "View trainees" action for admins in the stats row that opens a drawer containing trainee metrics (name, level, XP, missions passed, crashes, last active) from `GET /api/academy/trainees`.
   - **Rationale:** Provides instructors with administrative oversight without cluttering the trainee experience.

3. **Interactive Badges Shelf**
   - **Change:** Wired the 4 header badge icons to an Academy Badges Shelf with tooltips (`title` and `aria-label`), grayed states for locked badges, and a slide-in Badges Drawer explaining qualification criteria and earned dates.
   - **Rationale:** Eliminates dead placeholder icons and motivates learners through clear milestones.

4. **Section Header and Card Action Standardization**
   - **Change:** Updated "INDUSTRIAL CERTIFICATION PATH" to "TRAINING PATH". Replaced "BEGIN DIAGNOSTIC SESSION" with "START MISSION" on the current active mission, "REPLAY MISSION" on passed missions, and hidden on locked missions.
   - **Rationale:** Clarifies path status and prevents misleading entry points into locked content.

5. **Gemini Instructor Label**
   - **Change:** Replaced "PHYSICS LINK ACTIVE" with "Gemini instructor" and removed the simulated status dot in `InstructorPanel.tsx`.
   - **Rationale:** Accurately communicates AI assistance without falsely claiming a real-time hardware physics link.

6. **Server-Authoritative Evaluation and Audio Input**
   - **Change:** Server evaluates G-code run programs via `POST /api/academy/event`, computing collisions, XP, streaks, levels, and badges. Wired the microphone button in `InstructorPanel.tsx` to browser speech recognition for natural voice queries.
   - **Rationale:** Ensures tamper-proof progression and convenient multimodal assistance in noisy shop environments.

## Approved UI Changes: Cutting Calculator 3D Simulation

1. **High-Contrast Flute and Insert Geometry**
   - **Change:** Added 4 helical cutting flutes with alternating dark tungsten and orange protective coatings, gold TiN carbide inserts at the cutting edge, and dual drive keys on the spindle arbor in `src/components/calculator/Calculator3DView.tsx`.
   - **Rationale:** Solves the optical illusion where a featureless monochromatic cylinder spinning about its axis of symmetry appeared completely static to operators.

2. **Process-Specific Tool Kinematics and Chip Ejection**
   - **Change:** Added dynamic tool translation along the cut path according to feed rate and operation type (X-axis sweep for milling, plunge and retract cycle for drilling/tapping/boring, radial/axial feed for turning) and reactive chip ejection sparks.
   - **Rationale:** Visually demonstrates actual machining engagement, contact, and chip clearance in real time.

3. **Dynamic Scrubber and Playback Integration**
   - **Change:** Wired the timeline scrubber track to the real cut cycle progress, and connected play/pause, replay (cycle reset), and speed multipliers (0.5x, 1x, 1.5x) to both spindle rotation and feed rate.
   - **Rationale:** Replaced static 65% mock progress indicator with a functional timeline tracking the simulated cut.

## Approved UI Changes: Machining Calculator Heading and Layout Realignment

1. **Heading Normalization and Label Removal**
   - **Change:** Removed "Kinematic Engine: Kienzle Force V4.2" label and renamed title to "Machining Calculator" in `src/components/calculator/CuttingCalculator.tsx`.
   - **Rationale:** Direct user request to focus the page title and eliminate technical jargon from the primary header.

2. **Removal of Turning Operation and Animation**
   - **Change:** Removed the "Turning" option from process tabs in `CuttingCalculator.tsx` and removed the corresponding turning toolpath branch in `Calculator3DView.tsx`.
   - **Rationale:** Aligns the calculator interface with vertical and 3-axis milling/machining center workflows.

3. **Enlarged 3D Viewport and Vertical Metric Sequence**
   - **Change:** Expanded the 3D simulation widget to `min-h-[520px]` and 8-column right panel span. Reordered and stacked the 4 primary metrics vertically into sequence: (1) Spindle Speed, (2) Feed Rate, (3) Spindle Torque, and (4) Material Removal Rate alongside the 3D viewport.
## Approved UI Changes: Shopfloor Agent Controls, Citations, and Header/Footer Cleanup

1. **Header and Footer Cleanup (Approved Locked File Exceptions)**
   - **Change in `src/components/Navigation.tsx`:** Removed notification bell symbol button, removed header language dropdown selector, and removed `/ {currentLang.short}` controller indicator.
   - **Change in `src/components/ui/AppShell.tsx`:** Removed `<span>CNC COPILOT INDUSTRIAL TELEMETRY</span>` from the footer bar.
   - **Rationale:** Direct user request to declutter navigation and eliminate redundant telemetry labels and header controls.

2. **Composer Language Preference Selector**
   - **Change in `src/components/ShopfloorAgent.tsx`:** Added a language selector button adjacent to the attachment paperclip button in the chat composer bar, offering quick selection between English, Hindi, Malayalam, and Tamil. Wired to both Speech-to-Text transcription and Text-to-Speech audio playback.
   - **Rationale:** Empowers shopfloor operators to choose their preferred working language directly inside the conversational workspace.

3. **History Management and 3-Dot Action Menu**
   - **Change in `src/components/ShopfloorAgent.tsx`:**
     - Added controller filter chips (`All`, `Fanuc`, `Mitsu`, `Generic`) to organize past chats by machine controller type.
     - Added a 3-dot dropdown context menu (`...`) on every chat item in the history list offering "Pin Chat", "Export Chat", and "Delete Chat".
     - Implemented pinned chat sorting to the top of the history list with Firestore persistence.
     - Implemented industrial Markdown export of diagnostic logs with timestamps, alarms, steps, and verified citations.
     - Implemented hard deletion with an explicit confirmation pop-up modal dialog and recursive subcollection cleanup.
     - Added blank session protection to prevent creating redundant empty sessions.
   - **Rationale:** Streamlines diagnostic history workflows and provides clean session lifecycle management.

4. **Microphone Voice Interaction**
   - **Change in `src/components/ShopfloorAgent.tsx`:** Updated the mic button with press-and-hold support (hold to talk > 350ms, release to transcribe and auto-submit) alongside click-to-toggle, with real-time recording feedback and broad audio format support.
   - **Rationale:** Provides intuitive voice interaction suited for noisy machine shop environments.

5. **Verified Document Citations with Direct Tab Previews**
   - **Change in `src/components/ShopfloorAgent.tsx` and `server/routes/kb.ts`:** Citations rendered in chat bubbles and diagnostic cards link directly to `/api/kb/file/:identifier` opening PDF documentation in a new browser tab. When no manual data is retrieved, answers include a clear, concise one-line guardrail: `"Not found in your uploaded manuals. Here is general guidance based on standard engineering knowledge:"`.
   - **Rationale:** Strictly enforces honesty rules and provides instant grounding verification against uploaded manuals.



