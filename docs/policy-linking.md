# Policy Document Linking

This document explains how policy documents (regulations, statutes, rule manuals) are linked to rule nodes in the visualizer.

## Overview

The policy linking system connects rule nodes to the source policy language they implement. It has two layers:

1. **Portable citations** (in the rule format) — lightweight text references like "7 USC 2014(e)(1)" that travel with the rule file
2. **Rich policy manifest** (alongside the data) — a `references.json` file with excerpted text, PDF bounding boxes, and many-to-many node mappings

Both layers are visible in the UI and serve different purposes.

## Layer 1: Portable Citations

### RAC `source` field

RAC variables support a `source:` field that cites the legal authority:

```yaml
earned_income_deduction_rate:
  description: '20% earned income deduction'
  source: '7 USC 2014(e)(1)'
  from 2024-10-01: 0.20
```

This shows in the node detail panel as a "Source" line. When the citation matches a known pattern (USC, CFR, IRC), it becomes a clickable link to the relevant legal database (Cornell Law, eCFR).

Supported patterns:

- **USC**: `7 USC 2014` links to `law.cornell.edu/uscode/text/7/2014`
- **CFR**: `7 CFR 273.9` links to `ecfr.gov/current/title-7/section-273.9`
- **IRC**: `IRC 21` resolves as `26 USC 21`

### Fact Graph `<Description>`

Fact Graph XML facts can embed citations in their `<Description>` element:

```xml
<Fact path="/earnedIncomeDeductionRate">
  <Description>20% earned income deduction per 7 USC 2014(e)(1)</Description>
  <Derived><Rational>1/5</Rational></Derived>
</Fact>
```

The description text shows in the node detail panel.

## Layer 2: Policy Manifest (`references.json`)

The rich linking system uses a JSON manifest file stored alongside the ruleset data files.

### File location

```
data/factgraph/snap/
  eligibility.xml                  # the rules
  references.json                  # the policy manifest
  10 CCR 2506-1 SNAP.pdf           # source policy documents
  SNAPFinancialEligibility.pdf     # (multiple documents supported)
  StudentsSNAPDecisionTree.pdf
  tests.json                       # test cases
```

PDF files are committed to the repo alongside the data so they're available to anyone checking out the project.

### Structure

The manifest has three sections: documents, sections, and mappings.

```json
{
  "documents": [
    {
      "id": "10-ccr-2506-1",
      "title": "10 CCR 2506-1 — Colorado SNAP Rules",
      "file": "10 CCR 2506-1 SNAP.pdf"
    },
    {
      "id": "snap-financial-eligibility",
      "title": "SNAP Financial Eligibility FY2026",
      "file": "SNAPFinancialEligibility.pdf"
    }
  ],
  "sections": [
    {
      "id": "10-ccr-2506-1__4.407.2",
      "documentId": "10-ccr-2506-1",
      "label": "4.407.2 — Earned Income Deduction",
      "text": "A household with earned income shall receive a deduction of twenty percent (20%)...",
      "page": 108,
      "rects": [
        { "x": 0.08, "y": 0.32, "w": 0.84, "h": 0.015 },
        { "x": 0.08, "y": 0.34, "w": 0.84, "h": 0.015 }
      ]
    }
  ],
  "mappings": [
    { "nodePath": "/earnedIncomeDeduction", "sectionId": "10-ccr-2506-1__4.407.2" },
    { "nodePath": "/earnedIncomeDeductionRate", "sectionId": "10-ccr-2506-1__4.407.2" }
  ]
}
```

**Documents** define source policy documents. Fields:

- `id` — unique identifier
- `title` — display name
- `file` — (optional) path to a PDF relative to the ruleset data directory
- `url` — (optional) external URL

**Sections** are excerpts from a document. Fields:

- `id` — unique identifier (convention: `{documentId}__{section-label}`)
- `documentId` — which document this comes from
- `label` — display label (e.g., "4.407.2 — Earned Income Deduction")
- `text` — the excerpted policy text (captured from the PDF text layer)
- `page` — (optional) PDF page number where the text was captured
- `rects` — (optional) array of bounding boxes for highlighting the text on the PDF page. Each rect has `x`, `y`, `w`, `h` normalized to 0-1 coordinates relative to the page
- `status` — (optional) `"skipped"` marks sections as not relevant to any rules

**Mappings** connect nodes to sections (many-to-many):

- `nodePath` — the node's path (e.g., `/earnedIncomeDeduction` for FG, `earned_income_deduction` for RAC)
- `sectionId` — the section's ID

### Many-to-many relationship

- One section can be linked to many nodes (e.g., the earned income deduction section applies to both the rate constant and the computed deduction)
- One node can be linked to many sections from different documents (e.g., a node might reference both the state regulation and the federal eligibility desk aid)

### Multiple documents

A ruleset can have multiple policy documents. Each document is a separate PDF with its own sections and overlays. The PDF viewer has a dropdown to switch between documents. When navigating from a node reference, the viewer automatically switches to the correct document and page.

## PDF Viewer Panel

Open the Policy panel by clicking the BookOpen icon in the toolbar.

### Viewing

- PDFs referenced by documents with a `file` field render in the panel
- **Document selector** — dropdown at the top to switch between documents
- **Page navigation** (prev/next) and **zoom controls** (in/out)
- **Text search**: type a query and press Enter to find matches across all pages. Press Enter again to cycle through results. Type a new query and press Enter to search for the new term. Search highlights appear in **cyan**
- Page, zoom, scroll position, and selected document are all preserved when saving references (no reset to page 1)

### Color-coded overlays

Sections with stored bounding boxes (`rects`) show as colored overlays on the PDF:

| Color                   | Meaning                                                     |
| ----------------------- | ----------------------------------------------------------- |
| **Amber**               | Section linked to nodes                                     |
| **Blue** (with border)  | Focused section — navigated here from a node's detail panel |
| **Gray** (with border)  | Skipped — marked as not relevant to the rules               |
| **Green** (with border) | Preview — currently being selected for a new section        |
| **Cyan**                | Search result highlight (text-based, not bounding box)      |

### Creating a section link

There are two ways to create a section link:

**From the PDF panel (recommended):**

1. Select text on the PDF — a blue bar appears: "Selected: ..."
2. Click **"Link to nodes"** — a form opens showing:
   - The captured text (read-only preview)
   - Section label input (e.g., "4.407.2 — Earned Income Deduction")
   - Node picker — search by name/path/label, click to select, selected nodes show as removable chips
3. Click **"Save section"** — the section is created with bounding boxes, linked to the selected nodes, and the amber overlay appears on the PDF

**From a node's detail panel:**

1. Click **"+"** on the node's Policy section
2. If a PDF document exists, the Policy panel opens with a violet banner showing which node you're linking
3. Select text in the PDF and complete the link form — the node is pre-selected
4. If no PDF exists, a fallback form lets you pick existing sections or create new ones with pasted text

### Adding more nodes to an existing section

Click an overlay on the PDF, then click **"+ Link more nodes"** in the popover. An inline node picker lets you add additional node mappings without re-selecting the text.

### Marking sections as skipped

1. Select text on the PDF
2. Click **"Skip"** instead of "Link to nodes"
3. A gray overlay appears. This marks the text as "not relevant to any rules" so you can quickly scan past it

### Clicking an overlay

Click any overlay on the PDF to see a popover with:

- The section label
- List of linked nodes (clickable — navigates to the node detail panel)
- "Link more nodes" button to add additional node mappings
- "Remove" button to delete the section and all its mappings
- For skipped sections: "Remove marking" to un-skip

### Navigating from a node

In the node detail panel, each policy reference shows a file icon button. Click it to:

- Open the Policy panel
- Switch to the correct document (if the section belongs to a different document)
- Navigate to the correct page
- Highlight the section's overlay in blue

## Node Detail Panel — Policy Section

Below "Dependencies" and "Used by", the node detail shows a **Policy** section listing all linked references grouped by document.

Each reference shows:

- Document title (with file icon for PDFs, external link icon for URLs)
- Section label (click anywhere on the card to expand/collapse the excerpted text)
- File icon button to jump to the PDF location (if the section has a page number)
- X button to remove the link (also removes the section if no other nodes reference it)

### Removing references

When you remove a reference from a node, the mapping is deleted. If the section has no remaining node mappings (orphaned), it is automatically removed from the manifest. Skipped sections are preserved since they have no mappings by design.

## API

Both the Fact Graph and RAC servers expose:

- `GET /api/rulesets/:id/references` — returns the full manifest
- `PUT /api/rulesets/:id/references` — replaces the manifest (saves to `references.json` on disk and reloads the model)
- `GET /api/rulesets/:id/references/files/:filename` — serves a policy document file (PDF, text, etc.) from the ruleset's data directory

## Updating a PDF

When a new version of a policy document is released:

1. Replace the PDF file in the data directory
2. Open the Policy panel — the new PDF renders immediately
3. Sections with stored bounding boxes may no longer align if the layout changed. The text content is preserved in the section data
4. Re-select text for any misaligned sections to update the bounding boxes
5. Node mappings, labels, and skip status are all preserved — only the visual position needs updating

## Architecture

### Backend

Both servers load `references.json` at startup and resolve mappings onto model nodes. Each node gets a `references` array with full section text and parent document info, so the frontend doesn't need a separate API call to display references in the node detail.

### Frontend

- **PolicyPanel** (`policy-panel.tsx`) — PDF viewer with overlays, select-to-link, search, and multi-document support
- **PolicyReferencesList** (in `node.tsx`) — inline reference display and management on node detail
- **RacVariableViewer** (`rac-variable-viewer.tsx`) — shows RAC `source` field with citation URL resolution

### Shared types

All types are defined in `packages/shared-types/index.ts`:

- `PolicyDocument`, `PolicySection`, `PolicyMapping`, `PolicyReferences`
- `NormalizedRect`, `SectionStatus`, `ResolvedReference`

Citation URL resolution is in `packages/shared-types/citations.ts`.

### State persistence

The PDF viewer preserves its state (page, zoom, scroll position, selected document) across component remounts caused by model refreshes. This is done via module-level variables in `policy-panel.tsx` rather than React state, since React state is lost when a component unmounts.
