import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  columnMappingSchema,
  commitImportSchema,
  type ColumnMapping,
  type ImportPreviewDTO,
  type ParsedRowDTO,
} from '@household/shared';
import { prisma } from '../prisma.js';
import { badRequest, notFound } from '../lib/errors.js';
import { transactionDedupeHash } from '../lib/crypto.js';
import { detectFormat } from '../services/import/formats.js';
import { applyMapping, readStatementFile, type TabularFile } from '../services/import/parse.js';
import { classify } from '../services/categorisation.js';
import { insertTransactions } from '../services/ledger.js';

const householdParams = z.object({ householdId: z.string() });
const batchParams = householdParams.extend({ batchId: z.string() });

/** Staged uploads are swept after this long if never committed. */
const STAGING_TTL_HOURS = 24;
const PREVIEW_SAMPLE_SIZE = 20;

interface StagedPayload {
  headers: string[];
  rows: string[][];
}

const importRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Step 1 — upload and preview.
   *
   * Nothing is written to the ledger here. The file is parsed, a format is
   * detected, and the result is staged so the user can correct the column
   * mapping before committing. Importing straight from an upload is how you
   * end up with a month of amounts off by a sign.
   */
  fastify.post('/:householdId/imports', async (request, reply) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');

    const upload = await request.file();
    if (!upload) throw badRequest('No file was uploaded');

    const buffer = await upload.toBuffer();
    if (buffer.length === 0) throw badRequest('The uploaded file is empty');

    const file = readStatementFile(upload.filename, buffer);
    const detection = detectFormat(file.headers, file.rows);

    const expiresAt = new Date();
    expiresAt.setUTCHours(expiresAt.getUTCHours() + STAGING_TTL_HOURS);

    const batch = await prisma.importBatch.create({
      data: {
        householdId,
        filename: upload.filename,
        detectedFormat: detection.format?.id ?? null,
        payload: { headers: file.headers, rows: file.rows } satisfies StagedPayload,
        rowCount: file.rows.length,
        expiresAt,
      },
      select: { id: true },
    });

    const preview = await buildPreview(householdId, batch.id, file, detection.mapping, {
      detectedFormat: detection.format?.label ?? null,
    });

    reply.status(201);
    return preview;
  });

  /** Step 2 — re-preview with a corrected mapping, still without writing. */
  fastify.post('/:householdId/imports/:batchId/preview', async (request) => {
    const { householdId, batchId } = batchParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');
    const mapping = columnMappingSchema.parse(request.body);

    const { batch, file } = await loadBatch(householdId, batchId);
    return buildPreview(householdId, batch.id, file, mapping, {
      detectedFormat: batch.detectedFormat,
    });
  });

  /** Step 3 — commit into the ledger. */
  fastify.post('/:householdId/imports/:batchId/commit', async (request) => {
    const { householdId, batchId } = batchParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');

    const body = commitImportSchema.parse({ ...(request.body as object), batchId });
    const { batch, file } = await loadBatch(householdId, batchId);

    if (batch.status === 'committed') {
      throw badRequest('This import has already been committed');
    }

    const account = await prisma.account.findFirst({
      where: { id: body.accountId, householdId },
      select: { id: true, currency: true },
    });
    if (!account) throw notFound('Account');

    const mapping = body.mapping ?? detectFormat(file.headers, file.rows).mapping;
    const parsed = applyMapping(file, mapping);

    const valid = parsed.filter((row) => row.error === undefined && row.date && row.amount != null);
    const failed = parsed.length - valid.length;

    const result = await insertTransactions(
      valid.map((row) => ({
        date: row.date!,
        valueDate: row.valueDate,
        amount: row.amount!,
        currency: row.currency ?? account.currency,
        description: row.description,
      })),
      {
        householdId,
        accountId: account.id,
        source: 'file_import',
        importBatchId: batch.id,
        includeDuplicates: body.includeDuplicates,
      },
    );

    await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: 'committed',
        accountId: account.id,
        committedAt: new Date(),
        importedCount: result.imported,
      },
    });

    return {
      batchId: batch.id,
      imported: result.imported,
      skippedDuplicates: result.skippedDuplicates,
      failed,
      categorised: result.categorised,
    };
  });

  fastify.delete('/:householdId/imports/:batchId', async (request) => {
    const { householdId, batchId } = batchParams.parse(request.params);
    await fastify.requireHousehold(request, householdId, 'member');

    const batch = await prisma.importBatch.findFirst({
      where: { id: batchId, householdId },
      select: { id: true, status: true },
    });
    if (!batch) throw notFound('Import');

    if (batch.status === 'committed') {
      // Undo a committed import by removing exactly the rows it created.
      const { count } = await prisma.transaction.deleteMany({ where: { importBatchId: batch.id } });
      await prisma.importBatch.update({
        where: { id: batch.id },
        data: { status: 'discarded' },
      });
      return { deleted: true, transactionsRemoved: count };
    }

    await prisma.importBatch.delete({ where: { id: batch.id } });
    return { deleted: true, transactionsRemoved: 0 };
  });

  fastify.get('/:householdId/imports', async (request) => {
    const { householdId } = householdParams.parse(request.params);
    await fastify.requireHousehold(request, householdId);

    const batches = await prisma.importBatch.findMany({
      where: { householdId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        filename: true,
        detectedFormat: true,
        status: true,
        rowCount: true,
        importedCount: true,
        createdAt: true,
        committedAt: true,
      },
    });

    return { imports: batches };
  });

  async function loadBatch(householdId: string, batchId: string) {
    const batch = await prisma.importBatch.findFirst({
      where: { id: batchId, householdId },
    });
    if (!batch) throw notFound('Import');

    const payload = batch.payload as unknown as StagedPayload;
    if (!payload?.headers || !payload?.rows) {
      throw badRequest('This upload is no longer readable. Upload the file again.');
    }

    return { batch, file: { headers: payload.headers, rows: payload.rows } as TabularFile };
  }

  /**
   * Builds the preview, including duplicate detection against what is already
   * in the ledger — re-uploading an overlapping statement is the normal case,
   * not the exception, so the user needs to see it before committing.
   */
  async function buildPreview(
    householdId: string,
    batchId: string,
    file: TabularFile,
    mapping: ColumnMapping,
    meta: { detectedFormat: string | null },
  ): Promise<ImportPreviewDTO> {
    const parsed = applyMapping(file, mapping);

    const hashes = parsed
      .filter((r) => r.date && r.amount != null)
      .map((r) =>
        transactionDedupeHash({ date: r.date!, amount: r.amount!, description: r.description }),
      );

    const existing = hashes.length
      ? await prisma.transaction.findMany({
          where: { householdId, dedupeHash: { in: hashes } },
          select: { dedupeHash: true },
        })
      : [];
    const existingHashes = new Set(existing.map((e) => e.dedupeHash));

    let duplicateCount = 0;
    const sample: ParsedRowDTO[] = [];
    const errors: { row: number; reason: string }[] = [];

    for (const row of parsed) {
      if (row.error) {
        errors.push({ row: row.row, reason: row.error });
        continue;
      }

      const hash = transactionDedupeHash({
        date: row.date!,
        amount: row.amount!,
        description: row.description,
      });
      const isDuplicate = existingHashes.has(hash);
      if (isDuplicate) duplicateCount += 1;

      if (sample.length < PREVIEW_SAMPLE_SIZE) {
        sample.push({
          row: row.row,
          date: row.date,
          amount: row.amount,
          description: row.description,
          balanceAfter: row.balanceAfter,
          suggestedCategorySlug: classify({
            description: row.description,
            amount: row.amount!,
          }).categorySlug,
          isDuplicate,
        });
      }
    }

    return {
      batchId,
      detectedFormat: meta.detectedFormat,
      mapping,
      headers: file.headers,
      rowCount: file.rows.length,
      sample,
      errors: errors.slice(0, 50),
      duplicateCount,
    };
  }
};

export default importRoutes;
