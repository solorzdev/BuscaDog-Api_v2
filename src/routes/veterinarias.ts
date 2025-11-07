import { Router } from 'express';
import { dbQuery } from '../db.js';  // 👈 importante: .js

const router = Router();

function num(v: any, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw Object.assign(new Error(`Parámetro inválido: ${name}`), { status: 400 });
  return n;
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** GET /api/v1/veterinarias/agg?s=&w=&n=&e=&precision=&limit= */
router.get('/agg', async (req, res) => {
  try {
    const s = num(req.query.s, 's');
    const w = num(req.query.w, 'w');
    const n = num(req.query.n, 'n');
    const e = num(req.query.e, 'e');
    let precision = Number(req.query.precision ?? 2);
    let limit     = Number(req.query.limit ?? 1200);

    if (!Number.isInteger(precision)) throw Object.assign(new Error('precision debe ser entero'), { status: 400 });
    precision = clamp(precision, 0, 6);
    limit     = clamp(limit, 50, 10_000);

    const rows = await dbQuery(
      `
      SELECT 
        lat             AS lat,
        lon             AS lng,     -- lon -> lng
        total::int      AS count    -- total -> count
      FROM public.veterinarias_agrupadas_bbox($1,$2,$3,$4,$5,$6);
      `,
      [s, w, n, e, precision, limit]
    );

    res.json(rows);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? 'error' });
  }
});

/** GET /api/v1/veterinarias?bbox=s,w,n,e&limit= */
router.get('/', async (req, res) => {
  try {
    const bbox = (req.query.bbox as string | undefined)?.split(',');
    if (!bbox || bbox.length !== 4) throw Object.assign(new Error('bbox requerido como "s,w,n,e"'), { status: 400 });

    const s = num(bbox[0], 'bbox.s');
    const w = num(bbox[1], 'bbox.w');
    const n = num(bbox[2], 'bbox.n');
    const e = num(bbox[3], 'bbox.e');

    let limit = Number(req.query.limit ?? 800);
    limit = clamp(limit, 50, 5_000);

    const rows = await dbQuery(
      `
      SELECT
        id,
        nombre,
        lat     AS latitud,    -- lat -> latitud
        lon     AS longitud,   -- lon -> longitud
        municipio,
        codigo_postal
      FROM public.veterinarias_detalle_bbox($1,$2,$3,$4,$5);
      `,
      [s, w, n, e, limit]
    );

    res.json(rows);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? 'error' });
  }
});

export default router;
