# Parser Improvement Rules — Backlog

Separate from engine/UI bugs. Items the user wants improved in the RFQ parser
(Anthropic Opus extraction → quote/BOM population).

## Open items
- **[P1] Async parse to avoid proxy-timeout 520s on large/slow files.**
  Symptom: parsing a large `.msg` (~61.7 MB, multi-attachment) returns a Cloudflare **520**
  ("origin returned an invalid/incomplete response") in the browser. Root cause (confirmed
  via logs 2026-06-16): the backend parse SUCCEEDS — Anthropic Opus returns `200 OK` after
  ~90s, and the backend httpx client allows up to 300s (`routes/parser.py` L257) — but the
  **edge proxy times out at ~100s** and drops the connection before the response returns.
  One parse = one Opus call (`_call_anthropic`, L671) with the whole email+attachments
  payload, so big files are slow. Works in prod today only because prod parses have stayed
  under the edge timeout; a file this large could 520 in prod too.
  **Fix:** make `POST /parser/parse-rfq` asynchronous — start a background job, return a
  job_id immediately (202), have the frontend (`FilesSec.jsx` Build Estimate) poll a
  `GET /parser/parse-rfq/status/{job_id}` until done, then load the result. Parsing
  logic/accuracy unchanged; only request plumbing. Removes the proxy-timeout dependency for
  any file size and hardens prod. (Logged 2026-06-16, user backlogged.)

- **[P1] Dimension orientation extraction.** Parser sometimes enters dims "backwards"
  (W/L swapped vs the customer spec). Seen on a multi-part quote, components Tray 1 /
  Tray 2 / Tray 3 (prod quote ~RW-260615). Parser should capture W×L in the spec's stated
  orientation. (Logged 2026-06-16. User has a fuller list of parser rules to add.)

## (User to provide the rest of the parser-rules list)
