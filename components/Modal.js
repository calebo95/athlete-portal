// components/Modal.js
import { useEffect } from "react";

/**
 * Reusable modal (no dependencies)
 *
 * Usage:
 * <Modal
 *   open={open}
 *   title="Add obligation"
 *   onClose={() => setOpen(false)}
 *   footer={<>
 *     <button onClick={() => setOpen(false)} className="btn">Cancel</button>
 *     <button onClick={...} className="btn btnPrimary">Save</button>
 *   </>}
 * >
 *   ...content...
 * </Modal>
 */
export default function Modal({ open, title, onClose, children, footer, width = 860 }) {
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e) {
      if (e.key === "Escape") onClose?.();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const overlayStyle = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 1000,
  };

  // Glassy dark modal that matches your purple/cyan theme
  const modalStyle = {
    width: `min(${width}px, 100%)`,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.14)",
    background:
      "radial-gradient(900px 340px at 20% 0%, rgba(124,58,237,.14), transparent 65%)," +
      "radial-gradient(900px 340px at 80% 0%, rgba(34,211,238,.10), transparent 65%)," +
      "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.04))",
    boxShadow: "0 22px 70px rgba(0,0,0,.55)",
    overflow: "hidden",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    color: "rgba(255,255,255,0.92)",
  };

  const headerStyle = {
    padding: "14px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  };

  const titleStyle = {
    fontWeight: 900,
    letterSpacing: "-0.02em",
  };

  const closeBtnStyle = {
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.92)",
    borderRadius: 12,
    padding: "8px 10px",
    cursor: "pointer",
  };

  const bodyStyle = { padding: 16 };

  const footerStyle = {
    padding: "12px 16px",
    borderTop: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
  };

  return (
    <div
      style={overlayStyle}
      onMouseDown={(e) => {
        // click outside to close
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div style={modalStyle} role="dialog" aria-modal="true" aria-label={title || "Modal"}>
        <div style={headerStyle}>
          <div style={titleStyle}>{title || "Modal"}</div>
          <button onClick={onClose} style={closeBtnStyle} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={bodyStyle}>{children}</div>

        {footer ? <div style={footerStyle}>{footer}</div> : null}
      </div>
    </div>
  );
}
