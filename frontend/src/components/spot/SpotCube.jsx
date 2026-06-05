/* eslint-disable */
/**
 * SpotCube — verbatim port of legacy spot_r1_5.jsx L4882-4895.
 *
 * The 3D box logo: 6 faces in SPC brand colors, slowly Y-spinning with a
 * color-cycling glow filter. Two animations:
 *   - spotSpin  → continuous Y rotation tilted -35deg on X (slow, calm)
 *   - spotGlow  → cycles drop-shadow color through brand hues (also slow)
 * Pass `fetching` to make it spin fast + glow tight (used as a busy indicator
 * during freight / route calculations — legacy convention).
 *
 * Size defaults to 22px (legacy default); override via `size` prop for the
 * 12px inline variant used inside buttons/badges.
 */
import React, { useEffect } from "react";

// SPC brand palette (verbatim from legacy L4885-4890).
const FACES = [
  { cls: "fr", bg: "#E6007E" },  // front  — magenta
  { cls: "bk", bg: "#A30058" },  // back   — dark magenta
  { cls: "rt", bg: "#FFD100" },  // right  — yellow
  { cls: "lt", bg: "#BF9D00" },  // left   — olive
  { cls: "tp", bg: "#00B4E6" },  // top    — cyan
  { cls: "bt", bg: "#007FA3" },  // bottom — dark cyan
];

// Inject the cube CSS once per page (idempotent — checks for the marker id).
function ensureCubeCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById("spot-cube-css")) return;
  const style = document.createElement("style");
  style.id = "spot-cube-css";
  style.textContent = `
    .spot-cube-wrap{perspective:400px;flex-shrink:0;display:inline-block;animation:spotGlow 8s linear infinite}
    .spot-cube{width:100%;height:100%;position:relative;transform-style:preserve-3d;animation:spotSpin 8s linear infinite}
    .spot-cube .fc{position:absolute;width:100%;height:100%;outline:1px solid #000;backface-visibility:visible}
    @keyframes spotSpin{0%{transform:rotateX(-35deg) rotateY(0deg)}100%{transform:rotateX(-35deg) rotateY(360deg)}}
    @keyframes spotGlow{
      0%{filter:drop-shadow(0 0 6px #E6007E) drop-shadow(0 0 12px #E6007E44)}
      16%{filter:drop-shadow(0 0 7px #FF3399) drop-shadow(0 0 14px #FF339944)}
      33%{filter:drop-shadow(0 0 6px #FFD100) drop-shadow(0 0 12px #FFD10044)}
      50%{filter:drop-shadow(0 0 7px #FFE84D) drop-shadow(0 0 14px #FFE84D44)}
      66%{filter:drop-shadow(0 0 6px #00B4E6) drop-shadow(0 0 12px #00B4E644)}
      83%{filter:drop-shadow(0 0 7px #33CCFF) drop-shadow(0 0 14px #33CCFF44)}
      100%{filter:drop-shadow(0 0 6px #E6007E) drop-shadow(0 0 12px #E6007E44)}
    }
    .spot-cube-wrap.fetching .spot-cube{animation:spotSpin 0.7s linear infinite}
    .spot-cube-wrap.fetching{animation:spotGlow 1.5s linear infinite}
  `;
  document.head.appendChild(style);
}

export default function SpotCube({ size = 22, fetching = false, style = {} }) {
  useEffect(ensureCubeCss, []);
  const half = size / 2;
  // Per-face transform uses half the size as the translateZ so the cube is
  // perfectly square at any size (legacy hardcoded 11px for 22px; we generalize).
  return (
    <div className={"spot-cube-wrap" + (fetching ? " fetching" : "")}
         style={{ width: size, height: size, ...style }}
         data-testid="spot-cube">
      <div className="spot-cube" style={{ width: size, height: size }}>
        {FACES.map((f) => {
          let tx;
          switch (f.cls) {
            case "fr": tx = `translateZ(${half}px)`; break;
            case "bk": tx = `rotateY(180deg) translateZ(${half}px)`; break;
            case "rt": tx = `rotateY(90deg)  translateZ(${half}px)`; break;
            case "lt": tx = `rotateY(-90deg) translateZ(${half}px)`; break;
            case "tp": tx = `rotateX(90deg)  translateZ(${half}px)`; break;
            case "bt": tx = `rotateX(-90deg) translateZ(${half}px)`; break;
            default:   tx = "";
          }
          return (
            <div key={f.cls} className={`fc ${f.cls}`}
                 style={{ background: f.bg, transform: tx, width: size, height: size }} />
          );
        })}
      </div>
    </div>
  );
}
