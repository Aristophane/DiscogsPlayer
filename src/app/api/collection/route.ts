/**
 * Collection paginée (§17.3, SPEC-GAPS G-15).
 * Renvoie des éditions logiques avec `instanceCount`, pas une tuile par exemplaire.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError } from '@/lib/api-error';
import { requestId } from '@/lib/logger';
import { requireUser } from '@/modules/auth/current-user';
import { parseSort } from '@/modules/collection/cursor';
import { listCollection } from '@/modules/collection/service';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  query: z.string().max(200).optional(),
  genres: z.array(z.string().max(80)).max(20).optional(),
  styles: z.array(z.string().max(80)).max(20).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const id = requestId(request.headers);

  try {
    const user = await requireUser();
    const url = new URL(request.url);

    const parsed = querySchema.safeParse({
      query: url.searchParams.get('query') ?? undefined,
      genres: url.searchParams.getAll('genres'),
      styles: url.searchParams.getAll('styles'),
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });

    if (!parsed.success) {
      throw new ApiError({
        code: 'COLLECTION_QUERY_INVALID',
        message: 'Les critères de recherche sont invalides.',
        status: 400,
      });
    }

    const result = await listCollection(user.id, {
      ...parsed.data,
      sort: parseSort(url.searchParams.get('sort')),
    });

    return NextResponse.json(result, {
      headers: { 'cache-control': 'no-store', 'x-request-id': id },
    });
  } catch (cause) {
    if (cause instanceof ApiError) {
      return cause.toResponse(id);
    }
    throw cause;
  }
}
