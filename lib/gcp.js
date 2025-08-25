import { env } from './env.js';
import { google } from 'googleapis';

function parseServiceAccount() {
  const raw = env.GCP_SA_KEY_JSON || '';
  if (!raw) return null;
  let text = raw.trim();
  if (text && !text.startsWith('{')) {
    try {
      text = Buffer.from(text, 'base64').toString();
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function getAuth(next_steps) {
  const key = parseServiceAccount();
  let email = env.GCP_SA_EMAIL || key?.client_email;
  if (!email) next_steps.push('Set GCP_SA_EMAIL');
  if (!key?.private_key) next_steps.push('Set GCP_SA_KEY_JSON');
  const scopes = env.GCP_SCOPES || 'https://www.googleapis.com/auth/cloud-platform';
  if (next_steps.length) return {};
  try {
    const client = new google.auth.JWT({
      email,
      key: key.private_key,
      scopes: scopes.split(/[\s,]+/).filter(Boolean),
    });
    const tokens = await client.authorize();
    let token_scope_ok = false;
    try {
      const r = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${tokens.access_token}`
      );
      if (r.ok) {
        const info = await r.json();
        const granted = (info.scope || '').split(' ');
        const required = scopes.split(' ');
        token_scope_ok = required.every((s) => granted.includes(s));
      }
    } catch {}
    return { client, accessToken: tokens.access_token, token_scope_ok, email };
  } catch {
    next_steps.push('Validate service account credentials');
    return {};
  }
}

async function ensureApi(token, project, service, next_steps) {
  const name = service.split('.')[0];
  try {
    const r = await fetch(
      `https://serviceusage.googleapis.com/v1/projects/${project}/services/${service}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    let enabled = data.state === 'ENABLED';
    if (!enabled) {
      const r2 = await fetch(
        `https://serviceusage.googleapis.com/v1/projects/${project}/services/${service}:enable`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        }
      );
      enabled = r2.ok;
      if (!enabled) next_steps.push(`Enable ${service} on ${project}`);
    }
    return { [name]: enabled };
  } catch {
    next_steps.push(`Enable ${service} on ${project}`);
    return { [name]: false };
  }
}

async function resolveProjectNumber(token, project, email, next_steps) {
  try {
    const r = await fetch(
      `https://cloudresourcemanager.googleapis.com/v1/projects/${project}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (r.status === 404) {
      next_steps.push('Check GCP_PROJECT_ID spelling or choose the correct project.');
      return null;
    }
    if (r.status === 403) {
      next_steps.push(
        `Grant roles/viewer and roles/servicemanagement.admin or roles/serviceusage.serviceUsageViewer|Admin to ${email} on ${project}; and ensure Cloud Resource Manager API is enabled.`
      );
      return null;
    }
    if (!r.ok) {
      next_steps.push(`Error fetching project (${r.status})`);
      return null;
    }
    const data = await r.json();
    return data.projectNumber;
  } catch {
    next_steps.push('Error fetching project');
    return null;
  }
}

export async function diagGcp() {
  const next_steps = [];
  const project = env.GCP_PROJECT_ID || '';
  if (!project) next_steps.push('Set GCP_PROJECT_ID');
  const auth = await getAuth(next_steps);
  const apis = { cloudresourcemanager: false, serviceusage: false };
  if (auth.accessToken && project) {
    Object.assign(
      apis,
      await ensureApi(auth.accessToken, project, 'cloudresourcemanager.googleapis.com', next_steps)
    );
    Object.assign(
      apis,
      await ensureApi(auth.accessToken, project, 'serviceusage.googleapis.com', next_steps)
    );
  }
  const projectNumber =
    auth.accessToken && project
      ? await resolveProjectNumber(auth.accessToken, project, auth.email, next_steps)
      : null;
  const ok =
    !!projectNumber &&
    apis.cloudresourcemanager &&
    apis.serviceusage &&
    auth.token_scope_ok &&
    next_steps.length === 0;
  return {
    ok,
    project,
    projectNumber,
    apis,
    token_scope_ok: !!auth.token_scope_ok,
    next_steps,
  };
}

export async function gcpAudit() {
  const next_steps = [];
  const project = env.GCP_PROJECT_ID || '';
  const auth = await getAuth(next_steps);
  const projectNumber =
    auth.accessToken && project
      ? await resolveProjectNumber(auth.accessToken, project, auth.email, next_steps)
      : null;
  if (!projectNumber) {
    return {
      project,
      projectNumber,
      enabled_count: 0,
      will_disable_count: 0,
      will_disable: [],
      error: { step: 'resolve_project_number', message: 'Failed to resolve project number' },
      next_steps,
    };
  }
  try {
    const r = await fetch(
      `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services?filter=state:ENABLED`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } }
    );
    if (!r.ok) {
      return {
        project,
        projectNumber,
        enabled_count: 0,
        will_disable_count: 0,
        will_disable: [],
        error: { step: 'list_services', http_code: r.status, message: await r.text() },
        next_steps,
      };
    }
    const data = await r.json();
    const services = (data.services || []).map((s) => s.name.replace('services/', ''));
    const allow = [
      'cloudresourcemanager.googleapis.com',
      'serviceusage.googleapis.com',
      'compute.googleapis.com',
      'iam.googleapis.com',
      'storage.googleapis.com',
    ];
    const will_disable = services.filter((s) => !allow.includes(s));
    const will_disable_count = will_disable.length;
    if (env.GCP_DO_DISABLE && will_disable_count) {
      const r2 = await fetch(
        `https://serviceusage.googleapis.com/v1/projects/${projectNumber}/services:batchDisable`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            serviceIds: will_disable,
            disableDependentServices: true,
          }),
        }
      );
      if (!r2.ok) {
        return {
          project,
          projectNumber,
          enabled_count: services.length,
          will_disable_count,
          will_disable,
          error: { step: 'batch_disable', http_code: r2.status, message: await r2.text() },
          next_steps,
        };
      }
    }
    return {
      project,
      projectNumber,
      enabled_count: services.length,
      will_disable_count,
      will_disable,
      error: null,
    };
  } catch (e) {
    return {
      project,
      projectNumber,
      enabled_count: 0,
      will_disable_count: 0,
      will_disable: [],
      error: { step: 'list_services', message: e.message },
      next_steps,
    };
  }
}
