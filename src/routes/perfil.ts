import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { dbQuery } from '../db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto';

/** 
 * Función auxiliar para obtener el ID de usuario desde el token JWT 
 */
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

/* =======================================================
   GET /api/v1/usuarios/me  →  Datos del perfil del usuario
========================================================= */
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
    console.error('Error /usuarios/me:', err);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

/* =======================================================
   PATCH /api/v1/usuarios/me  →  Actualiza el perfil
========================================================= */
router.patch('/me', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Token inválido.' });

  const b = req.body ?? {};
  const lat = b.ubicacion?.lat ?? null;
  const lng = b.ubicacion?.lng ?? null;

  // Acepta 'email' o 'correo'
  const rawEmail: string = (b.email ?? b.correo ?? '').trim();
  const correo = rawEmail === '' ? null : rawEmail;

  try {
    // Validación de correo (opcional, pero útil)
    if (correo) {
      const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!re.test(correo)) return res.status(422).json({ error: 'Correo no válido' });

      // unicidad case-insensitive
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

        -- ✅ Solo recalcula si vienen lat y lng; si no, conserva ubicacion
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

    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });

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

export default router;
