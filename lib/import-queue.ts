// CSV import handoff: the import page stages rows in localStorage for the builder.
export const IMPORT_QUEUE_KEY = "igkit-import-queue";
export const IMPORT_ACCOUNT_KEY = "igkit-import-account";

export interface ImportRow {
  name: string;
  keywords: string[];
  dmMessage: string;
  publicReply: string;
  trackedUrl: string;
  openingDmMessage: string;
  openingDmButtonLabel: string;
}
