import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { dbQuery } from '../db.js';

import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto';
const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars');

/* ============================================================
   🔧 Helpers
============================================================ */
function getUserId(req: any): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const token = auth.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string | number };
    return String(payload.sub);
  } catch {
    return null;
  }
}

function baseUrl(req: Request): string {
  const env = process.env.PUBLIC_BASE_URL || '';
  if (env) return env.endsWith('/') ? env.slice(0, -1) : env;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  const host = req.get('host');
  return `${proto}://${host}`;
}

async function buildAvatarUrl(req: Request, userId: string): Promise<string | null> {
  const file = path.join(AVATAR_DIR, `${userId}.webp`);
  try {
    const st = await fs.stat(file);
    const v = Math.floor(st.mtimeMs);
    return `${baseUrl(req)}/uploads/avatars/${userId}.webp?v=${v}`;
  } catch {
    return null;
  }
}

/* ============================================================
   📸 Configuración de Multer
============================================================ */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1_000_000 }, // 1 MB
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(jpeg|png|webp|avif)/.test(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('Formato no permitido (JPG, PNG, WEBP o AVIF)'));
  },
});

function handleMulterErr(err: any, _req: Request, res: Response, next: NextFunction) {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Imagen demasiado grande (máx 1MB)' });
  }
  return res.status(415).json({ error: 'Archivo no permitido' });
}

/* ============================================================
   🧍 GET /api/v1/usuarios/me
============================================================ */
router.get('/me', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Token inválido.' });

  try {
    const rows = await dbQuery(
      `SELECT u.id, u.correo, u.nombre_mostrar, u.nombre, u.apellidos,
              u.telefono, u.whatsapp, u.calle, u.numero_ext, u.numero_int,
              u.colonia, u.municipio, u.estado, u.codigo_postal, u.referencias,
              u.creado_en, u.actualizado_en,
              COALESCE(r.codigo, 'normal') AS rol_codigo,
              CASE WHEN u.ubicacion IS NULL THEN NULL
                   ELSE json_build_object('lat', ST_Y(u.ubicacion), 'lng', ST_X(u.ubicacion))
              END AS ubicacion
         FROM public.usuarios u
    LEFT JOIN public.usuario_roles ur ON ur.usuario_id = u.id
    LEFT JOIN public.roles r ON r.id = ur.rol_id
        WHERE u.id = $1
        LIMIT 1;`,
      [userId]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: 'Usuario no encontrado' });

    const user = rows[0];
    user.avatar_url = await buildAvatarUrl(req, userId);

    res.json({ user });
  } catch (err) {
    console.error('GET /usuarios/me error:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

/* ============================================================
   ✏️ PATCH /api/v1/usuarios/me
============================================================ */
router.patch('/me', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Token inválido.' });

  const b = req.body ?? {};
  const lat = b.ubicacion?.lat ?? null;
  const lng = b.ubicacion?.lng ?? null;
  const rawEmail: string = (b.email ?? b.correo ?? '').trim();
  const correo = rawEmail === '' ? null : rawEmail;

  try {
    if (correo) {
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!re.test(correo)) return res.status(422).json({ error: 'Correo no válido' });

      const dupe = await dbQuery(
        `SELECT 1 FROM public.usuarios WHERE lower(correo)=lower($1) AND id<>$2 LIMIT 1`,
        [correo, userId]
      );
      if (dupe.length > 0)
        return res.status(409).json({ error: 'Ese correo ya está en uso' });
    }

    const rows = await dbQuery(
      `
      UPDATE public.usuarios SET
        nombre_mostrar = COALESCE(NULLIF($2,  ''), nombre_mostrar),
        nombre         = COALESCE(NULLIF($3,  ''), nombre),
        apellidos      = COALESCE(NULLIF($4,  ''), apellidos),
        correo         = COALESCE(NULLIF($5,  ''), correo),
        telefono       = COALESCE(NULLIF($6,  ''), telefono),
        whatsapp       = COALESCE(NULLIF($7,  ''), whatsapp),
        calle          = COALESCE(NULLIF($8,  ''), calle),
        numero_ext     = COALESCE(NULLIF($9,  ''), numero_ext),
        numero_int     = COALESCE(NULLIF($10, ''), numero_int),
        colonia        = COALESCE(NULLIF($11, ''), colonia),
        municipio      = COALESCE(NULLIF($12, ''), municipio),
        estado         = COALESCE(NULLIF($13, ''), estado),
        codigo_postal  = COALESCE(NULLIF($14, ''), codigo_postal),
        referencias    = COALESCE(NULLIF($15, ''), referencias),
        ubicacion = CASE
          WHEN $16::float8 IS NOT NULL AND $17::float8 IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint($17::float8, $16::float8), 4326)
          ELSE ubicacion
        END,
        actualizado_en = now()
      WHERE id = $1
      RETURNING
        id, correo, nombre_mostrar, nombre, apellidos,
        telefono, whatsapp, calle, numero_ext, numero_int,
        colonia, municipio, estado, codigo_postal, referencias,
        creado_en, actualizado_en,
        CASE WHEN ubicacion IS NULL THEN NULL
             ELSE json_build_object('lat', ST_Y(ubicacion), 'lng', ST_X(ubicacion))
        END AS ubicacion;
      `,
      [
        userId,
        b.nombre_mostrar ?? null,
        b.nombre ?? null,
        b.apellidos ?? null,
        correo,
        b.telefono ?? null,
        b.whatsapp ?? null,
        b.calle ?? null,
        b.numero_ext ?? null,
        b.numero_int ?? null,
        b.colonia ?? null,
        b.municipio ?? null,
        b.estado ?? null,
        b.codigo_postal ?? null,
        b.referencias ?? null,
        lat,
        lng,
      ]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: 'Usuario no encontrado.' });

    const rol = await dbQuery(
      `SELECT COALESCE(r.codigo,'normal') AS rol_codigo
         FROM public.usuario_roles ur
         LEFT JOIN public.roles r ON r.id = ur.rol_id
        WHERE ur.usuario_id = $1
        LIMIT 1;`,
      [userId]
    );

    const user = { ...rows[0], rol_codigo: rol[0]?.rol_codigo ?? 'normal' };
    user.avatar_url = await buildAvatarUrl(req, userId);

    return res.json({ user });
  } catch (err: any) {
    console.error('PATCH /usuarios/me error:', err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

/* ============================================================
   🖼️ POST /api/v1/usuarios/me/avatar
============================================================ */
router.post(
  '/me/avatar',
  (req, res, next) => upload.single('image')(req, res, (err) => handleMulterErr(err, req, res, next)),
  async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Token inválido.' });
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo (campo "image").' });

    try {
      await fs.mkdir(AVATAR_DIR, { recursive: true });

      const webp = await sharp(req.file.buffer)
        .rotate()
        .resize(512, 512, { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer();

      const finalPath = path.join(AVATAR_DIR, `${userId}.webp`);
      const tmpPath = `${finalPath}.tmp`;
      await fs.writeFile(tmpPath, webp);
      await fs.rename(tmpPath, finalPath);

      const st = await fs.stat(finalPath);
      const v = Math.floor(st.mtimeMs);

      const url = `${baseUrl(req)}/uploads/avatars/${userId}.webp?v=${v}`;
      console.log('✅ Avatar guardado:',
      { userId, finalPath, url });

      return res.json({ url, v });
    } catch (err: any) {
      console.error('POST /usuarios/me/avatar error:', err?.message);
      if (String(err?.message).includes('unsupported image format')) {
        return res.status(415).json({ error: 'Formato de imagen no soportado.' });
      }
      return res.status(500).json({ error: 'No se pudo subir el avatar.' });
    }
  }
);

export default router;
