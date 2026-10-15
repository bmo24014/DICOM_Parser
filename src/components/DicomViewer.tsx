import { useCallback, useEffect, useRef, useState } from "react";
import {
  RenderingEngine,
  Enums,
  cache,
  imageLoader,
  init,
  type StackViewport,
} from "@cornerstonejs/core";
import {
  init as initDicomLoader,
  wadouri,
} from "@cornerstonejs/dicom-image-loader";
import { Enums as MetadataEnums, metaData } from "@cornerstonejs/metadata";
import type { Series } from "../domain";

type Tool = "window" | "pan" | "zoom";
type Session = {
  engine: RenderingEngine;
  viewport: StackViewport;
  imageIds: string[];
  fileIds: string[];
  active: boolean;
  frameIndex: number;
  stackReady: boolean;
  pending: Set<Promise<unknown>>;
};

let initialized = false;
function initializeRenderer() {
  if (initialized) return;
  init();
  // The loader's module workers and codecs are bundled/served locally by Vite.
  initDicomLoader({
    maxWebWorkers: Math.min(2, navigator.hardwareConcurrency || 1),
  });
  initialized = true;
}

function decoderMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "error" in error)
    return decoderMessage(error.error);
  return "This file could not be decoded. Try another image or series; the file may be incomplete or use an unsupported transfer syntax.";
}

async function displayFrame(session: Session, index: number) {
  const imageId = session.imageIds[index];
  // StackViewport's GPU loader resolves even after a decode error. Decode
  // explicitly first so failure reaches our UI, and only cache successful
  // images (loadAndCacheImage also leaves an unhandled cache rejection on a
  // bad image in the pinned Cornerstone version).
  if (!cache.getImage(imageId)) {
    const image = await imageLoader.loadImage(imageId, {
      priority: 5,
      requestType: Enums.RequestType.Interaction,
    });
    if (!session.active) return;
    cache.putImageSync(imageId, image);
  }
  if (!session.active) return;
  if (session.stackReady) {
    await session.viewport.setImageIdIndex(index);
  } else {
    await session.viewport.setStack(session.imageIds, index);
    session.stackReady = true;
  }
  if (!session.active) return;
  if (session.viewport.getCornerstoneImage()?.imageId !== imageId) {
    throw new Error(
      "The decoded frame could not be displayed. Try another frame or series.",
    );
  }
  session.viewport.render();
}

/** One local stack viewport; no DICOM bytes are sent to a server. */
export default function DicomViewer({ series }: { series: Series | null }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const readyRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const lastWheelRef = useRef(0);
  const [tool, setTool] = useState<Tool>("window");
  const [slice, setSlice] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (!series) {
      setBusy(false);
      setError(null);
      setSlice(0);
      setFrameCount(0);
      return;
    }
    let session: Session | null = null;
    let observer: ResizeObserver | null = null;
    readyRef.current = false;

    // Setup and each navigation operation are tracked so a series switch can
    // release its own files/cache after in-flight decoding finishes.
    async function openStack() {
      let openingEngine: RenderingEngine | null = null;
      const openingFiles: string[] = [];
      setBusy(true);
      setError(null);
      setSlice(0);
      setFrameCount(0);
      try {
        initializeRenderer();
        if (!series!.instances.length)
          throw new Error("This series has no image instances.");
        const engine = new RenderingEngine(
          `local-engine-${crypto.randomUUID()}`,
        );
        openingEngine = engine;
        const viewportId = `local-stack-${crypto.randomUUID()}`;
        engine.enableElement({
          viewportId,
          type: Enums.ViewportType.STACK,
          element: element!,
          defaultOptions: { background: [0.025, 0.04, 0.06] },
        });
        const fileIds = series!.instances.map((instance) => {
          const fileId = wadouri.fileManager.add(instance.file);
          openingFiles.push(fileId);
          return fileId;
        });
        const imageIds = series!.instances.flatMap((instance, index) =>
          instance.frameCount > 1
            ? Array.from(
                { length: instance.frameCount },
                (_, frame) => `${fileIds[index]}?frame=${frame + 1}`,
              )
            : [fileIds[index]],
        );
        session = {
          engine,
          viewport: engine.getViewport<StackViewport>(viewportId),
          fileIds,
          imageIds,
          active: true,
          frameIndex: 0,
          stackReady: false,
          pending: new Set(),
        };
        sessionRef.current = session;
        setFrameCount(imageIds.length);
        observer = new ResizeObserver(() => {
          if (session?.active) session.engine.resize(true, true);
        });
        observer.observe(element!);
        const load = displayFrame(session, 0);
        session.pending.add(load);
        await load;
        session.pending.delete(load);
        if (!session.active) return;
        readyRef.current = true;
        setBusy(false);
      } catch (failure) {
        if (session && !session.active) return;
        if (!session) {
          openingEngine?.destroy();
          openingFiles.forEach((fileId) =>
            wadouri.fileManager.remove(Number(fileId.split(":")[1])),
          );
        }
        readyRef.current = !!session?.active;
        setError(decoderMessage(failure));
        setBusy(false);
      }
    }
    void openStack();

    return () => {
      observer?.disconnect();
      if (!session) return;
      const closing = session;
      closing.active = false;
      if (sessionRef.current === closing) {
        sessionRef.current = null;
        readyRef.current = false;
      }
      closing.engine.destroy();
      void Promise.allSettled([...closing.pending]).then(() => {
        for (const imageId of closing.imageIds) {
          if (cache.getImageLoadObject(imageId))
            cache.removeImageLoadObject(imageId);
          metaData.clearQuery(
            MetadataEnums.MetadataModules.NATURALIZED,
            imageId,
          );
        }
        for (const fileId of closing.fileIds) {
          metaData.clearQuery(
            MetadataEnums.MetadataModules.NATURALIZED,
            fileId,
          );
          wadouri.fileManager.remove(Number(fileId.split(":")[1]));
        }
      });
    };
  }, [series]);

  const navigate = useCallback((index: number) => {
    const session = sessionRef.current;
    if (!session?.active || !readyRef.current) return;
    const next = Math.max(0, Math.min(session.imageIds.length - 1, index));
    if (next === session.frameIndex) return;
    session.frameIndex = next;
    readyRef.current = false;
    setBusy(true);
    setError(null);
    const load = displayFrame(session, next);
    session.pending.add(load);
    void load
      .then(() => {
        if (!session.active) return;
        setSlice(next);
      })
      .catch((failure: unknown) => {
        if (session.active) {
          setSlice(next);
          setError(decoderMessage(failure));
        }
      })
      .finally(() => {
        session.pending.delete(load);
        if (session.active) {
          readyRef.current = true;
          setBusy(false);
        }
      });
  }, []);

  // A native, non-passive handler prevents scrolling the page over the canvas.
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const session = sessionRef.current;
      if (
        !session?.active ||
        !event.deltaY ||
        performance.now() - lastWheelRef.current < 65
      )
        return;
      lastWheelRef.current = performance.now();
      navigate(session.frameIndex + Math.sign(event.deltaY));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [navigate]);

  function resetView() {
    const viewport = sessionRef.current?.viewport;
    if (!viewport || !readyRef.current) return;
    viewport.resetCamera();
    viewport.resetProperties();
    viewport.render();
  }

  return (
    <div className="dicom-viewer">
      <div className="dicom-toolbar" role="toolbar" aria-label="Image controls">
        {(
          [
            ["window", "Window / level"],
            ["pan", "Pan"],
            ["zoom", "Zoom"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tool === value ? "active" : ""}
            aria-pressed={tool === value}
            disabled={busy || !series || !!error}
            onClick={() => setTool(value)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy || !series || !!error}
          onClick={resetView}
        >
          Reset view
        </button>
      </div>
      <div style={{ position: "relative", background: "#070c13" }}>
        <div
          ref={elementRef}
          className="dicom-canvas"
          role="img"
          aria-label={
            series
              ? `DICOM image, frame ${slice + 1} of ${frameCount}`
              : "Empty DICOM viewport"
          }
          style={{
            height: "clamp(320px, 52vh, 610px)",
            minHeight: 320,
            width: "100%",
            touchAction: "none",
            cursor: tool === "pan" ? "grab" : "crosshair",
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !readyRef.current || error) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerMove={(event) => {
            const previous = dragRef.current;
            const viewport = sessionRef.current?.viewport;
            if (!previous || !viewport || !readyRef.current || error) return;
            const dx = event.clientX - previous.x;
            const dy = event.clientY - previous.y;
            dragRef.current = { x: event.clientX, y: event.clientY };
            if (tool === "pan") {
              const pan = viewport.getPan();
              viewport.setPan([pan[0] + dx, pan[1] + dy]);
            } else if (tool === "zoom") {
              viewport.setZoom(
                Math.max(
                  0.1,
                  Math.min(20, viewport.getZoom() * Math.exp(-dy / 150)),
                ),
              );
            } else {
              const range = viewport.getProperties().voiRange;
              if (!range) return;
              const width = Math.max(1, range.upper - range.lower);
              const center = (range.upper + range.lower) / 2;
              const scale = Math.max(width / 250, 0.1);
              const newWidth = Math.max(1, width + dx * scale);
              const newCenter = center + dy * scale;
              viewport.setProperties({
                voiRange: {
                  lower: newCenter - newWidth / 2,
                  upper: newCenter + newWidth / 2,
                },
              });
            }
            viewport.render();
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onLostPointerCapture={() => {
            dragRef.current = null;
          }}
        />
        {(busy || error || !series) && (
          <div
            className="viewer-status"
            role={error ? "alert" : "status"}
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeContent: "center",
              textAlign: "center",
              padding: 24,
              pointerEvents: "none",
              background: error ? "rgba(7,12,19,.9)" : "transparent",
            }}
          >
            {error ? (
              <>
                <strong>Image could not be displayed</strong>
                <p style={{ maxWidth: 420 }}>{error}</p>
              </>
            ) : busy ? (
              "Decoding local DICOM image…"
            ) : (
              "Import DICOM to test viewer"
            )}
          </div>
        )}
      </div>
      <div className="dicom-toolbar">
        <button
          type="button"
          aria-label="Previous frame"
          disabled={busy || slice <= 0}
          onClick={() => navigate(slice - 1)}
        >
          ←
        </button>
        <label htmlFor="dicom-frame" style={{ fontSize: 12, flexShrink: 0 }}>
          Frame {frameCount ? slice + 1 : 0} / {frameCount}
        </label>
        <input
          id="dicom-frame"
          aria-label="Image frame"
          type="range"
          min={0}
          max={Math.max(0, frameCount - 1)}
          value={slice}
          disabled={busy || frameCount < 2}
          onChange={(event) => navigate(Number(event.target.value))}
          style={{ minWidth: 60, flex: 1, accentColor: "#88b9df" }}
        />
        <button
          type="button"
          aria-label="Next frame"
          disabled={busy || slice >= frameCount - 1}
          onClick={() => navigate(slice + 1)}
        >
          →
        </button>
      </div>
      <p className="viewer-status" style={{ margin: 0 }}>
        Scroll to change frame. Select a tool, then drag the image.
        Instance-number order; no spatial reconstruction.
      </p>
    </div>
  );
}
