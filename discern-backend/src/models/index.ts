// Registering every model in one place means db/connect.ts:createDeclaredIndexes() sees
// all of them at boot, rather than whichever ones a request happened to import.

export * from "./author.model";
export * from "./book.model";
export * from "./carrying.model";
export * from "./conversation.model";
export * from "./message.model";
export * from "./hymn.model";
export * from "./passage.model";
export * from "./processed-webhook-event.model";
export * from "./safety-event.model";
export * from "./seed-event.model";
export * from "./stage.model";
export * from "./translation.model";
export * from "./cultivation-read.model";
export * from "./job.model";
export * from "./job-run.model";
export * from "./speech-usage.model";
export * from "./speech-cache.model";
export * from "./user.model";
export * from "./user-memory.model";
export * from "./user-stage.model";
export * from "./verse.model";

// THE JOURNAL IS IMPORTED FOR SIDE EFFECT AND DELIBERATELY NOT RE-EXPORTED.
//
// It has to be here so createDeclaredIndexes() sees its three indexes at boot, like every
// other model. It must NOT be `export *`, because that would make
// `import { JournalEntryModel } from "../models"` compile inside the prompt and
// retrieval code — and the promise that the journal never reaches Abigail is
// worth more as a type error than as a review comment. Import the model
// directly from "./journal-entry.model" in the two places allowed to.
import "./journal-entry.model";
