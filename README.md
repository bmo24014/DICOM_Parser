# Shoulder MRI Workspace

A local-first educational research prototype for shoulder MRI review and editable structured reports. **In development — Not for clinical use.** No diagnostic AI, cloud inference, or automatic pathology detection is implemented.

## Run locally

Use Node.js 24 (see `.nvmrc`; minimum 22.12) and npm. From this repository:

```sh
npm ci
npm run dev
```

Open Vite's local address and select **Open Workspace**. No account, backend, PACS, database, or SCOPE-MRI files are needed for demo context and reporting. The development server binds to loopback. Stop it with Ctrl+C.

```sh
npm run build
npm run preview
```

## Workflow

1. **Import images:** unzip downloaded archives first. Choose **Local DICOM import**, then **Select folder** or **Select DICOM files**. Select a study and series. File selection never changes the report's fictional context or associates it with that study automatically.
2. **Enter context:** edit the fictional/de-identified case identifier, history, indication, summary, and notes. Context is simulated, imported, or manually entered; editing marks it manual. Keep the fictional checkbox accurate. No values are inferred from images.
3. **Associate deliberately:** in **A. Examination information**, review the selected study UID, verify the context/report match, check the confirmation, and choose **Confirm study association**. Changing selected studies does not move an association. Imported saved references must be rechecked in the current session.
4. **Review images:** use previous/next, the frame slider, or wheel. Choose pan, zoom, or window/level and drag. Numeric window width/center inputs track the viewport; **Reset Window/Level** restores image defaults without resetting zoom/pan. **Reset view** restores camera and display defaults. Pixel source files remain unchanged.
5. **Flag regions:** choose **Flag Region**, then drag a rectangle on the displayed image. Rectangles are explicitly manual and show no quantitative measurements. Use the same tool to select a rectangle and drag its corners or outline to edit it. Use **Hide annotations / Show annotations** and **Delete selected region**, or delete from the reporting panel.
6. **Document:** edit the eight report sections. Findings are organized under rotator cuff, long head of biceps, labrum, AC joint, glenohumeral joint/cartilage, bones/marrow, and other soft tissues. Add/remove findings and numbered impression statements. No diagnostic content is generated.
7. **Connect images and findings:** in **G. Image annotations**, edit descriptions and link a region to a finding. **Show region** or **Show linked region** navigates to the matching study/series/SOP/frame if its files are loaded. Missing images produce an error without deleting saved regions.
8. **Export:** **Export PDF** downloads a readable report; **Save Draft (JSON)** preserves all editable fields and region geometry. **Import JSON** replaces the current draft, so save it first.

Context, report edits, original file handles, and annotations stay in browser memory. Switching slices, series, or the overview preserves report data. Refreshing or closing the page loses unsaved edits. Reimport image files after reopening a JSON draft; images are not embedded in it.

## Reports and compatibility

The report contains examination information, clinical history/indication, technique, comparison, anatomical findings, numbered impressions, manual region references, and draft/user-reviewed status. A user-reviewed label is a workflow marker, not formal clinical approval or a physician signature.

- JSON schema 2 preserves the original fields and new report sections. Original schema 1 drafts are strictly validated and migrated without losing text, findings, source labels, identifiers, or stored study references. Legacy findings enter **Other soft tissues** rather than inferring their anatomy.
- Reports are limited to 1,000,000 UTF-8 bytes, 1,000 findings,1,000 annotations, and 1,000 impression statements. Malformed files, unsupported schemas, invalid coordinates/references, duplicate IDs, and dangling finding links are rejected with an error. Deleting a linked finding removes its links while preserving the regions.
- Manual regions store four Cornerstone world-coordinate corners, viewing plane, description, linked finding, study/series/SOP UIDs, and one-based frame number. Saved stack index is descriptive; navigation resolves stable SOP/frame identity. Imported image bytes are never serialized.
- PDF and JSON use the same current validated report snapshot. PDF includes unavailable fields as **Not provided.**, all authored report sections, source/review labels, and manual annotation references/descriptions. It paginates long text and includes the research disclaimer on each page.
- PDF is a **static printable document, not a fillable form**. Keep JSON for continued editing. PDF edits do not synchronize with the application. The bundled DejaVu font supports many scripts; unsupported characters produce an explicit export error rather than silently dropping text. JSON preserves Unicode text.
- Neither JSON nor PDF is a standards-compliant DICOM Structured Report. DICOM SR / TID 1500 is future work.

## DICOM support and limitations

Cornerstone3D performs real pixel decoding/rendering. Native Cornerstone RectangleROI tools keep outlines aligned through zoom, pan, and viewport resize. Annotations remain on their original image/frame during slice navigation and are restored from JSON when matching files are loaded. Only rectangles are implemented in this milestone; no ellipses, AI heatmaps, or automated localization.

Import accepts DICOM Part 10 image files with a `DICM` header, including extensionless files. ZIP archives, DICOMDIR catalogs, raw datasets without that header, NIfTI files, and non-image objects are unsupported. Up to 2,000 files and 512 MiB may be selected per import. Import one series at a time if needed.

Files are grouped by study/series UIDs and ordered by InstanceNumber. Missing grouping UIDs are handled conservatively. Flagging requires valid study, series, and SOP instance UIDs; the toolbar explains missing references. This is a simple image stack, not a validated spatial reconstruction. Enhanced MRI geometry, all transfer syntaxes, and all browsers are not verified. Decoder errors preserve the report and allow trying another frame/series.

The project owner reports successful review of a real 96-image SCOPE-MRI series in the original viewer. Those files are not available in this checkout, so the new controls/ROI workflow is tested using original synthetic uncompressed DICOM patterns, not revalidated against that real study. These checks establish software behavior, not clinical accuracy.

## Privacy and data sources

Use only permitted, appropriately de-identified research data. Do not enter real patient identifiers or PHI. This app does not anonymize DICOM metadata or detect identifying content. It has no authentication, clinical audit trail, or persistence service.

All DICOM decoding, annotations, reports, PDF generation, and JSON handling occur locally in the browser. There are no application uploads, third-party telemetry, or cloud APIs. The app serves fonts, codecs, and workers locally; installation requires access to the npm registry.

SCOPE-MRI is an external research dataset. Access, license, and use restrictions remain the dataset user's responsibility; the app neither requires access nor bypasses access controls. Do not commit datasets, patient data, exported reports, or credentials. Root `data/`, `datasets/`, `sample-data/` and DICOM filename extensions are ignored, but this cannot identify every sensitive filename. No imaging datasets are redistributed. Synthetic browser test patterns are generated in memory by `e2e/syntheticDicom.ts`.

Dependency notices remain in installed packages. The bundled DejaVuSans font and its redistribution terms are in `src/assets/DejaVuSans-LICENSE.txt`.

## Architecture

| Module                                     | Responsibility                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `src/App.tsx`                              | Workspace session, local imports, explicit association, navigation, export actions |
| `src/components/ClinicalContextEditor.tsx` | Editable context and recorded provenance                                           |
| `src/components/ReportEditor.tsx`          | Structured sections, anatomical findings, impression, region descriptions/links    |
| `src/components/DicomViewer.tsx`           | Existing decoder/viewport, display controls, native manual rectangle integration   |
| `src/domain.ts` / `src/data/reports.ts`    | Versioned model, validation, lossless legacy migration and serialization           |
| `src/data/annotations.ts`                  | Stable image/frame references and annotation lookup                                |
| `src/data/pdf.ts`                          | Locally generated multi-page PDF from validated report data                        |
| `src/data/dicom.ts`                        | Metadata parsing, import bounds/grouping, immutable original File references       |
| `src/data/datasetMapping.ts`               | Explicit study-label adapter boundary; labels never create localization overlays   |
| `src/data/aiSuggestions.ts`                | Future integration interface; no AI implementation or network calls                |

## Validation

```sh
npm test
npm run lint
npm run build
```

Browser tests require Chromium:

```sh
npx playwright install chromium
npm run test:e2e
```

In the cloud environment, existing Chromium can be used:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
```

The browser suite covers context/report editing, JSON value equality and legacy migration, explicit association, paginated PDF download, DICOM rendering and existing controls, manual ROI creation/editing/deletion/visibility, frame isolation, native outline transforms, linked navigation, and JSON restoration. It starts or reuses a local Vite server. For a production check, stop any existing server on port 5173, run the build, then:

```sh
PLAYWRIGHT_USE_PREVIEW=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
```

Cornerstone/codec builds are substantial and cold startup/build can take time. Browser tests allow 90 seconds for cold initialization. Build warnings about optional Node-only codec/XML branches and large lazy chunks remain; browser functionality must be verified separately from compilation. `npm run format` formats source files.

### Checks completed for this update

A frozen `npm ci`, TypeScript/production build, ESLint, and all **68 unit tests** pass. All **8 browser tests** pass in development and against the production preview, including native rectangle geometry editing and restoration. PDF text extraction verifies the latest authored values and the long-history tail across an **8-page** report. The wider-screen reporting panel scrolls independently beside the image; narrow screens retain a single-column layout.

Fillable PDF forms are deliberately deferred. The current PDF is reliable and printable; JSON preserves complete editing. Real SCOPE-MRI files are not bundled or available for repeat testing in this environment, so test the new workflow with your permitted local series before relying on dataset-specific compatibility.
