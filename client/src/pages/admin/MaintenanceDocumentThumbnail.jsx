import { useEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getComplianceDocument, getMaintenanceDocument } from "../../api/maintenanceApi";

export function MaintenanceDocumentThumbnail({ documentId, source = "maintenance_job", version, label, onOpen }) {
  const buttonRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState("Loading preview…");

  useEffect(() => {
    if (!window.IntersectionObserver) { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "150px" });
    observer.observe(buttonRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let pdfTask;
    const controller = new AbortController();
    setPreview("");
    setStatus("Loading preview…");
    async function load() {
      try {
        const response = source === "maintenance_job"
          ? await getMaintenanceDocument(documentId, { signal: controller.signal })
          : await getComplianceDocument(source, documentId, { signal: controller.signal });
        if (disposed) return;
        const data = response.data?.attachmentData || "";
        if (/^data:image\/(png|jpe?g|webp|gif|bmp)(;|,)/i.test(data)) {
          setPreview(data);
          return;
        }
        if (!/^data:application\/pdf(;|,)/i.test(data)) {
          setStatus("Preview unavailable");
          return;
        }
        const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const bytes = new Uint8Array(await (await fetch(data, { signal: controller.signal })).arrayBuffer());
        if (disposed) return;
        pdfTask = pdfjs.getDocument({ data: bytes });
        // Password-protected documents still open via the normal paper viewer.
        pdfTask.onPassword = () => {
          if (!disposed) setStatus("Protected PDF · Click to open");
          void pdfTask.destroy();
        };
        const pdf = await pdfTask.promise;
        const page = await pdf.getPage(1);
        if (disposed) return;
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(280 / original.width, 340 / original.height) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        if (!disposed) setPreview(canvas.toDataURL("image/png"));
      } catch (_error) {
        if (!disposed) setStatus("Preview unavailable · Click to open");
      } finally {
        if (pdfTask) await pdfTask.destroy();
      }
    }
    void load();
    return () => {
      disposed = true;
      controller.abort();
      if (pdfTask) void pdfTask.destroy();
    };
  }, [visible, documentId, source, version]);

  return (
    <button ref={buttonRef} className="maintenance-document-thumbnail" type="button" onClick={onOpen} aria-label={`Open ${label}`}>
      {preview ? <img src={preview} alt={`${label} preview`} onError={() => { setPreview(""); setStatus("Preview unavailable · Click to open"); }} /> : <span className="maintenance-thumbnail-status">{status}</span>}
      <span className="maintenance-thumbnail-caption">View paper</span>
    </button>
  );
}
