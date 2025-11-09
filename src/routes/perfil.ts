import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { dbQuery } from '../db.js';

// Upload de avatar
import multer from 'multer';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto';
const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars');

// =============================
// Helpers
// =============================
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

// Multer en memoria (buffer → sharp)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(jpeg|png|webp)/.test(file.mimetype);
    if (ok) cb(null, true);
    else cb(new Error('Formato no permitido (solo JPG, PNG o WEBP)'));
  },
});

// Captura y traduce errores de multer (no mandar 500 genérico)
function handleMulterErr(err: any, _req: Request, res: Response, next: NextFunction) {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Imagen demasiado grande (máx 5MB)' });
  }
  return res.status(415).json({ error: 'Archivo no permitido' });
}

// =============================
// GET /api/v1/usuarios/me
// =============================
router.get('/me', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Token inválido.' });

  try {
    const rows = await dbQuery(
      `SELECT u.id, u.correo, u.nombre_mostrar, u.nombre, u.apellidos,
              u.telefono, u.whatsapp, u.calle, u.numero_ext, u.numero_int,
              u.colonia, u.municipio, u.estado, u.codigo_postal, u.referencias,
              u.avatar_url, u.creado_en, u.actualizado_en,
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

    res.json({ user: rows[0] });
  } catch (err) {
    console.error('GET /usuarios/me error:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// =============================
// PATCH /api/v1/usuarios/me
// =============================
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
      if (dupe.length > 0) return res.status(409).json({ error: 'Ese correo ya está en uso' });
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
        avatar_url, creado_en, actualizado_en,
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

    return res.json({ user: { ...rows[0], rol_codigo: rol[0]?.rol_codigo ?? 'normal' } });
  } catch (err: any) {
    console.error('PATCH /usuarios/me error:', {
      code: err?.code, message: err?.message, detail: err?.detail, where: err?.where
    });
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// =============================
// POST /api/v1/usuarios/me/avatar
// =============================
router.post(
  '/me/avatar',
  (req, res, next) => upload.single('image')(req, res, (err) => handleMulterErr(err, req, res, next)),
  async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'Token inválido.' });
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo (campo "image").' });

    try {
      await fs.mkdir(AVATAR_DIR, { recursive: true });

      // Log útil
      console.log('📸 Subida de avatar', {
        userId,
        original: req.file.originalname,
        mime: req.file.mimetype,
        sizeKB: (req.file.size / 1024).toFixed(1),
      });

      const filename = `${userId}-${Date.now()}.webp`;
      const outPath  = path.join(AVATAR_DIR, filename);

      // Procesado y compresión
      const webp = await sharp(req.file.buffer)
        .rotate()
        .resize(512, 512, { fit: 'cover' })
        .webp({ quality: 85 })
        .toBuffer();

      await fs.writeFile(outPath, webp);

      // Base pública robusta (sin doble slash)
      const baseRaw = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
      const base = baseRaw.endsWith('/') ? baseRaw.slice(0, -1) : baseRaw;
      const publicUrl = `${base}/uploads/avatars/${filename}`;

      // Borrar avatar anterior si era local
      const prev = await dbQuery<{ avatar_url: string }>(
        'SELECT avatar_url FROM public.usuarios WHERE id = $1 LIMIT 1',
        [userId]
      );
      const oldUrl = prev[0]?.avatar_url ?? '';
      if (oldUrl.startsWith(`${base}/uploads/avatars/`)) {
        const rel = oldUrl.replace(`${base}/`, ''); // uploads/avatars/...
        const local = path.join(process.cwd(), rel);
        fs.unlink(local).catch(() => {});
      }

      await dbQuery(
        `UPDATE public.usuarios
           SET avatar_url = $1, actualizado_en = NOW()
         WHERE id = $2`,
        [publicUrl, userId]
      );

      console.log('✅ Avatar actualizado:', publicUrl);
      return res.json({ url: publicUrl });
    } catch (err: any) {
      console.error('❌ POST /usuarios/me/avatar', err?.message);
      if (String(err?.message).includes('unsupported image format')) {
        return res.status(415).json({ error: 'Formato de imagen no soportado.' });
      }
      return res.status(500).json({ error: 'No se pudo subir el avatar.' });
    }
  }
);

export default router;
