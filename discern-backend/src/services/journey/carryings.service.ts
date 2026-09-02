// Carryings: what someone is currently sitting with.
//
// THE SOFT CAP IS THE PRODUCT. Three active carryings, and adding a fourth
// prompts a release rather than silently making room. It is not a storage limit
// — released carryings are kept forever — it is the claim the app is making:
// you cannot dwell on ten things, and a list that grows without limit is a
// reading queue, which is the exact thing Discern exists not to be.
//
// Nothing here is auto-evicted. Choosing what to put down is part of the
// practice, and doing it for the user would remove the moment the rule exists to
// create.

import type { Carrying, CarryingsListResponse } from "@discern/shared";
import type { Types } from "mongoose";

import { env } from "../../config/env";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { parseReference } from "../../lib/reference";
import type { CarryingDocument } from "../../models";
import { CarryingModel, HymnModel, PassageModel } from "../../models";
import { recordSeedEvent } from "./seed.service";

async function hydrate(carrying: CarryingDocument): Promise<Carrying> {
  let reference: string | null = null;
  let text: string | null = null;

  if (carrying.kind === "passage") {
    const passage = await PassageModel.findById(carrying.refId)
      .select("reference searchText")
      .lean();
    reference = passage?.reference ?? null;
    text = passage?.searchText ?? null;
  } else {
    const hymn = await HymnModel.findById(carrying.refId)
      .select("title stanzas")
      .lean();
    reference = hymn?.title ?? null;
    text = hymn?.stanzas?.join("\n") ?? null;
  }

  return {
    id: String(carrying._id),
    kind: carrying.kind,
    refId: String(carrying.refId),
    reference,
    text,
    addedAt: carrying.addedAt.toISOString(),
    source: carrying.source,
    why: carrying.why,
    revisitCount: carrying.revisitCount,
    lastVisitedAt: carrying.lastVisitedAt
      ? carrying.lastVisitedAt.toISOString()
      : null,
    totalDwellSeconds: carrying.totalDwellSeconds,
    notes: carrying.notes.map((note) => ({
      text: note.text,
      at: note.at.toISOString(),
    })),
    releasedAt: carrying.releasedAt ? carrying.releasedAt.toISOString() : null,
  };
}

export async function listCarryings(
  userId: Types.ObjectId,
): Promise<CarryingsListResponse> {
  const all = await CarryingModel.find({ userId }).sort({ addedAt: -1 });

  const active = all.filter((c) => c.releasedAt === null);
  const released = all.filter((c) => c.releasedAt !== null);

  return {
    active: await Promise.all(active.map(hydrate)),
    released: await Promise.all(released.map(hydrate)),
    activeCap: env.ACTIVE_CARRYING_CAP,
    atCap: active.length >= env.ACTIVE_CARRYING_CAP,
  };
}

export interface AddCarryingInput {
  kind: "passage" | "hymn";
  /** A passage id or a reference like "Ephesians 2:8-10". */
  reference: string;
  source: "abigail" | "self";
  why?: string;
}

async function resolveRefId(input: AddCarryingInput): Promise<Types.ObjectId> {
  if (/^[0-9a-fA-F]{24}$/.test(input.reference)) {
    // Queried separately rather than through a union-typed variable: TypeScript
    // cannot call a method on a union of two Model types.
    const found =
      input.kind === "hymn"
        ? await HymnModel.findById(input.reference).select("_id").lean()
        : await PassageModel.findById(input.reference).select("_id").lean();
    if (found) return found._id as Types.ObjectId;
  }

  if (input.kind === "hymn") {
    const hymn = await HymnModel.findOne({ title: input.reference })
      .select("_id")
      .lean();
    if (!hymn) throw new NotFoundError(`No hymn named "${input.reference}".`);
    return hymn._id as Types.ObjectId;
  }

  // Throws ValidationError (400) on anything unparseable.
  const parsed = parseReference(input.reference);
  const passage = await PassageModel.findOne({ reference: parsed.canonical })
    .select("_id")
    .lean();

  if (!passage) {
    // An ad-hoc range is a legitimate thing to READ and not a legitimate thing
    // to carry: only stored passages can be returned by retrieval, revisited by
    // reference, or offered again later.
    throw new ValidationError(
      `"${parsed.canonical}" is not a stored passage, so it cannot be carried. ` +
        "Carry the pericope that contains it.",
      { requested: parsed.canonical },
    );
  }

  return passage._id as Types.ObjectId;
}

export async function addCarrying(
  userId: Types.ObjectId,
  input: AddCarryingInput,
): Promise<Carrying> {
  const activeCount = await CarryingModel.countDocuments({
    userId,
    releasedAt: null,
  });

  if (activeCount >= env.ACTIVE_CARRYING_CAP) {
    // 409, not 402. This is not a paywall and upgrading does not lift it — the
    // cap applies to everyone, forever, because it is the point rather than a
    // limitation.
    throw new ConflictError(
      `You are already carrying ${activeCount} things. Release one before adding another.`,
      {
        activeCount,
        activeCap: env.ACTIVE_CARRYING_CAP,
        reason: "active_carrying_cap_reached",
      },
    );
  }

  const refId = await resolveRefId(input);

  const existing = await CarryingModel.findOne({
    userId,
    kind: input.kind,
    refId,
    releasedAt: null,
  });

  if (existing) {
    throw new ConflictError("You are already carrying this.", {
      carryingId: String(existing._id),
    });
  }

  const carrying = await CarryingModel.create({
    userId,
    kind: input.kind,
    refId,
    source: input.source,
    why: input.why ?? null,
    addedAt: new Date(),
  });

  // NO SEED EVENT ON ADD. Deliberate, and central: acquiring is not practice.
  // If collecting earned anything, the incentive would point at exactly the
  // reading-queue behaviour the cap exists to prevent.

  return hydrate(carrying);
}

export interface UpdateCarryingInput {
  note?: string;
  dwellSeconds?: number;
  release?: boolean;
}

export async function updateCarrying(
  userId: Types.ObjectId,
  carryingId: string,
  input: UpdateCarryingInput,
): Promise<Carrying> {
  const carrying = await CarryingModel.findOne({ _id: carryingId, userId });

  if (!carrying) {
    throw new NotFoundError("No such carrying.");
  }

  if (input.note) {
    // Notes accumulate. They are never edited or removed — what someone thought
    // three months ago about a passage is the record this app is for.
    carrying.notes.push({ text: input.note, at: new Date() });
  }

  if (input.dwellSeconds) {
    carrying.totalDwellSeconds += input.dwellSeconds;
    carrying.revisitCount += 1;
    carrying.lastVisitedAt = new Date();
  }

  if (input.release && carrying.releasedAt === null) {
    // KEPT, NOT DELETED. Someone should be able to look at what they carried a
    // year ago.
    carrying.releasedAt = new Date();
  }

  await carrying.save();

  // Ledger writes happen AFTER the carrying is saved, and never block it.
  if (input.dwellSeconds) {
    await recordSeedEvent({
      userId,
      type: "dwell_time",
      weight: input.dwellSeconds,
      sourceId: carrying._id as Types.ObjectId,
    });
    await recordSeedEvent({
      userId,
      type: "revisit",
      weight: 1,
      sourceId: carrying._id as Types.ObjectId,
    });
  }

  return hydrate(carrying);
}
