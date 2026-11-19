// Tests du fix Vercel de /api/cities (resolveCitiesDir + vercel.json).
// Style : node:test + assert/strict, commentaires en français.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import handler from '../api/cities.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Fabrique un mock de res chaînable : setHeader, status -> res, end capture le body.
function mockRes() {
  const headers = {};
  const res = {
    headers,
    statusCode: null,
    body: null,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    end(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

test('GET /api/cities : 200 JSON avec la liste des villes (cwd du test)', async () => {
  const res = mockRes();
  // Le cwd du process de test est /workspace, donc data/cities est trouvé via process.cwd().
  await handler({}, res);

  assert.equal(res.statusCode, 200, `status attendu 200, reçu ${res.statusCode}`);
  assert.equal(res.headers['content-type'], 'application/json');
  assert.equal(res.headers['cache-control'], 'no-cache');

  const cities = JSON.parse(res.body); // body doit être un JSON parsable
  assert.ok(Array.isArray(cities), 'le body doit être un tableau JSON');
  assert.ok(cities.length > 0, 'la liste des villes ne doit pas être vide');

  const paris = cities.find((c) => c.id === 'paris');
  assert.ok(paris, 'la liste doit contenir une ville avec id "paris"');
  assert.equal(paris.name, 'Paris');
  assert.ok(
    typeof paris.poiCount === 'number' && paris.poiCount > 0,
    `poiCount de paris doit être > 0, reçu ${paris.poiCount}`
  );
});

test('GET /api/cities : 500 JSON explicite si data/cities est introuvable (simulation Vercel)', () => {
  // On copie api/cities.js dans un dossier temporaire SANS data/cities à côté,
  // puis on appelle le handler dans un sous-processus node avec cwd=/tmp :
  // ni process.cwd()/data/cities ni <module>/../data/cities n'existent.
  const simDir = mkdtempSync(join(tmpdir(), 'vercel-sim-'));
  try {
    const apiDir = join(simDir, 'api');
    mkdirSync(apiDir, { recursive: true });
    copyFileSync(join(__dirname, '..', 'api', 'cities.js'), join(apiDir, 'cities.js'));

    // Script exécuté dans le sous-processus : importe le handler copié et l'appelle.
    const script = `
      import handler from ${JSON.stringify(join(apiDir, 'cities.js'))};
      const headers = {};
      const res = {
        setHeader(n, v) { headers[n.toLowerCase()] = v; return res; },
        status(c) { res.statusCode = c; return res; },
        end(b) { res.body = b; return res; },
      };
      await handler({}, res);
      console.log(JSON.stringify({ statusCode: res.statusCode, headers, body: res.body }));
    `;
    const scriptPath = join(simDir, 'run.mjs');
    writeFileSync(scriptPath, script);

    // cwd=/tmp garantit que process.cwd()/data/cities (/tmp/data/cities) n'existe pas.
    const stdout = execFileSync(process.execPath, [scriptPath], {
      cwd: '/tmp',
      encoding: 'utf8',
    });
    const result = JSON.parse(stdout.trim().split('\n').pop());

    assert.equal(result.statusCode, 500, `status attendu 500, reçu ${result.statusCode}`);
    assert.equal(result.headers['content-type'], 'application/json');
    const body = JSON.parse(result.body); // body doit être un JSON parsable
    assert.equal(body.error, 'cities data not found');
    assert.ok(Array.isArray(body.tried), 'le champ tried doit être un tableau');
    assert.ok(body.tried.length >= 2, 'tried doit lister les chemins tentés');
    assert.ok(
      body.tried.every((p) => typeof p === 'string' && p.includes('data')),
      `tried doit contenir les chemins testés, reçu ${JSON.stringify(body.tried)}`
    );
  } finally {
    rmSync(simDir, { recursive: true, force: true });
  }
});

test('vercel.json : pas de outputDirectory, version 2, includeFiles pour api/cities.js', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(join(__dirname, '..', 'vercel.json'), 'utf8');
  const config = JSON.parse(raw); // doit être un JSON valide

  assert.ok(
    !('outputDirectory' in config),
    `vercel.json ne doit PAS contenir de clé outputDirectory, reçu ${JSON.stringify(config)}`
  );
  assert.equal(config.version, 2, `version attendue 2, reçue ${config.version}`);
  assert.ok(config.functions, 'vercel.json doit contenir une clé functions');
  assert.ok(
    config.functions['api/cities.js'],
    'vercel.json doit contenir functions["api/cities.js"]'
  );
  assert.equal(
    config.functions['api/cities.js'].includeFiles,
    'data/cities/*.json',
    `includeFiles attendu "data/cities/*.json", reçu ${JSON.stringify(
      config.functions['api/cities.js'].includeFiles
    )}`
  );
});
