// FSL-1.1-Apache-2.0 — see LICENSE

const DEFAULT_DOMAINS = [
  'python', 'typescript_node', 'react_frontend', 'postgresql_database',
  'devops_docker', 'rust', 'data_science_ml', 'security_pentest',
  'mobile_swift', 'system_design',
];

const DEFAULT_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
const DEFAULT_TOP_K = 3;

const DOMAIN_KEYWORDS = {
  python: ['python', 'pip', 'pytest', 'django', 'flask', 'fastapi', '.py', 'pandas', 'numpy', 'venv', 'poetry', 'pyproject', '__init__', 'def ', 'import '],
  typescript_node: ['typescript', 'node', 'npm', 'express', '.ts', 'tsconfig', 'package.json', 'nestjs', 'prisma', 'tsc', 'deno', 'bun'],
  react_frontend: ['react', 'jsx', 'tsx', 'component', 'hook', 'usestate', 'useeffect', 'tailwind', 'css', 'vite', 'nextjs', 'styled', 'frontend', 'dom', 'html'],
  postgresql_database: ['postgresql', 'postgres', 'sql', 'database', 'query', 'schema', 'migration', 'table', 'index', 'select', 'insert', 'join', 'foreign key', 'sequelize', 'knex'],
  devops_docker: ['docker', 'kubernetes', 'k8s', 'ci/cd', 'github actions', 'deployment', 'terraform', 'ansible', 'nginx', 'dockerfile', 'compose', 'helm', 'aws', 'gcp', 'pipeline'],
  rust: ['rust', 'cargo', 'ownership', 'lifetime', 'borrow', '.rs', 'impl ', 'fn ', 'struct ', 'enum ', 'trait ', 'crate', 'tokio'],
  data_science_ml: ['machine learning', 'pytorch', 'tensorflow', 'ml', 'training', 'dataset', 'neural', 'deep learning', 'transformer', 'huggingface', 'sklearn', 'prediction', 'epoch', 'loss'],
  security_pentest: ['security', 'vulnerability', 'cve', 'authentication', 'authorization', 'encryption', 'xss', 'sql injection', 'pentest', 'exploit', 'firewall', 'oauth', 'csrf'],
  mobile_swift: ['swift', 'ios', 'swiftui', 'xcode', 'cocoapod', 'uikit', 'storyboard', 'watchos', 'macos', 'apple', 'carthage', 'spm'],
  system_design: ['architecture', 'system design', 'scalability', 'microservice', 'distributed', 'load balancer', 'cache', 'message queue', 'api gateway', 'monorepo', 'design pattern', 'event driven'],
};

export class DomainTagger {
  constructor(options = {}) {
    this._serviceUrl = options.serviceUrl || process.env.EMBEDDING_SERVICE_URL || null;
    this._model = options.model || DEFAULT_MODEL;
    this._topK = options.topK || DEFAULT_TOP_K;
    this._domains = options.domains || DEFAULT_DOMAINS;
    this._ready = false;
    this._mode = null;
    this._centroids = null;
    this._lastError = null;
  }

  async init() {
    this._lastError = null;

    if (this._serviceUrl) {
      try {
        const res = await fetch(this._serviceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: 'health check', model: this._model }),
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          this._mode = 'http';
          await this._buildCentroids();
          this._ready = true;
          return;
        }
      } catch {
        // HTTP service unavailable
      }
    }

    this._mode = 'keyword';
    this._ready = true;
  }

  async tag(routingText) {
    if (!this._ready || !routingText || typeof routingText !== 'string') return null;

    this._lastError = null;
    try {
      if (this._mode === 'http') {
        return await this._tagWithEmbeddings(routingText);
      }
      return this._tagWithKeywords(routingText);
    } catch (err) {
      this._lastError = err.message || String(err);
      return null;
    }
  }

  get lastError() {
    return this._lastError;
  }

  get ready() {
    return this._ready;
  }

  get mode() {
    return this._mode;
  }

  static buildRoutingText(taskTitle, firstPrompt, thoughtSteps = []) {
    const parts = [];
    if (taskTitle) parts.push(taskTitle);
    if (firstPrompt) parts.push(firstPrompt);
    for (const step of thoughtSteps.slice(0, 2)) {
      if (step?.content) parts.push(step.content);
    }
    return parts.join('\n');
  }

  async _tagWithEmbeddings(routingText) {
    const embedding = await this._embed(routingText);
    if (!embedding) return null;

    const scores = [];
    for (const [domain, centroid] of Object.entries(this._centroids)) {
      scores.push({ domain, confidence: cosineSimilarity(embedding, centroid) });
    }

    scores.sort((a, b) => b.confidence - a.confidence);
    const top = scores.slice(0, this._topK);

    if (top.length < 3) return null;

    return {
      primary: { domain: top[0].domain, confidence: round4(top[0].confidence) },
      secondary: { domain: top[1].domain, confidence: round4(top[1].confidence) },
      tertiary: { domain: top[2].domain, confidence: round4(top[2].confidence) },
    };
  }

  _tagWithKeywords(routingText) {
    const text = routingText.toLowerCase();
    const scores = [];

    for (const domain of this._domains) {
      const keywords = DOMAIN_KEYWORDS[domain];
      if (!keywords) {
        scores.push({ domain, confidence: 0 });
        continue;
      }

      let hits = 0;
      for (const kw of keywords) {
        if (text.includes(kw.toLowerCase())) hits++;
      }
      scores.push({ domain, confidence: keywords.length > 0 ? hits / keywords.length : 0 });
    }

    scores.sort((a, b) => b.confidence - a.confidence);

    if (scores[0].confidence === 0) return null;

    const top = scores.slice(0, this._topK);
    return {
      primary: { domain: top[0].domain, confidence: round4(top[0].confidence) },
      secondary: { domain: top[1].domain, confidence: round4(top[1].confidence) },
      tertiary: { domain: top[2].domain, confidence: round4(top[2].confidence) },
    };
  }

  async _buildCentroids() {
    this._centroids = {};
    for (const domain of this._domains) {
      const kws = DOMAIN_KEYWORDS[domain];
      const description = kws ? `${domain}: ${kws.join(', ')}` : domain;
      const embedding = await this._embed(description);
      if (embedding) {
        this._centroids[domain] = embedding;
      }
    }
  }

  async _embed(text) {
    try {
      const res = await fetch(this._serviceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: text, model: this._model }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        this._lastError = `Embedding service returned ${res.status}`;
        return null;
      }

      const data = await res.json();
      const embedding = data?.data?.[0]?.embedding;
      if (!Array.isArray(embedding)) {
        this._lastError = 'Invalid embedding response format';
        return null;
      }
      return embedding;
    } catch (err) {
      this._lastError = err.message || String(err);
      return null;
    }
  }
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
