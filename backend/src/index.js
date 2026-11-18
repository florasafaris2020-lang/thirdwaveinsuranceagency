const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const CERTIFICATES = {
  TOR: ['Type C - Private Car', 'Type B - Commercial Vehicle'],
  TPO: [
    'Class A - PSV Unmarked', 'Type A - Taxi', 'Type B - Commercial Vehicle',
    'Type C - Private Car', 'Type D - Motor Cycle',
    'Type D – Motor Cycle Commercial', 'Type D - PSV'
  ],
  Comprehensive: [
    'Class A - PSV Unmarked', 'Type A - Taxi', 'Type B - Commercial Vehicle',
    'Type C - Private Car', 'Type D - Motor Cycle',
    'Type D – Motor Cycle Commercial', 'Type D - PSV'
  ]
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  });
  if (origin && origin === env.ALLOWED_ORIGIN) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function json(request, env, data, status = 200) {
  const headers = corsHeaders(request, env);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

function unauthorized(request, env) {
  return json(request, env, { success: false, message: 'Authentication required.' }, 401);
}

function authorized(request, env) {
  const expected = env.ADMIN_TOKEN;
  const provided = request.headers.get('Authorization') || '';
  return Boolean(expected && provided.startsWith('Bearer ') && provided.slice(7) === expected);
}

function text(form, key, label, max = 200) {
  const value = form.get(key);
  if (typeof value !== 'string') throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`${label} is required and must be at most ${max} characters.`);
  return normalized;
}

function checkFileSignature(bytes, mime) {
  if (mime === 'application/pdf') return bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  return false;
}

async function submitApplication(request, env) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_REQUEST_BYTES) return json(request, env, { success: false, message: 'Submission exceeds the 6 MB request limit.' }, 413);

  let form;
  try { form = await request.formData(); }
  catch { return json(request, env, { success: false, message: 'Expected a multipart form submission.' }, 400); }

  let data;
  let file;
  try {
    const insuredName = text(form, 'Insured_Name', 'Insured name');
    const coverageType = text(form, 'Coverage_Type', 'Coverage type', 30);
    const certificateType = text(form, 'Certificate_Type', 'Certificate type', 100);
    if (!CERTIFICATES[coverageType] || !CERTIFICATES[coverageType].includes(certificateType)) throw new Error('Invalid coverage and certificate selection.');
    const year = Number(text(form, 'Year_of_Manufacture', 'Year of manufacture', 4));
    if (!Number.isInteger(year) || year < 1900 || year > new Date().getUTCFullYear() + 1) throw new Error('Year of manufacture is invalid.');
    const sumText = form.get('Sum_Insured');
    const sumInsured = coverageType === 'Comprehensive' ? Number(sumText) : null;
    if (coverageType === 'Comprehensive' && (!Number.isFinite(sumInsured) || sumInsured <= 0)) throw new Error('A valid sum insured is required for Comprehensive cover.');
    const email = text(form, 'Email', 'Email address', 254);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email address is invalid.');
    const startDate = text(form, 'Start_Date', 'Start date', 10);
    const endDate = text(form, 'End_Date', 'End date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('Start date or end date is invalid.');

    file = form.get('Application_Documents');
    if (!(file instanceof File) || file.size === 0) throw new Error('Application document is required.');
    if (file.size > MAX_FILE_BYTES) return json(request, env, { success: false, message: 'Document exceeds the 5 MB limit.' }, 413);
    if (!ALLOWED_MIME.has(file.type)) throw new Error('Upload must be a PDF, JPG, or PNG document.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!checkFileSignature(bytes, file.type)) throw new Error('The uploaded file does not match its declared PDF, JPG, or PNG type.');

    const ext = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/jpeg' ? 'jpg' : 'png';
    data = {
      id: crypto.randomUUID(), createdAt: new Date().toISOString(), insuredName, coverageType, certificateType,
      vehicleNumber: text(form, 'Vehicle_Number', 'Vehicle number'),
      chassisNumber: text(form, 'Chassis_Number', 'Chassis number'),
      vehicleMake: text(form, 'Vehicle_Make', 'Vehicle make'),
      vehicleModel: text(form, 'Vehicle_Model', 'Vehicle model'),
      bodyType: text(form, 'Body_Type', 'Body type'), year,
      engineNumber: text(form, 'Engine_Number', 'Engine number'),
      insuredPin: text(form, 'Insured_PIN', 'Insured KRA PIN', 50), sumInsured,
      startDate, endDate, email, phoneNumber: text(form, 'Phone_Number', 'Phone number', 50),
      file, bytes, ext
    };
  } catch (error) {
    if (error instanceof Response) return error;
    return json(request, env, { success: false, message: error.message || 'Invalid submission.' }, 400);
  }

  const documentKey = `applications/${data.id}/${crypto.randomUUID()}.${data.ext}`;
  try {
    await env.DOCUMENTS.put(documentKey, data.bytes, {
      httpMetadata: { contentType: data.file.type, cacheControl: 'private, no-store' },
      customMetadata: { applicationId: data.id }
    });
    await env.DB.prepare(`INSERT INTO applications (
      id, created_at, status, insured_name, coverage_type, certificate_type, vehicle_number,
      chassis_number, vehicle_make, vehicle_model, body_type, year_of_manufacture,
      engine_number, insured_pin, sum_insured, start_date, end_date, email, phone_number,
      document_key, document_name, document_type, document_size
    ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(data.id, data.createdAt, data.insuredName, data.coverageType, data.certificateType,
        data.vehicleNumber, data.chassisNumber, data.vehicleMake, data.vehicleModel, data.bodyType,
        data.year, data.engineNumber, data.insuredPin, data.sumInsured, data.startDate, data.endDate,
        data.email, data.phoneNumber, documentKey, data.file.name.slice(0, 200), data.file.type, data.file.size)
      .run();
  } catch {
    await env.DOCUMENTS.delete(documentKey).catch(() => {});
    return json(request, env, { success: false, message: 'Could not save your application. Please try again later.' }, 500);
  }
  return json(request, env, { success: true, id: data.id, status: 'pending', message: 'Application received and is pending review.' }, 201);
}

async function adminRoute(request, env, url, path) {
  if (!authorized(request, env)) return unauthorized(request, env);
  if (request.method === 'GET' && path === '/api/admin/applications') {
    const status = url.searchParams.get('status') || 'pending';
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) return json(request, env, { success: false, message: 'Invalid status filter.' }, 400);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 100);
    const query = status === 'all'
      ? env.DB.prepare('SELECT * FROM applications ORDER BY created_at DESC LIMIT ?').bind(limit)
      : env.DB.prepare('SELECT * FROM applications WHERE status = ? ORDER BY created_at DESC LIMIT ?').bind(status, limit);
    const { results } = await query.all();
    return json(request, env, { success: true, applications: results || [] });
  }

  const documentMatch = path.match(/^\/api\/admin\/applications\/([0-9a-f-]+)\/document$/i);
  if (request.method === 'GET' && documentMatch) {
    const row = await env.DB.prepare('SELECT document_key, document_name, document_type FROM applications WHERE id = ?').bind(documentMatch[1]).first();
    if (!row) return json(request, env, { success: false, message: 'Application not found.' }, 404);
    const object = await env.DOCUMENTS.get(row.document_key);
    if (!object) return json(request, env, { success: false, message: 'Document not found.' }, 404);
    const headers = corsHeaders(request, env);
    headers.set('Content-Type', row.document_type);
    headers.set('Content-Disposition', `attachment; filename="${row.document_name.replace(/["\\\r\n]/g, '_')}"`);
    headers.set('Cache-Control', 'no-store');
    return new Response(object.body, { headers });
  }

  const appMatch = path.match(/^\/api\/admin\/applications\/([0-9a-f-]+)$/i);
  if (request.method === 'PATCH' && appMatch) {
    let body;
    try { body = await request.json(); } catch { return json(request, env, { success: false, message: 'Expected JSON.' }, 400); }
    if (!['approved', 'rejected'].includes(body.status)) return json(request, env, { success: false, message: 'Status must be approved or rejected.' }, 400);
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : null;
    const result = await env.DB.prepare('UPDATE applications SET status = ?, reviewed_at = ?, review_notes = ? WHERE id = ?')
      .bind(body.status, new Date().toISOString(), notes, appMatch[1]).run();
    if (!result.meta?.changes) return json(request, env, { success: false, message: 'Application not found.' }, 404);
    return json(request, env, { success: true, id: appMatch[1], status: body.status });
  }
  return json(request, env, { success: false, message: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (request.method === 'POST' && path === '/api/insurance-applications') return submitApplication(request, env);
    if (path.startsWith('/api/admin/')) return adminRoute(request, env, url, path);
    return json(request, env, { success: false, message: 'Not found.' }, 404);
  }
};
