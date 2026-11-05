import { eq } from "drizzle-orm";
import type { Database } from "../../db";
import { workOrderIntegrations } from "../../db/schema";
import type { GooglePort } from "./google";
import {
  type AppliedSpot,
  type DetectedSpot,
  type FieldMap,
  FieldsError,
  type FieldsFinder,
  fieldRequests,
  IMPORTANT_FIELDS,
  KNOWN_FIELDS,
  mappedValues,
  mergeSpots,
  parseFieldMap,
  patternSpots,
  plainText,
  planFields,
  sampleFields,
  TAG,
  templateTags,
} from "./template-fields";

const TEXT_LIMIT = 100_000;
const GOOGLE_DOC = "application/vnd.google-apps.document";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class GoogleSetupError extends Error {}

const docUrl = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

export function createGoogleSetup(deps: {
  db: Database;
  googleFor: (organizationId: string) => Promise<GooglePort | null>;
  finder?: FieldsFinder | null;
  starterTemplateId?: string | null;
  fetcher?: typeof fetch;
  now?: () => Date;
}) {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const fetcher = deps.fetcher ?? fetch;

  async function settings(organizationId: string) {
    const [row] = await db
      .select()
      .from(workOrderIntegrations)
      .where(eq(workOrderIntegrations.organizationId, organizationId))
      .limit(1);
    return row ?? null;
  }

  async function ready(organizationId: string, needs: { template?: boolean; folder?: boolean }) {
    const google = await deps.googleFor(organizationId);
    if (!google) throw new GoogleSetupError("Connect Google Drive first");
    const row = await settings(organizationId);
    if (needs.template && !row?.googleTemplateId) {
      throw new GoogleSetupError("Choose a template first");
    }
    if (needs.folder && !row?.googleDocumentsFolderId) {
      throw new GoogleSetupError("Choose the folder for the filled documents first");
    }
    return {
      google,
      templateId: row?.googleTemplateId ?? "",
      folderId: row?.googleDocumentsFolderId ?? "",
      map: parseFieldMap(row?.googleFieldMap),
    };
  }

  async function saveTemplate(
    organizationId: string,
    actorId: string,
    templateId: string,
    map?: FieldMap,
  ) {
    await db
      .update(workOrderIntegrations)
      .set({
        googleTemplateId: templateId,
        ...(map ? { googleFieldMap: JSON.stringify(map) } : {}),
        googleLastError: null,
        updatedBy: actorId,
        updatedAt: now(),
      })
      .where(eq(workOrderIntegrations.organizationId, organizationId));
  }

  return {
    scan: async (organizationId: string, input: { detect: boolean }) => {
      const { google, templateId, map } = await ready(organizationId, { template: true });
      const doc = await google.read(templateId);
      const tags = templateTags(doc).map(({ tag, count }) => ({
        tag,
        count,
        known: tag in KNOWN_FIELDS,
        mapping: map[tag] ?? null,
      }));
      const filled = new Set<string>();
      for (const t of tags) {
        if (t.known && !t.mapping) filled.add(t.tag);
        if (t.mapping?.kind === "field") filled.add(t.mapping.field);
      }
      let spots: DetectedSpot[] = [];
      let aiUsed = false;
      if (input.detect) {
        const pattern = patternSpots(doc);
        const ai = deps.finder ? await deps.finder(doc) : [];
        aiUsed = !!deps.finder;
        spots = mergeSpots(pattern, ai);
      }
      return {
        templateName: doc.title,
        tags,
        missing: IMPORTANT_FIELDS.filter((field) => !filled.has(field)),
        spots,
        aiUsed,
        text: plainText(doc).slice(0, TEXT_LIMIT),
      };
    },

    saveFieldMap: async (organizationId: string, actorId: string, input: FieldMap) => {
      const clean: FieldMap = {};
      for (const [tag, mapping] of Object.entries(input)) {
        if (!TAG.test(tag)) throw new GoogleSetupError(`{{${tag}}} isn't a valid tag`);
        if (mapping.kind === "field") {
          if (!(mapping.field in KNOWN_FIELDS)) {
            throw new GoogleSetupError(`${mapping.field} isn't a known field`);
          }
          if (mapping.field === tag) continue;
        }
        clean[tag] = mapping;
      }
      if (!(await settings(organizationId))) {
        throw new GoogleSetupError("Choose a template first");
      }
      await db
        .update(workOrderIntegrations)
        .set({ googleFieldMap: JSON.stringify(clean), updatedBy: actorId, updatedAt: now() })
        .where(eq(workOrderIntegrations.organizationId, organizationId));
      return clean;
    },

    preview: async (organizationId: string) => {
      const { google, templateId, folderId, map } = await ready(organizationId, {
        template: true,
        folder: true,
      });
      const custom = Object.fromEntries(
        Object.entries(map).flatMap(([tag, m]) =>
          m.kind === "ask" ? [[tag, `[${m.label}]`]] : [],
        ),
      );
      const { values } = mappedValues({ fields: sampleFields(), map, custom });
      const template = await google.file(templateId);
      const copy = await google.copy(templateId, {
        name: `Preview: ${template.name}`,
        parentId: folderId,
      });
      await google.fill(copy.id, values);
      return { url: copy.webViewLink ?? docUrl(copy.id) };
    },

    applyFields: async (organizationId: string, actorId: string, spots: AppliedSpot[]) => {
      const { google, templateId, folderId, map } = await ready(organizationId, {
        template: true,
        folder: true,
      });
      const original = await google.read(templateId);
      try {
        planFields(original, spots);
      } catch (error) {
        if (error instanceof FieldsError) throw new GoogleSetupError(error.message);
        throw error;
      }
      const copy = await google.copy(templateId, {
        name: `${original.title || "Template"} (MultiAgency fields)`,
        parentId: folderId,
      });
      const plan = planFields(await google.read(copy.id), spots);
      const requests = fieldRequests(plan);
      await google.edit(copy.id, requests.ranged);
      await google.edit(copy.id, requests.global);
      const next = { ...map, ...plan.map };
      await saveTemplate(organizationId, actorId, copy.id, next);
      return { url: copy.webViewLink ?? docUrl(copy.id), templateId: copy.id };
    },

    starterAvailable: !!deps.starterTemplateId,

    copyStarter: async (organizationId: string, actorId: string) => {
      const starter = deps.starterTemplateId;
      if (!starter) throw new GoogleSetupError("No starter template is set up on this server");
      const { google, folderId } = await ready(organizationId, { folder: true });
      const name = "MultiAgency work order template";
      let created: Awaited<ReturnType<GooglePort["copy"]>>;
      try {
        created = await google.copy(starter, { name, parentId: folderId });
      } catch {
        const response = await fetcher(
          `https://docs.google.com/document/d/${encodeURIComponent(starter)}/export?format=docx`,
          { signal: AbortSignal.timeout(20_000) },
        );
        if (!response.ok) {
          throw new GoogleSetupError(
            "Couldn't read the starter template: it must be shared as Anyone with the link can view",
          );
        }
        created = await google.upload({
          folderId,
          name,
          bytes: new Uint8Array(await response.arrayBuffer()),
          mimeType: DOCX,
          convertTo: GOOGLE_DOC,
        });
      }
      await saveTemplate(organizationId, actorId, created.id);
      return { url: created.webViewLink ?? docUrl(created.id), templateId: created.id };
    },
  };
}

export type GoogleSetup = ReturnType<typeof createGoogleSetup>;
