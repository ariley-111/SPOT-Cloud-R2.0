# Parser Improvement Rules — Backlog

Separate from engine/UI bugs. Items the user wants improved in the RFQ parser
(Anthropic Opus extraction → quote/BOM population).

## Open items
- **[P1] Dimension orientation extraction.** Parser sometimes enters dims "backwards"
  (W/L swapped vs the customer spec). Seen on a multi-part quote, components Tray 1 /
  Tray 2 / Tray 3 (prod quote ~RW-260615). Parser should capture W×L in the spec's stated
  orientation. (Logged 2026-06-16. User has a fuller list of parser rules to add.)

## (User to provide the rest of the parser-rules list)
