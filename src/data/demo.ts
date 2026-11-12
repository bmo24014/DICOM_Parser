import type { Report } from "../domain";

/** Entirely fictional teaching content; no images or image-derived claims. */
export const demoReport: Report = {
  schemaVersion: 3,
  id: "fictional-shoulder-demo",
  clinicalContext: {
    id: "fictional-context-01",
    fictional: true,
    caseIdentifier: "Fictional case 01",
    provenance: "simulated",
    indication: "",
    notes: "",
    summaryProvenance: { origin: "manual" },
    history:
      "Fictional scenario: an adult describes six months of right shoulder discomfort " +
      "during overhead activity. No prior surgery is described. This history was " +
      "written for a software demonstration and does not describe a real person.",
    summary:
      "Manually authored fictional summary: persistent right shoulder discomfort " +
      "with overhead activity. Imaging has not been reviewed. No diagnosis is inferred.",
  },
  examination: { type: "", laterality: "unspecified", date: "" },
  technique: { acquisition: "", contrast: "" },
  comparison: "",
  impression: [],
  status: "draft",
  annotations: [],
  findings: [
    {
      id: "demo-finding-01",
      category: "Rotator cuff",
      structure: "Supraspinatus tendon",
      observation:
        "Simulated teaching entry: document tendon appearance after image review.",
      laterality: "right",
      note: "Example text only. No DICOM image has been assessed.",
      reviewStatus: "draft",
      source: "simulated",
    },
    {
      id: "demo-finding-02",
      category: "Glenohumeral joint and cartilage",
      structure: "Glenohumeral joint",
      observation:
        "Simulated teaching entry: add an observation after image review.",
      laterality: "right",
      reviewStatus: "draft",
      source: "simulated",
    },
  ],
};
