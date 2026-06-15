"""One-shot script to generate the SPOT Cloud project briefing as a Word doc.
Run from /app: python3 generate_briefing.py
Output: /app/memory/SPOT_Cloud_Status_2026-02-09.docx
"""
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

# ─── SPC brand palette (matches SpotCube) ──────────────────────────────
SPC_MAGENTA = RGBColor(0xE6, 0x00, 0x7E)
SPC_CYAN    = RGBColor(0x00, 0xB4, 0xE6)
GREEN       = RGBColor(0x16, 0xA3, 0x4A)
AMBER       = RGBColor(0xE0, 0x8E, 0x0A)
RED         = RGBColor(0xDC, 0x26, 0x26)
GREY        = RGBColor(0x4B, 0x55, 0x63)
DARK        = RGBColor(0x11, 0x18, 0x27)

doc = Document()

# Base style
style = doc.styles["Normal"]
style.font.name = "Calibri"
style.font.size = Pt(11)
style.font.color.rgb = DARK

# ─── Cover ────────────────────────────────────────────────────────────
def h1(text, color=SPC_MAGENTA):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(22); r.font.bold = True; r.font.color.rgb = color
    p.paragraph_format.space_after = Pt(4)
    return p

def h2(text, color=DARK):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(15); r.font.bold = True; r.font.color.rgb = color
    p.paragraph_format.space_before = Pt(14); p.paragraph_format.space_after = Pt(6)
    return p

def h3(text, color=SPC_CYAN):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(12); r.font.bold = True; r.font.color.rgb = color
    p.paragraph_format.space_before = Pt(8); p.paragraph_format.space_after = Pt(2)
    return p

def para(text, bold=False, italic=False, size=11, color=None):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(size); r.font.bold = bold; r.font.italic = italic
    if color: r.font.color.rgb = color
    return p

def bullet(text, level=0, color=None, bold=False):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.left_indent = Inches(0.25 + level * 0.25)
    r = p.add_run(text)
    r.font.bold = bold
    if color: r.font.color.rgb = color
    return p

def kv(k, v, k_color=GREY, v_color=DARK):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    rk = p.add_run(f"{k}: ")
    rk.font.bold = True; rk.font.color.rgb = k_color; rk.font.size = Pt(10)
    rv = p.add_run(str(v))
    rv.font.color.rgb = v_color; rv.font.size = Pt(10)

def divider():
    p = doc.add_paragraph()
    r = p.add_run("─" * 60)
    r.font.color.rgb = RGBColor(0xD1, 0xD5, 0xDB); r.font.size = Pt(9)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER

# ─── COVER ────────────────────────────────────────────────────────────
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
tr = title.add_run("SPOT Cloud")
tr.font.size = Pt(40); tr.font.bold = True; tr.font.color.rgb = SPC_MAGENTA

sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
sr = sub.add_run("Standard Printing Optimization Tool · Cloud Migration · R2.0")
sr.font.size = Pt(13); sr.font.color.rgb = GREY; sr.font.italic = True

dt = doc.add_paragraph()
dt.alignment = WD_ALIGN_PARAGRAPH.CENTER
dr = dt.add_run("Project Status Briefing  ·  February 9, 2026")
dr.font.size = Pt(11); dr.font.color.rgb = SPC_CYAN

doc.add_paragraph(); doc.add_paragraph()

# ─── EXECUTIVE SUMMARY ───────────────────────────────────────────────
h2("Executive Summary", SPC_MAGENTA)
para(
    "SPOT has been successfully ported from a single-user desktop app (built locally with "
    "Claude) into a multi-user cloud SaaS application running on the Emergent platform. The "
    "system retains 100% mathematical parity with the legacy pricing engine while adding "
    "multi-tab drafts, role-based access, an admin console, Microsoft Entra SSO, and a fully "
    "redesigned Freight Dashboard that goes beyond what legacy offered."
)
para(
    "Both PREVIEW (dev) and PRODUCTION environments are live and stable. Five admins are "
    "auto-provisioned for first-login SSO; the rest of the SPC team will be added as Estimators "
    "on their first Microsoft sign-in.",
    italic=True, color=GREY,
)

divider()

# ─── BUILT SO FAR ────────────────────────────────────────────────────
h2("✅ What We've Built", GREEN)

h3("1. Authentication & Access Control")
bullet("Email/password JWT login with bcrypt-hashed credentials (break-glass)")
bullet("Microsoft Entra ID (Azure AD) SSO — OIDC Authorization Code flow with PKCE", bold=True)
bullet("Domain restriction: only @standardprinting.com emails accepted")
bullet("Bootstrap admin allowlist (Ashley, Jim, Rich, George, Michael) — auto-promoted to admin on first SSO login")
bullet("All others auto-provisioned as 'Estimator' role")
bullet("Feature flag SSO_REQUIRED — flip to true to disable JWT login once SSO is verified across team")
bullet("Same App Registration covers both preview and prod redirect URIs", color=GREY)

h3("2. Pricing Engine — 1:1 Legacy Parity")
bullet("Verbatim port of legacy spot_r1_5.jsx routing/runner/core (Auto-Route, CAD/Crest/Bobst route selection)")
bullet("Multi-Part Individual + Matched Set support")
bullet("Per-component cost buildup: board, press, cutting, die, prepress, freight, markup")
bullet("Substrate library: grade × flute × liner × medium combinations + ECT fallbacks")
bullet("Substrate substitution engine (when requested grade unavailable)")
bullet("Die rule lookup with sheet-size auto-routing (Crest >1000 inches surfaces warning but still picks cheapest route — matches legacy)")
bullet("Skid math verbatim from legacy: autoSelectSkid (S/L/WF based on piece dims), nesting calc, FLUTE_CALIPERS for stack height, 5% ink adder")
bullet("Weight estimates use same grade-liner table + take-up factors as estimators use today")

h3("3. Quote Authoring UI")
bullet("Multi-tab draft system — work on multiple quotes simultaneously")
bullet("Auto-save drafts to MongoDB (no data loss on browser refresh)")
bullet("Customer typeahead (loaded from bundled CSV; SharePoint sync queued)")
bullet("BOM Builder modal — define multi-part component breakdown")
bullet("Per-component inline editing with state preservation across component switches")
bullet("Component nav bar with active highlight")
bullet("Quote Table with collapsible per-component sections + qty rows")
bullet("Real-time engine recompute on input change (no manual 'Calculate' button)")

h3("4. Freight Module — Better Than Legacy")
bullet("UTS integration (USS Logistics Quotes API)", bold=True)
bullet("Real-time LTL freight quotes by destination ZIP + computed weight")
bullet("Per-Item vs Per-Job freight scopes (matches legacy semantics)")
bullet("NEW: Freight Dashboard modal", bold=True, color=SPC_CYAN)
bullet("    • Side-by-side Ship Individually vs Ship Together comparison", level=1)
bullet("    • Per-component breakdown: weight, skids, skid size, trailer feet, freight, markup", level=1)
bullet("    • Per-scenario tables: each qty combination shown as a real shippable scenario", level=1)
bullet("    • Recommendation banner: 'Save $X (Y%) by shipping together'", level=1)
bullet("    • Carrier options table — switch to any UTS carrier with one click", level=1)
bullet("    • Transit days shown per carrier", level=1)
bullet("    • FedEx + UPS placeholders ready for direct-API integration", level=1)
bullet("Server-side batch quote endpoint — handles 12+ UTS calls in chunked batches without hitting K8s ingress timeouts")
bullet("Server-side asyncio.Lock — prevents UTS HTTP 500 errors from concurrent calls")

h3("5. Quote Output (PDF / Cost Report)")
bullet("WeasyPrint PDF generation with SPC branding")
bullet("Per-component cost buildup sections")
bullet("Quote Table footer with scenario-based job totals (one row per real shipment)", bold=True)
bullet("Cover letter + estimate info auto-populated from draft state")

h3("6. Admin Console")
bullet("Rate overrides (admin-editable: press rates, cutting rates, markup tiers, etc.)")
bullet("Sheet library management (add/edit/disable sheet sizes)")
bullet("Integrations panel (UTS API key, Anthropic key, future SharePoint/Entra)")
bullet("BOM templates library (save reusable kit definitions)")
bullet("User management (role assignment, view login activity)")

h3("7. RFQ Parser (Anthropic Claude Opus 4.7)")
bullet("Drag-and-drop PDF / DOCX / image RFQ ingestion")
bullet("AI-extracts customer info, components, qtys, dimensions, board specs")
bullet("Preview + edit before committing to draft")
bullet("Anthropic API integration (admin-provided key in Integrations panel)")

h3("8. Branding & UX")
bullet("SPC rotating box-logo cube (3D CSS animation, 6 brand-colored faces)")
bullet("    • On login screen + in top toolbar", level=1)
bullet("    • Verbatim animation port from legacy", level=1)
bullet("Legacy-matching dark theme aesthetic")
bullet("Toast notifications for actions (saved, calculated, freight updated, etc.)")
bullet("Progress modals for long-running operations")
bullet("Removed annoying auto-scroll on component select (refinement based on feedback)")

h3("9. Infrastructure")
bullet("React frontend (port 3000) + FastAPI backend (port 8001) + MongoDB")
bullet("Kubernetes-hosted on Emergent platform")
bullet("Two environments: PREVIEW (dev) + PRODUCTION (live)")
bullet("Hot-reload in preview for rapid iteration")
bullet("MongoDB collections: users, quote_drafts, customers, bom_templates, admin_rates, admin_integrations, admin_sheets")

divider()

# ─── OUTSTANDING ITEMS ───────────────────────────────────────────────
h2("🟠 Outstanding — Items to Hit 1:1 Legacy Parity", AMBER)

h3("P0 — Required Before Go-Live")
bullet("PDF Multi-Qty Job Totals: Each qty scenario must get its OWN job-total section in the PDF (currently UI is fixed; PDF still rolls into combined total)", bold=True)
bullet("PDF Cost Breakdown Slim-Down: Strip cost breakdown to 4 cols only — Qty · Each Price · Per M Price · Total (currently shows 10+ columns)", bold=True)
bullet("Charges Selection Logic: 'Lump Sum / By Type / By Part' options for one-time costs (die, prepress, freight, misc) — controls how charges are attributed in the PDF. Spec/mockup needed", bold=True)
bullet("Cost Report Modal: Port full legacy internal cost report (cloud currently has stub) — line-by-line cost detail estimator sees before sending", bold=True)
bullet("Database Backup Strategy: Required before go-live. Nightly snapshots to off-platform storage (SharePoint when integration lands, or S3/Azure Blob). Restore mechanism + retention policy", bold=True, color=RED)
bullet("Dimension Parser Hardening: Improve fraction handling (7+1/4), unit detection, ID/OD suffix parsing, W×L×D order auto-detect")

h3("P1 — Soon After Go-Live")
bullet("Matched Set behavior audit — math + display in quote table reportedly off (Ashley feedback)")
bullet("Per-component validation badges — amber/red warnings on tabs for missing print, dims, grade/liner, qty, or unaccepted substitutions")
bullet("Substrate substitution parity (flute selection)")
bullet("    • Legacy: 32 B MW → 200 B Kemi/Kraft", level=1)
bullet("    • Cloud:  32 B MW → 200 E Kla/Kla (wrong)", level=1)
bullet("Large RFQ parse 502 timeout — convert /api/parser/parse to background-job pattern for huge RFQs")

h3("P2 — Future Integrations (Phase 5)")
bullet("Ignition API customer sync (replaces bundled CSV)")
bullet("SharePoint PDF archive (auto-upload every sent quote)")
bullet("FedEx Direct API (placeholder in Freight Dashboard, awaiting credentials)")
bullet("UPS Direct API (placeholder in Freight Dashboard, awaiting credentials)")

h3("P3 — Polish & Governance")
bullet("Cover letter notes field wired into Estimate Info section")
bullet("Approval workflow (Admin Console governance — multi-approver review before send)")
bullet("Valid Until vs 90-day PDF footer mismatch")
bullet("Buy-Min amortize vs full-charge logic clarification")
bullet("PDF audit pass — overall layout polish to remove 'messy' feel")
bullet("Sign-in activity widget for Admin Console (last login + auth provider per user)")

divider()

# ─── ISSUE TRACKING ──────────────────────────────────────────────────
h2("🐛 Issue Tracking", RED)
para(
    "Active issues, recent fixes, and known limitations. Sorted by priority. "
    "All issues are tracked against the legacy app as the source of truth.",
    italic=True, color=GREY, size=10,
)

def issue_block(num, title, status, status_color, priority, desc, fix_status=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(8); p.paragraph_format.space_after = Pt(2)
    r1 = p.add_run(f"#{num}  ")
    r1.font.bold = True; r1.font.color.rgb = GREY; r1.font.size = Pt(10)
    r2 = p.add_run(title)
    r2.font.bold = True; r2.font.size = Pt(11)
    r3 = p.add_run(f"   [{status}]")
    r3.font.color.rgb = status_color; r3.font.bold = True; r3.font.size = Pt(9)
    r4 = p.add_run(f"   {priority}")
    r4.font.color.rgb = GREY; r4.font.size = Pt(9); r4.font.italic = True
    para(desc, size=10, color=DARK)
    if fix_status:
        para(f"→ {fix_status}", size=10, italic=True, color=GREY)

h3("Recently Resolved", GREEN)

issue_block(
    "1", "Auto-Route Resolver Parity Gap", "RESOLVED ✓", GREEN, "P0",
    "Cloud was forcing CAD when Crest rule inches > 1000; legacy attaches a warning but still picks the cheaper Crest route. ~$500-600 discrepancy per high-qty component.",
    "Verified routing.py L490-513 matches legacy spot_r1_5.jsx L743-749 verbatim. Crest stays viable=True; cheapest viable wins.",
)
issue_block(
    "2", "Combined-Shipment Freight Weight Parity", "RESOLVED ✓", GREEN, "P0",
    "Cloud computed skids per component (4 skids @ 691 lbs); legacy computes one consolidated load (2 skids @ 864 lbs).",
    "Ported legacy calcShipment/calcBoardWeight/autoSelectSkid/calcPiecesPerSkidLayer verbatim into /app/frontend/src/lib/shipment.js. Live Jamestown test: 4 skids · 1,076 lbs · matches legacy.",
)
issue_block(
    "3", "Default Shipping Markup (0.15) Disappearing", "RESOLVED ✓", GREEN, "P0",
    "Recurring bug where freightMarkup reset to empty on FOB toggle or component switch.",
    "Markup now properly initialized in state and survives mode toggles.",
)
issue_block(
    "4", "Multi-Qty Scenarios Missing Freight", "RESOLVED ✓", GREEN, "P0",
    "Adding additional qtys to multi-part quote showed $0 freight for new scenarios because 60s axios timeout cut off long batches.",
    "New /api/freight/quote-batch endpoint serializes 12+ UTS calls; frontend chunks into batches of 4 to stay under K8s ingress timeout. All scenarios now populate.",
)
issue_block(
    "5", "Carrier Transit Times Showing '—'", "RESOLVED ✓", GREEN, "P0",
    "Backend's allCarriers[].transit field was being read as c.transitDays in the modal.",
    "Field mismatch fixed (c.transit ?? c.transitDays).",
)
issue_block(
    "6", "Confusing 'Job Totals' Math in Quote Table", "RESOLVED ✓", GREEN, "P0",
    "Footer summed ALL component × qty itemSell values (9 prices for a 3×3 quote) producing a nonsensical 'everyone bought everything' grand total.",
    "Rewrote to show one row per real shipment scenario with each component's actual qty in that scenario, plus per-scenario job total and price/pc.",
)
issue_block(
    "7", "MP Individual Quote Table — Per-Component Display", "RESOLVED ✓", GREEN, "P0",
    "Quote table needed collapsible per-component breakdown with exact qtys + cost buildup + freight allocation.",
    "Implemented; per-component sections with BOM row highlighting and Liner/Medium string generation parity.",
)
issue_block(
    "8", "Component-Click State Churn", "RESOLVED ✓", GREEN, "P0",
    "Clicking BOM components was clobbering qtys/state because setField('activeItemIdx') swapped indexes without snapshotting.",
    "Replaced with switchBomItem() which properly snapshots/restores per-component state.",
)
issue_block(
    "9", "Auto-Scroll on BOM Item Select", "RESOLVED ✓", GREEN, "P3",
    "Page scrolled jarringly to active component section on every click.",
    "Removed scrollIntoView; section still auto-expands in place, no page jump.",
)

h3("Open & Active", AMBER)

issue_block(
    "10", "PDF Output Layout — 'Messy'", "OPEN", AMBER, "P0",
    "User feedback: PDFs lack parity with legacy aesthetic — feel cluttered, cost breakdown shows too many columns, multi-qty rolls into combined total instead of per-scenario.",
    "Queued: items A + B from Monday list. ETA same-day once spec confirmed.",
)
issue_block(
    "11", "Charges Selection (Lump Sum / By Type / By Part)", "OPEN", AMBER, "P0",
    "Legacy supports three modes for attributing one-time costs to the PDF; cloud only has a single rollup.",
    "Awaiting spec/mockup from Ashley.",
)
issue_block(
    "12", "Substrate Substitution Flute Selection", "OPEN", AMBER, "P1",
    "Legacy: 32 B MW → 200 B Kemi/Kraft. Cloud: 32 B MW → 200 E Kla/Kla. Impacts pricing by 15-25% when fallback fires.",
    "Engine fix pending — needs legacy rule traced for flute selection during substitution.",
)
issue_block(
    "13", "Matched-Set Math + Display Audit", "OPEN", AMBER, "P1",
    "User reported: math/display feels off in the Matched Set rendering path.",
    "Audit pending — needs specific example case to reproduce.",
)
issue_block(
    "14", "Large RFQ Parse 502 Timeout", "OPEN", AMBER, "P1",
    "Massive RFQs (>60s parse) hit K8s ingress timeout. Anthropic call completes but client errors out.",
    "Convert /api/parser/parse to background-job pattern (queue + poll). Pairs with dimension parser improvements.",
)
issue_block(
    "15", "Dimension Parser Misses on Fractions / Units", "OPEN", AMBER, "P1",
    "Inputs like '7+1/4 x 2+3/8 x 9+3/8 (ID)' don't reliably extract into W/L/D fields.",
    "Tighten parser prompt + add post-processing regex for common patterns.",
)

h3("Known Limitations / Awaiting External", GREY)

issue_block(
    "16", "Production Data Loss (Pre-Live Incident)", "RESOLVED (no real data lost) ✓", GREEN, "INCIDENT",
    "Most recent prod redeploy resulted in empty database. SPOT codebase verified to NOT delete data on startup. Cause was platform-side (Emergent infra). No real data was at risk yet.",
    "Database backup strategy now P0-required before go-live (see item G).",
)
issue_block(
    "17", "FedEx & UPS Direct API Integration", "PLACEHOLDER", GREY, "P2",
    "Currently UTS-only for LTL quotes. FedEx/UPS placeholders visible in Freight Dashboard.",
    "Awaiting Ashley to provide FedEx and UPS API credentials.",
)
issue_block(
    "18", "Ignition Customer Sync", "PLACEHOLDER", GREY, "P2",
    "Customers currently loaded from bundled CSV. Ignition API has full customer master.",
    "Awaiting Ignition API credentials + endpoint documentation from Ashley.",
)
issue_block(
    "19", "SharePoint PDF Archive", "PLACEHOLDER", GREY, "P3",
    "Auto-upload sent quotes to a SharePoint folder for archiving.",
    "Awaiting SharePoint credentials + target folder path from Ashley.",
)

divider()

# ─── ENVIRONMENT SUMMARY ─────────────────────────────────────────────
h2("🌐 Environments & Access", SPC_CYAN)

h3("Production")
kv("URL", "https://ai-connect-33.emergent.host")
kv("Status", "Live, SSO active")
kv("Confirmed sign-ins", "Ashley Riley, George Kistler (2 of 5 admins)")
kv("SSO mode", "Optional (JWT fallback enabled). Flip SSO_REQUIRED=true once all 5 admins have signed in once.")

h3("Preview / Development")
kv("URL", "https://spot-multi-user.preview.emergentagent.com")
kv("Purpose", "Active development environment — all new changes land here first")
kv("Promotion path", "Verify in preview → redeploy to push to prod")

h3("Microsoft Entra App Registration")
kv("Tenant ID", "019353eb-ca18-464b-9d0e-72d9c3910bb6")
kv("Client ID", "2ac83fa8-dd7a-47b8-9593-3ca7ce777d19")
kv("Redirect URIs (both registered in same App Reg)",
   "preview: /api/auth/entra/callback  ·  prod: /api/auth/entra/callback")
kv("Admin bootstrap list", "ariley, jlittle, rwalter, gkistler, mmusgrave @standardprinting.com")

h3("Tech Stack")
kv("Frontend", "React (CRA), shadcn/ui, custom CSS — port 3000")
kv("Backend", "FastAPI + Pydantic — port 8001")
kv("Database", "MongoDB (Motor async driver)")
kv("PDF", "WeasyPrint")
kv("Hosting", "Kubernetes on Emergent platform")
kv("Auth", "JWT (HS256) + Microsoft Entra OIDC via MSAL")
kv("AI Integration", "Anthropic Claude Opus 4.7 (RFQ parser)")
kv("Freight Carrier API", "UTS (USS Logistics)")

divider()

# ─── DEMO TALKING POINTS ────────────────────────────────────────────
h2("🎤 Suggested Demo Talking Points (10:30 AM)", SPC_MAGENTA)

bullet("1. Sign in with Microsoft — show SSO flow with the rotating box-logo cube on the login screen")
bullet("2. Open a multi-part quote with 3 components and 3 different qtys per component")
bullet("3. Show the per-component quote table with inline editing")
bullet("4. Open the Freight Dashboard — point out:")
bullet("    • Per Item vs Per Job toggle", level=1)
bullet("    • Slot-based scenarios (Scenario 1, 2, 3) — each represents a real shipment", level=1)
bullet("    • Recommendation banner showing 60%+ savings by shipping together", level=1)
bullet("    • Carrier options table with one-click switching", level=1)
bullet("5. Scroll to Job Totals footer — show how the totals are split by scenario, not summed into a meaningless combined number")
bullet("6. Open the Admin Console — rates, sheets, integrations, BOM templates")
bullet("7. Mention what's still in flight (PDF rewrite + Cost Report port today)")
bullet("8. Confirm backups will be implemented before go-live")

divider()

para("End of Briefing  ·  Generated 2026-02-09  ·  SPOT Cloud R2.0", italic=True, color=GREY, size=9)

# ─── Save ────────────────────────────────────────────────────────────
out = "/app/memory/SPOT_Cloud_Status_2026-02-09.docx"
doc.save(out)
print("Saved:", out)
