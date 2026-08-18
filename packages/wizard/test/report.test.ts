import { describe, expect, it } from "bun:test";
import { normalizeTurnReport, renderQuestions, renderTurnReport, turnReportSchema } from "../lib/report";
import { REPORT_FIXTURE } from "./fixtures";

describe("turnReportSchema", () => {
  it("requires only a summary and a status, so a quiet turn is still a valid one", () => {
    expect(turnReportSchema().required).toEqual(["summary", "status"]);
  });

  it("describes every part of the report the loop renders", () => {
    const properties = turnReportSchema().properties as Record<string, Record<string, unknown>>;
    for (const field of ["summary", "filesChanged", "decisions", "questions", "warnings", "status"]) {
      expect(properties[field]).toBeDefined();
    }
    expect(properties.status.enum).toEqual(["complete", "blocked"]);
  });

  it("leaves the object open, so a helpful extra field is not a parse failure", () => {
    expect(turnReportSchema().additionalProperties).toBeUndefined();
  });

  it("asks for questions only about genuine ambiguity", () => {
    const questions = (turnReportSchema().properties as Record<string, Record<string, unknown>>).questions;
    expect(String(questions.description)).toContain("genuine ambiguity");
  });
});

describe("normalizeTurnReport", () => {
  it("passes a complete report through intact", () => {
    const report = normalizeTurnReport(REPORT_FIXTURE, "");
    expect(report.summary).toBe("Added the provider.");
    expect(report.status).toBe("complete");
    expect(report.filesChanged).toHaveLength(2);
    expect(report.filesChanged[0]).toEqual({ path: "app/providers/specify.tsx", what: "creates the shared client" });
    expect(report.decisions).toHaveLength(1);
    expect(report.warnings).toEqual(["No CMP found — added a consent stub with a TODO."]);
    expect(report.questions).toEqual([]);
    expect(report.notes).toEqual([]);
  });

  it("falls back to the turn's own words when there is no structured report at all", () => {
    const report = normalizeTurnReport(null, "  I added the provider and wired consent.  ");
    expect(report.summary).toBe("I added the provider and wired consent.");
    expect(report.status).toBe("complete");
    expect(report.filesChanged).toEqual([]);
    expect(report.notes).toEqual([]);
  });

  it("says so when the turn reported nothing at all", () => {
    expect(normalizeTurnReport(null, "").notes[0]).toContain("said nothing");
  });

  it("prefers the report's summary over the turn's prose", () => {
    expect(normalizeTurnReport({ summary: "structured" }, "prose").summary).toBe("structured");
  });

  it("keeps a blocked status and drops any other value", () => {
    expect(normalizeTurnReport({ status: "blocked", summary: "s" }).status).toBe("blocked");
    expect(normalizeTurnReport({ status: "half-done", summary: "s" }).status).toBe("complete");
  });

  it("never throws on rubbish, whatever shape it arrives in", () => {
    for (const raw of [undefined, 7, "a string", [], { filesChanged: "not a list", questions: 3, warnings: {} }]) {
      expect(() => normalizeTurnReport(raw)).not.toThrow();
    }
    const report = normalizeTurnReport({ filesChanged: "not a list", questions: 3, warnings: {} }, "hello");
    expect(report.filesChanged).toEqual([]);
    expect(report.questions).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("drops list entries with nothing identifying in them", () => {
    const report = normalizeTurnReport({
      decisions: [{ why: "no decision named" }, { decision: "kept it small", why: "" }],
      filesChanged: [{ what: "no path" }, { path: "a.ts", what: "" }],
      questions: [{ context: "no question" }, { question: "Which container?" }],
      summary: "s",
      warnings: ["", "  ", "a real one"],
    });

    expect(report.filesChanged).toEqual([{ path: "a.ts", what: "" }]);
    expect(report.decisions).toEqual([{ decision: "kept it small", why: "" }]);
    expect(report.questions).toEqual([{ context: undefined, question: "Which container?" }]);
    expect(report.warnings).toEqual(["a real one"]);
  });
});

describe("renderTurnReport", () => {
  it("shows the summary, the files, the decisions and the warnings", () => {
    const rendered = renderTurnReport(normalizeTurnReport(REPORT_FIXTURE));
    expect(rendered).toContain("Added the provider.");
    expect(rendered).toContain("app/providers/specify.tsx — creates the shared client");
    expect(rendered).toContain("Put the client in a provider");
    expect(rendered).toContain("! No CMP found");
  });

  it("leaves the questions out, because they get their own block", () => {
    const rendered = renderTurnReport(
      normalizeTurnReport({ questions: [{ question: "Which ad slot?" }], summary: "done" }),
    );
    expect(rendered).not.toContain("Which ad slot?");
  });

  it("says plainly when the agent reports itself blocked", () => {
    expect(renderTurnReport(normalizeTurnReport({ status: "blocked", summary: "could not install" }))).toContain(
      "BLOCKED",
    );
  });

  it("renders an empty report as nothing, rather than an empty box", () => {
    expect(renderTurnReport(normalizeTurnReport({ summary: "" }, ""))).toContain("said nothing");
  });
});

describe("renderQuestions", () => {
  it("numbers the questions so an answer can name one", () => {
    const rendered = renderQuestions([
      { context: "there are two candidates", question: "Which slot should the ad go in?" },
      { question: "Is the cookie banner the real gate?" },
    ]);
    expect(rendered).toContain("1. Which slot should the ad go in?");
    expect(rendered).toContain("there are two candidates");
    expect(rendered).toContain("2. Is the cookie banner the real gate?");
  });
});
