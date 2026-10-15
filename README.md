# Shoulder MRI Workspace

An early-stage, local-first educational research prototype for reviewing shoulder MRI images alongside fictional clinical context and editable structured findings. **Research prototype · In development · Not for clinical use.** It does not diagnose, recommend treatment, detect pathology, or run diagnostic AI.

The current milestone works without SCOPE-MRI files, an account, a backend, or paid services. Demo mode includes fictional text and editable findings; no MRI image or diagnostic result is simulated.

## Run locally

Use Node.js 24 and npm 11 (the development environment versions). A modern desktop browser with WebGL support is recommended for image rendering.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, usually `http://127.0.0.1:5173`, and select **Open Workspace**. The server binds to loopback by default. Dependencies require internet access during installation; there is no account or cloud API configuration.

For a production build and local preview:

```sh
npm run build
npm run preview
```

## Use the workspace

1. **Demo mode:** read the explicitly fictional, manually authored history. Edit any sample finding, add or delete entries, and change laterality, source, review status, or the optional note. The samples are drafting prompts, not observations made from images.
2. **Keep your work:** select **Export JSON**. Changes stay in browser memory until exported; refreshing or closing the page loses them. Returning to the overview preserves edits within the same session. **Import JSON** replaces the current report, so export existing work first.
3. **Review local images:** choose multiple DICOM image files or a folder, including extensionless DICOM files. Files are grouped by study and series UIDs where available. Select the study and series, then use the frame controls, slider, or mouse wheel to navigate. Choose **Window / level**, **Pan**, or **Zoom** and drag with the left mouse button. **Reset view** restores the initial view. Files with missing UIDs are grouped conservatively rather than combined using names or descriptions.
4. **Keep context separate:** importing images does not associate the selected study with the fictional context or the existing findings. An imported report's study UID is an unverified reference, not proof that its contents match the images.

“Reviewed” is a user-set workflow label. It is not a clinical signature or an approval mechanism. Sources remain explicit: clinician entered, dataset label, or simulated. Imported context marked as non-fictional is preserved and shown as imported/unverified.

Report files use the application's versioned JSON schema, with strict field/type validation, a 1,000,000-byte limit, and at most 1,000 findings. Unsupported schema versions and unknown fields are rejected rather than silently discarded. **This JSON is not standards-compliant DICOM Structured Reporting.** DICOM SR / TID 1500 export is a future feature.

## Image support and current limits

- Genuine DICOM pixel decoding/rendering uses Cornerstone3D and its DICOM image loader. The dark empty viewport explicitly asks for an import when no images are available.
- Import accepts DICOM Part 10 image files with a `DICM` header and pixel data. ZIP archives, DICOMDIR catalogs, raw datasets without a Part 10 header, and non-image objects are not supported.
- Import is limited to 2,000 files and 512 MiB per selection to bound browser memory use. Import one series at a time if needed. Original local `File` objects and their bytes are retained without alteration.
- Instances are ordered by `InstanceNumber`; this is a simple review stack, not a validated spatial reconstruction. There is no multiplanar reconstruction, measurement tool, lesion localization, or diagnostic overlay.
- Multi-frame instances are expanded into the navigation stack; this does not imply full support for enhanced MRI geometry or metadata.
- Transfer-syntax and browser support vary. Decoder failures appear in the viewport; malformed files are skipped with import notes. Real shoulder MRI files and the full range of compressed/enhanced DICOM objects remain unverified.

No real MRI dataset is bundled. The automated browser test fixture is generated from original, nonanatomical pixel patterns in memory. It contains no patient information and verifies a narrow synthetic uncompressed DICOM path; it does not establish clinical validity or compatibility with real shoulder MRI acquisitions.

## Data sources, privacy, and licensing

SCOPE-MRI is an intended future research dataset. Its MIDRC download currently returns **401 Unauthorized according to the project owner's report**; access has not been obtained or independently verified here. The application does not attempt to bypass this restriction and does not require the dataset to run.

Use only data you are permitted to access and have appropriately de-identified before import. **Do not use real patient identifiers or other PHI in this prototype.** The app does not anonymize DICOM metadata or inspect it for identifying content. It has no authentication, clinical audit trail, or persistence service.

- Local DICOM files and report contents are handled in the browser, without application uploads, third-party telemetry, or cloud inference. The development server serves code and assets; it is not a data-upload service.
- Reports are downloaded only when you export them. Treat exported text and study UIDs as potentially sensitive; store and share them appropriately.
- Do not commit imaging datasets or exported reports. Root `data/`, `datasets/`, and `sample-data/` folders and `.dcm`/`.dicom` files are ignored; these patterns do not identify every possible data filename.
- No third-party imaging dataset is redistributed with the app. Imported datasets retain their source's access, license, and use restrictions. The synthetic test fixture is generated from simple original pixels, rather than copied from an external imaging collection.
- React, Cornerstone3D, and `dicom-parser` are free dependencies distributed under their respective MIT licenses. Their notices remain in the installed packages; dataset permission is a separate requirement.

## Architecture

The small setup is React + TypeScript + Vite, with no application backend, database, PACS server, or authentication system.

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Overview, session state, import/export controls, context, and findings editor |
| `src/domain.ts` | `Study`, `Series`, `DicomInstance`, `ClinicalContext`, `Finding`, and `Report` types |
| `src/components/DicomViewer.tsx` | Lazy-loaded Cornerstone viewport and image interactions |
| `src/data/dicom.ts` | Local metadata parsing, bounded import, UID grouping, and original-file references |
| `src/data/demo.ts` | Explicitly fictional history and simulated teaching entries |
| `src/data/reports.ts` | Strict JSON validation, serialization, and new finding creation |
| `src/data/datasetMapping.ts` | Future adapter boundary for explicitly supplied study-level dataset labels |
| `src/data/aiSuggestions.ts` | Interface for future clinician-reviewed clinical-summary suggestions; no implementation or network call |

Study-level annotation labels must remain text annotations. They do not supply lesion coordinates and must never be converted into localization overlays. No SCOPE-MRI schema, annotation mapping, or access is assumed by the current adapter. Future AI summaries and clinician-reviewed areas of interest require separate research, validation, and integration work.

## Validation

```sh
npm test
npm run lint
npm run build
```

Vitest tests cover report edits and JSON roundtrips, provenance, malformed/oversized imports, study-level annotation mapping, DICOM metadata grouping, and error handling.

Optional browser checks use Playwright. Install Chromium once, then run:

```sh
npx playwright install chromium
npm run test:e2e
```

If Chromium is already installed in the cloud environment, use its actual executable path instead:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
```

The browser suite starts its own local Vite server. Its synthetic DICOM checks supplement unit tests; they do not verify real MRI data, all transfer syntaxes, or clinical accuracy.

### Verified in this environment

A clean `npm ci` completed with Node 24.19.0 / npm 11.9.0. TypeScript + production build and ESLint passed; **32 unit tests** and **4 browser tests** passed. The browser suite passed against both a fresh development server and the production preview using installed Chromium. It checks edited JSON values, invalid imports, visible synthetic DICOM pixels, frame/wheel navigation, pan, zoom, window/level, draft retention, and recovery from a malformed compressed frame.

The build emits dependency warnings for optional Node-only codec/XML branches and a large lazy viewer chunk (about 3 MB before compression). The tested browser workflow works despite those warnings. Real MRI acquisitions, valid compressed image formats, enhanced MRI geometry, and clinical accuracy have not been validated.

To repeat the production browser checks, stop any existing server on port 5173, then run:

```sh
npm run build
PLAYWRIGHT_USE_PREVIEW=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
```

Code can be formatted with `npm run format`. The synthetic pixel-pattern generator lives in `e2e/syntheticDicom.ts`; no generated DICOM files or external imaging datasets are checked in.
