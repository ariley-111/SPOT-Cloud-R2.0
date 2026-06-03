/* eslint-disable */
/** Ported verbatim from legacy spot_r1_5.jsx:1265-1338 (DISPLAY_TEMPLATES).
 *  10 built-in display templates. Each has:
 *    - id        — short slug used internally
 *    - name      — visible label
 *    - defaultQtys — 5-slot qty array pre-populated when template is loaded
 *    - components  — list of {desc, type, pcs, on, opt}
 *        type: "Manufactured" | "Fulfillment" | "Purchased"
 *        pcs:  pcs-per-set (1 base + 3 shelves etc.)
 *        on:   default included? (true = checked)
 *        opt:  optional component? (controls visual "optional" badge)
 */
export const DISPLAY_TEMPLATES = [
  { id: "counter", name: "Counter Display", defaultQtys: ["250", "500", "1000", "", ""],
    components: [
      { desc: "Counter Tray",    type: "Manufactured", pcs: 1, on: true },
      { desc: "Header Card",     type: "Manufactured", pcs: 1, on: true },
      { desc: "Insert Divider",  type: "Manufactured", pcs: 1, on: false, opt: true },
      { desc: "Backer",          type: "Manufactured", pcs: 1, on: false, opt: true },
    ] },
  { id: "dumpbin", name: "Dump Bin", defaultQtys: ["100", "250", "500", "", ""],
    components: [
      { desc: "Bin Body",        type: "Manufactured", pcs: 1, on: true },
      { desc: "Header",          type: "Manufactured", pcs: 1, on: true },
      { desc: "Stiffener",       type: "Manufactured", pcs: 1, on: false, opt: true },
    ] },
  { id: "endcap", name: "Endcap", defaultQtys: ["50", "100", "250", "", ""],
    components: [
      { desc: "Base Tray",       type: "Manufactured", pcs: 1, on: true },
      { desc: "Shelf",           type: "Manufactured", pcs: 3, on: true },
      { desc: "Side Panel",      type: "Manufactured", pcs: 2, on: true },
      { desc: "Header",          type: "Manufactured", pcs: 1, on: true },
      { desc: "Backer",          type: "Manufactured", pcs: 1, on: false, opt: true },
    ] },
  { id: "floor", name: "Floor Display", defaultQtys: ["100", "250", "500", "", ""],
    components: [
      { desc: "Base Tray",       type: "Manufactured", pcs: 1, on: true },
      { desc: "Riser",           type: "Manufactured", pcs: 1, on: true },
      { desc: "Header",          type: "Manufactured", pcs: 1, on: true },
      { desc: "Shelf Tray",      type: "Manufactured", pcs: 3, on: true,  opt: true },
      { desc: "Wing Panel",      type: "Manufactured", pcs: 2, on: false, opt: true },
      { desc: "Shrink Wrap",     type: "Fulfillment",  pcs: 1, on: false, opt: true },
    ] },
  { id: "fsdu", name: "FSDU", defaultQtys: ["50", "100", "250", "", ""],
    components: [
      { desc: "Base",            type: "Manufactured", pcs: 1, on: true },
      { desc: "Riser Column",    type: "Manufactured", pcs: 2, on: true },
      { desc: "Shelf Tray",      type: "Manufactured", pcs: 4, on: true },
      { desc: "Header",          type: "Manufactured", pcs: 1, on: true },
      { desc: "Side Panel",      type: "Manufactured", pcs: 2, on: true,  opt: true },
      { desc: "Pallet Wrap",     type: "Fulfillment",  pcs: 1, on: false, opt: true },
    ] },
  { id: "pallet", name: "Pallet Display", defaultQtys: ["25", "50", "100", "", ""],
    components: [
      { desc: "Pallet Wrap",     type: "Manufactured", pcs: 1, on: true },
      { desc: "Tray",            type: "Manufactured", pcs: 4, on: true },
      { desc: "Riser",           type: "Manufactured", pcs: 1, on: true },
      { desc: "Header",          type: "Manufactured", pcs: 1, on: true },
      { desc: "Corner Post",     type: "Purchased",    pcs: 4, on: false, opt: true },
    ] },
  { id: "pdq", name: "PDQ", defaultQtys: ["250", "500", "1000", "", ""],
    components: [
      { desc: "PDQ Tray",        type: "Manufactured", pcs: 1, on: true },
      { desc: "Header Card",     type: "Manufactured", pcs: 1, on: false, opt: true },
      { desc: "Divider Insert",  type: "Manufactured", pcs: 1, on: false, opt: true },
    ] },
  { id: "powerwing", name: "Power Wing", defaultQtys: ["100", "250", "500", "", ""],
    components: [
      { desc: "Wing Panel",      type: "Manufactured", pcs: 2, on: true },
      { desc: "Shelf Tray",      type: "Manufactured", pcs: 4, on: true },
      { desc: "Header",          type: "Manufactured", pcs: 1, on: true },
      { desc: "Hang Strip",      type: "Fulfillment",  pcs: 2, on: false, opt: true },
    ] },
  { id: "shipper", name: "Shipper Display", defaultQtys: ["100", "250", "500", "", ""],
    components: [
      { desc: "Shipper Box",     type: "Manufactured", pcs: 1, on: true },
      { desc: "Insert Tray",     type: "Manufactured", pcs: 1, on: true,  opt: true },
      { desc: "Header",          type: "Manufactured", pcs: 1, on: false, opt: true },
    ] },
  { id: "weekender", name: "Weekender", defaultQtys: ["100", "250", "500", "", ""],
    components: [
      { desc: "Base Tray",       type: "Manufactured", pcs: 1, on: true },
      { desc: "Riser",           type: "Manufactured", pcs: 1, on: true },
      { desc: "Header",          type: "Manufactured", pcs: 1, on: true },
    ] },
];
