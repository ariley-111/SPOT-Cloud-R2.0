/* eslint-disable */
import React from "react";

export default function Modal({ title, onClose, children, footer, width = 720, "data-testid": dti }) {
  React.useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="sp-modal-backdrop" data-testid={dti || "modal-backdrop"} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sp-modal" style={{ width }} role="dialog" aria-modal="true">
        <div className="sp-modal-head">
          <span>{title}</span>
          <button className="sp-btn" onClick={onClose} data-testid="modal-close-btn"
            style={{ padding: "2px 10px" }}>×</button>
        </div>
        <div className="sp-modal-body">{children}</div>
        {footer && <div className="sp-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
