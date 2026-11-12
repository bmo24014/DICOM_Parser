import { useCallback, useEffect, useRef, useState } from "react";
import {
  RenderingEngine,
  Enums,
  cache,
  eventTarget,
  imageLoader,
  init,
  type StackViewport,
} from "@cornerstonejs/core";
import {
  init as initDicomLoader,
  wadouri,
} from "@cornerstonejs/dicom-image-loader";
import { Enums as MetadataEnums, metaData } from "@cornerstonejs/metadata";
import {
  init as initTools,
  addTool,
  RectangleROITool,
  ToolGroupManager,
  Enums as ToolEnums,
  annotation,
  utilities as toolUtilities,
  cancelActiveManipulations,
  type Types as ToolTypes,
} from "@cornerstonejs/tools";
import type { ManualAnnotation, Series } from "../domain";
import { rangeFromWindow, windowFromRange } from "../data/windowLevel";
import {
  annotationFrameIndex,
  seriesFrameReferences,
} from "../data/annotations";

type Point3 = [number, number, number];
type Tool = "window" | "pan" | "zoom" | "flag";
type Session = {
  engine: RenderingEngine;
  viewport: StackViewport;
  imageIds: string[];
  fileIds: string[];
  active: boolean;
  frameIndex: number;
  stackReady: boolean;
  pending: Set<Promise<unknown>>;
  references: (ManualAnnotation["reference"] | null)[];
  nativeIds: Set<string>;
  pendingRegionIds: Set<string>;
  toolGroup: NonNullable<ReturnType<typeof ToolGroupManager.createToolGroup>>;
};
interface Props {
  series: Series | null;
  studyInstanceUID?: string;
  annotations: ManualAnnotation[];
  onAnnotationsChange: (next: ManualAnnotation[]) => void;
  selectedAnnotationId?: string;
  onSelectAnnotation: (id: string | undefined) => void;
  navigationTarget?: { annotationId: string; requestId: number };
}
let initialized = false;
function initializeRenderer() {
  if (initialized) return;
  init();
  initDicomLoader({
    maxWebWorkers: Math.min(2, navigator.hardwareConcurrency || 1),
  });
  initTools();
  addTool(RectangleROITool);
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
  // Explicit decoding preserves rejection: the pinned StackViewport GPU loader
  // otherwise resolves after a decoder failure and may show a blank frame.
  if (!cache.getImage(imageId)) {
    const image = await imageLoader.loadImage(imageId, {
      priority: 5,
      requestType: Enums.RequestType.Interaction,
    });
    if (!session.active) return;
    cache.putImageSync(imageId, image);
  }
  if (!session.active) return;
  if (session.stackReady) await session.viewport.setImageIdIndex(index);
  else {
    await session.viewport.setStack(session.imageIds, index);
    session.stackReady = true;
  }
  if (!session.active) return;
  if (session.viewport.getCornerstoneImage()?.imageId !== imageId)
    throw new Error(
      "The decoded frame could not be displayed. Try another frame or series.",
    );
  session.viewport.render();
}
function removeNativeRegion(id: string) {
  // Clear toolkit selection/visibility before removing its backing object.
  if (annotation.selection.isAnnotationSelected(id))
    annotation.selection.deselectAnnotation(id);
  annotation.visibility.setAnnotationVisibility(id, true);
  annotation.state.removeAnnotation(id);
}

function copyPoints(points: Point3[]): Point3[] {
  return points.map((point) => [...point]);
}

/** Local stack review. Native tools keep manual outlines in image world space. */
export default function DicomViewer(props: Props) {
  const {
    series,
    studyInstanceUID,
    annotations,
    selectedAnnotationId,
    navigationTarget,
  } = props;
  const elementRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const readyRef = useRef(false);
  const syncingRef = useRef(false);
  const visibleRef = useRef(true);
  const toolRef = useRef<Tool>("window");
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const lastWheelRef = useRef(0);
  const handledNavigationRef = useRef<number | undefined>(undefined);
  const [tool, setTool] = useState<Tool>("window");
  const [slice, setSlice] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [windowValues, setWindowValues] = useState<{
    width: number;
    center: number;
  } | null>(null);

  const syncWindow = useCallback(() => {
    const properties = sessionRef.current?.viewport.getProperties();
    const range = properties?.voiRange;
    if (range && Number.isFinite(range.lower) && Number.isFinite(range.upper)) {
      setWindowValues(windowFromRange(range, properties?.VOILUTFunction));
    } else setWindowValues(null);
  }, []);

  const syncAnnotations = useCallback(() => {
    const session = sessionRef.current;
    if (!session?.active || !session.stackReady || !elementRef.current) return;
    syncingRef.current = true;
    try {
      const relevant = propsRef.current.annotations.filter(
        (region) => annotationFrameIndex(region, session.references) >= 0,
      );
      const wanted = new Set(relevant.map((region) => region.id));
      for (const id of session.nativeIds) {
        if (!wanted.has(id) && !session.pendingRegionIds.has(id)) {
          removeNativeRegion(id);
          session.nativeIds.delete(id);
        }
      }
      for (const region of relevant) {
        const frameIndex = annotationFrameIndex(region, session.references);
        let native = annotation.state.getAnnotation(region.id);
        if (!native) {
          native = {
            annotationUID: region.id,
            highlighted: false,
            autoGenerated: false,
            invalidated: false,
            isLocked: false,
            isVisible: true,
            metadata: {
              toolName: RectangleROITool.toolName,
              referencedImageId: session.imageIds[frameIndex],
              FrameOfReferenceUID: session.viewport.getFrameOfReferenceUID(),
              viewPlaneNormal: [...region.viewPlaneNormal],
              viewUp: [...region.viewUp],
            },
            data: {
              label: "Manually flagged region",
              handles: {
                points: copyPoints(region.points),
                activeHandleIndex: null,
                textBox: {
                  hasMoved: false,
                  worldPosition: [0, 0, 0],
                  worldBoundingBox: {
                    topLeft: [0, 0, 0],
                    topRight: [0, 0, 0],
                    bottomLeft: [0, 0, 0],
                    bottomRight: [0, 0, 0],
                  },
                },
              },
              cachedStats: {},
            },
          };
          annotation.state.addAnnotation(native, elementRef.current);
          session.nativeIds.add(region.id);
        } else if (
          JSON.stringify(native.data.handles?.points) !==
          JSON.stringify(region.points)
        ) {
          native.data.handles!.points = copyPoints(region.points);
          native.invalidated = true;
        }
        annotation.visibility.setAnnotationVisibility(
          region.id,
          visibleRef.current && frameIndex === session.frameIndex,
        );
      }
      const selected = propsRef.current.selectedAnnotationId;
      if (
        selected &&
        wanted.has(selected) &&
        annotation.visibility.isAnnotationVisible(selected)
      )
        annotation.selection.setAnnotationSelected(selected);
      else
        for (const id of session.nativeIds)
          if (
            !session.pendingRegionIds.has(id) &&
            annotation.selection.isAnnotationSelected(id)
          )
            annotation.selection.deselectAnnotation(id);
      toolUtilities.triggerAnnotationRenderForViewportIds([
        session.viewport.id,
      ]);
    } finally {
      syncingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !series) return;
    let session: Session | null = null;
    let observer: ResizeObserver | null = null;
    readyRef.current = false;
    const syncOnImage = () => {
      syncWindow();
      syncAnnotations();
    };
    const onAnnotationAdded = (event: Event) => {
      const detail = (
        event as CustomEvent<ToolTypes.EventTypes.AnnotationAddedEventDetail>
      ).detail;
      if (
        session?.active &&
        !syncingRef.current &&
        detail.viewportId === session.viewport.id &&
        detail.annotation.annotationUID
      ) {
        session.nativeIds.add(detail.annotation.annotationUID);
        session.pendingRegionIds.add(detail.annotation.annotationUID);
      }
    };
    const onGeometry = (event: Event) => {
      if (!session?.active || syncingRef.current) return;
      const native = (
        event as CustomEvent<{ annotation: ToolTypes.Annotation }>
      ).detail.annotation;
      const id = native.annotationUID;
      if (!id || !session.nativeIds.has(id)) return;
      const imageIndex = session.imageIds.indexOf(
        native.metadata?.referencedImageId ?? "",
      );
      const reference = session.references[imageIndex];
      const points = native.data.handles?.points;
      if (
        !reference ||
        !points ||
        points.length !== 4 ||
        points.some((point) => point.some((value) => !Number.isFinite(value)))
      )
        return;
      if (
        event.type === ToolEnums.Events.ANNOTATION_COMPLETED &&
        (Math.hypot(
          ...points[0].map((value, index) => value - points[1][index]),
        ) < 1e-8 ||
          Math.hypot(
            ...points[0].map((value, index) => value - points[2][index]),
          ) < 1e-8)
      ) {
        removeNativeRegion(id);
        session.nativeIds.delete(id);
        session.pendingRegionIds.delete(id);
        return;
      }
      if (event.type === ToolEnums.Events.ANNOTATION_COMPLETED)
        session.pendingRegionIds.delete(id);
      const existing = propsRef.current.annotations.find(
        (region) => region.id === id,
      );
      if (!existing && event.type !== ToolEnums.Events.ANNOTATION_COMPLETED)
        return;
      if (!existing && propsRef.current.annotations.length >= 1000) {
        removeNativeRegion(id);
        session.nativeIds.delete(id);
        session.pendingRegionIds.delete(id);
        return;
      }
      const camera = session.viewport.getCamera();
      const region: ManualAnnotation = {
        id,
        source: "manual",
        shape: "rectangle",
        description: existing?.description ?? "",
        ...(existing?.findingId ? { findingId: existing.findingId } : {}),
        reference: { ...reference },
        points: copyPoints(points),
        viewPlaneNormal: [
          ...(native.metadata?.viewPlaneNormal ??
            camera.viewPlaneNormal ?? [0, 0, 1]),
        ] as Point3,
        viewUp: [
          ...(native.metadata?.viewUp ?? camera.viewUp ?? [0, 1, 0]),
        ] as Point3,
      };
      const next = existing
        ? propsRef.current.annotations.map((item) =>
            item.id === id ? region : item,
          )
        : [...propsRef.current.annotations, region];
      // Keep immediate native drag events consistent before React's next render.
      propsRef.current = { ...propsRef.current, annotations: next };
      propsRef.current.onAnnotationsChange(next);
      if (event.type === ToolEnums.Events.ANNOTATION_COMPLETED)
        propsRef.current.onSelectAnnotation(id);
    };
    const onSelection = (event: Event) => {
      if (!session?.active || syncingRef.current) return;
      const detail = (
        event as CustomEvent<ToolTypes.EventTypes.AnnotationSelectionChangeEventDetail>
      ).detail;
      const selected = detail.selection.find((id) =>
        session!.nativeIds.has(id),
      );
      if (selected || detail.removed.some((id) => session!.nativeIds.has(id)))
        propsRef.current.onSelectAnnotation(selected);
    };
    element.addEventListener(Enums.Events.VOI_MODIFIED, syncWindow);
    element.addEventListener(Enums.Events.STACK_NEW_IMAGE, syncOnImage);
    eventTarget.addEventListener(
      ToolEnums.Events.ANNOTATION_ADDED,
      onAnnotationAdded,
    );
    eventTarget.addEventListener(
      ToolEnums.Events.ANNOTATION_COMPLETED,
      onGeometry,
    );
    eventTarget.addEventListener(
      ToolEnums.Events.ANNOTATION_MODIFIED,
      onGeometry,
    );
    eventTarget.addEventListener(
      ToolEnums.Events.ANNOTATION_SELECTION_CHANGE,
      onSelection,
    );
    async function openStack() {
      let openingEngine: RenderingEngine | null = null;
      let groupId: string | null = null;
      const openingFiles: string[] = [];
      setBusy(true);
      setError(null);
      setSlice(0);
      setFrameCount(0);
      setWindowValues(null);
      try {
        initializeRenderer();
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
        const group = ToolGroupManager.createToolGroup(
          `local-tools-${crypto.randomUUID()}`,
        );
        if (!group)
          throw new Error("Could not initialize manual annotation tools.");
        groupId = group.id;
        group.addTool(RectangleROITool.toolName, {
          calculateStats: false,
          getTextLines: () => ["Manual region"],
        });
        group.addViewport(viewportId, engine.id);
        group.setToolEnabled(RectangleROITool.toolName);
        const fileIds = series!.instances.map((instance) => {
          const id = wadouri.fileManager.add(instance.file);
          openingFiles.push(id);
          return id;
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
          references: seriesFrameReferences(series!, studyInstanceUID),
          nativeIds: new Set(),
          pendingRegionIds: new Set(),
          toolGroup: group,
          active: true,
          frameIndex: 0,
          stackReady: false,
          pending: new Set(),
        };
        sessionRef.current = session;
        setFrameCount(imageIds.length);
        observer = new ResizeObserver(() => {
          if (session?.active) {
            session.engine.resize(true, true);
            toolUtilities.triggerAnnotationRenderForViewportIds([
              session.viewport.id,
            ]);
          }
        });
        observer.observe(element!);
        const load = displayFrame(session, 0);
        session.pending.add(load);
        await load;
        session.pending.delete(load);
        if (!session.active) return;
        readyRef.current = true;
        setBusy(false);
        syncWindow();
        syncAnnotations();
        if (toolRef.current === "flag" && visibleRef.current)
          group.setToolActive(RectangleROITool.toolName, {
            bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
          });
      } catch (failure) {
        if (session && !session.active) return;
        if (!session) {
          openingEngine?.destroy();
          if (groupId) ToolGroupManager.destroyToolGroup(groupId);
          openingFiles.forEach((id) =>
            wadouri.fileManager.remove(Number(id.split(":")[1])),
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
      element.removeEventListener(Enums.Events.VOI_MODIFIED, syncWindow);
      element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, syncOnImage);
      eventTarget.removeEventListener(
        ToolEnums.Events.ANNOTATION_ADDED,
        onAnnotationAdded,
      );
      eventTarget.removeEventListener(
        ToolEnums.Events.ANNOTATION_COMPLETED,
        onGeometry,
      );
      eventTarget.removeEventListener(
        ToolEnums.Events.ANNOTATION_MODIFIED,
        onGeometry,
      );
      eventTarget.removeEventListener(
        ToolEnums.Events.ANNOTATION_SELECTION_CHANGE,
        onSelection,
      );
      if (!session) return;
      const closing = session;
      closing.active = false;
      if (sessionRef.current === closing) {
        sessionRef.current = null;
        readyRef.current = false;
      }
      cancelActiveManipulations(element);
      for (const id of closing.nativeIds) removeNativeRegion(id);
      ToolGroupManager.destroyToolGroup(closing.toolGroup.id);
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
  }, [series, studyInstanceUID, syncAnnotations, syncWindow]);

  useEffect(() => {
    syncAnnotations();
  }, [annotations, selectedAnnotationId, syncAnnotations]);
  useEffect(() => {
    const session = sessionRef.current;
    if (!session?.active) return;
    cancelActiveManipulations(session.viewport.element);
    if (
      tool === "flag" &&
      showAnnotations &&
      session.references[session.frameIndex] &&
      !busy &&
      !error
    )
      session.toolGroup.setToolActive(RectangleROITool.toolName, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
      });
    else session.toolGroup.setToolEnabled(RectangleROITool.toolName);
  }, [tool, showAnnotations, busy, error, slice]);

  const navigate = useCallback(
    (index: number) => {
      const session = sessionRef.current;
      if (!session?.active || !readyRef.current) return;
      const next = Math.max(0, Math.min(session.imageIds.length - 1, index));
      if (next === session.frameIndex) return;
      cancelActiveManipulations(session.viewport.element);
      session.frameIndex = next;
      readyRef.current = false;
      setBusy(true);
      setError(null);
      const load = displayFrame(session, next);
      session.pending.add(load);
      void load
        .then(() => {
          if (session.active) {
            setSlice(next);
            syncWindow();
            syncAnnotations();
          }
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
    },
    [syncAnnotations, syncWindow],
  );

  useEffect(() => {
    if (
      !navigationTarget ||
      busy ||
      handledNavigationRef.current === navigationTarget.requestId
    )
      return;
    const session = sessionRef.current;
    const region = annotations.find(
      (item) => item.id === navigationTarget.annotationId,
    );
    if (!session?.active || !readyRef.current || !region) return;
    const index = annotationFrameIndex(region, session.references);
    if (index >= 0) {
      handledNavigationRef.current = navigationTarget.requestId;
      navigate(index);
      propsRef.current.onSelectAnnotation(region.id);
    }
  }, [navigationTarget, series, annotations, busy, navigate]);
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

  function chooseTool(value: Tool) {
    toolRef.current = value;
    setTool(value);
  }
  function applyWindow(width: number, center: number) {
    const viewport = sessionRef.current?.viewport;
    if (
      !viewport ||
      !readyRef.current ||
      !Number.isFinite(width) ||
      !Number.isFinite(center) ||
      width <= 0
    )
      return;
    viewport.setProperties({
      voiRange: rangeFromWindow(
        width,
        center,
        viewport.getProperties().VOILUTFunction,
      ),
    });
    viewport.render();
    syncWindow();
  }
  function resetWindow() {
    const viewport = sessionRef.current?.viewport;
    if (!viewport || !readyRef.current) return;
    viewport.resetProperties();
    viewport.render();
    syncWindow();
  }
  function resetView() {
    const viewport = sessionRef.current?.viewport;
    if (!viewport || !readyRef.current) return;
    viewport.resetCamera();
    viewport.resetProperties();
    viewport.render();
    syncWindow();
  }
  function toggleAnnotations() {
    visibleRef.current = !showAnnotations;
    setShowAnnotations(!showAnnotations);
    syncAnnotations();
  }
  const canFlag =
    !!sessionRef.current?.references[slice] && annotations.length < 1000;

  return (
    <div className="dicom-viewer">
      <div className="dicom-toolbar" role="toolbar" aria-label="Image controls">
        {(
          [
            ["window", "Window / level"],
            ["pan", "Pan"],
            ["zoom", "Zoom"],
            ["flag", "Flag Region"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tool === value ? "active" : ""}
            aria-pressed={tool === value}
            disabled={
              busy ||
              !series ||
              !!error ||
              (value === "flag" && (!canFlag || !showAnnotations))
            }
            onClick={() => chooseTool(value)}
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
        <button
          type="button"
          aria-pressed={showAnnotations}
          onClick={toggleAnnotations}
        >
          {showAnnotations ? "Hide annotations" : "Show annotations"}
        </button>
        <button
          type="button"
          disabled={!selectedAnnotationId}
          onClick={() => {
            const next = propsRef.current.annotations.filter(
              (item) => item.id !== selectedAnnotationId,
            );
            propsRef.current.onAnnotationsChange(next);
            propsRef.current.onSelectAnnotation(undefined);
          }}
        >
          Delete selected region
        </button>
      </div>
      <div
        className="dicom-toolbar window-controls"
        role="group"
        aria-label="Window and level values"
      >
        <label>
          Window width
          <input
            type="number"
            aria-label="Window width"
            min="1"
            step="1"
            value={windowValues ? Number(windowValues.width.toFixed(2)) : ""}
            disabled={busy || !!error || !windowValues}
            onChange={(event) =>
              applyWindow(Number(event.target.value), windowValues?.center ?? 0)
            }
          />
        </label>
        <label>
          Window center
          <input
            type="number"
            aria-label="Window center"
            step="1"
            value={windowValues ? Number(windowValues.center.toFixed(2)) : ""}
            disabled={busy || !!error || !windowValues}
            onChange={(event) =>
              applyWindow(windowValues?.width ?? 1, Number(event.target.value))
            }
          />
        </label>
        <button
          type="button"
          disabled={busy || !!error || !windowValues}
          onClick={resetWindow}
        >
          Reset Window/Level
        </button>
        {!windowValues && (
          <span className="small">
            Window/level values unavailable until a supported frame is
            displayed.
          </span>
        )}
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
            height: "clamp(320px,52vh,610px)",
            minHeight: 320,
            width: "100%",
            touchAction: "none",
            cursor: tool === "pan" ? "grab" : "crosshair",
          }}
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              !readyRef.current ||
              error ||
              tool === "flag"
            )
              return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerMove={(event) => {
            const previous = dragRef.current,
              viewport = sessionRef.current?.viewport;
            if (
              !previous ||
              !viewport ||
              !readyRef.current ||
              error ||
              tool === "flag"
            )
              return;
            const dx = event.clientX - previous.x,
              dy = event.clientY - previous.y;
            dragRef.current = { x: event.clientX, y: event.clientY };
            if (tool === "pan") {
              const pan = viewport.getPan();
              viewport.setPan([pan[0] + dx, pan[1] + dy]);
            } else if (tool === "zoom")
              viewport.setZoom(
                Math.max(
                  0.1,
                  Math.min(20, viewport.getZoom() * Math.exp(-dy / 150)),
                ),
              );
            else {
              const range = viewport.getProperties().voiRange;
              if (!range) return;
              const values = windowFromRange(
                range,
                viewport.getProperties().VOILUTFunction,
              );
              const width = Math.max(1, values.width),
                center = values.center,
                scale = Math.max(width / 250, 0.1);
              applyWindow(Math.max(1, width + dx * scale), center + dy * scale);
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
        Scroll to change frame. Select Flag Region to draw, select, move, or
        resize a manual rectangle. Other tools: select, then drag.{" "}
        {!canFlag && !busy
          ? "Flagging requires complete study, series and image UIDs (maximum 1,000 regions)."
          : ""}{" "}
        Regions are manually created; no measurements or diagnostic detection.
      </p>
    </div>
  );
}
