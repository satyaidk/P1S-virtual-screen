/**
 * Print-history entry as the browser sees it (from GET /api/bambu/tasks). Shared by the server
 * (which builds it from Bambu Cloud "tasks") and the display.
 */
export interface PublicTask {
  id: string;
  /** Print profile / plate title as Bambu stores it (e.g. "Cardboard Spool"). */
  title: string;
  /** MakerWorld model name, when the print came from a MakerWorld design. */
  designTitle: string | null;
  /** Same-origin URL of the cover (sliced plate preview), or null when the task has none. */
  cover: string | null;
  status: "printing" | "finished" | "failed" | "unknown";
  plateIndex: number | null;
  /** ISO timestamps as Bambu reports them. */
  startTime: string | null;
  endTime: string | null;
  weightGrams: number | null;
  costTimeSeconds: number | null;
}
