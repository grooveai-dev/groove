// FSL-1.1-Apache-2.0 — see LICENSE

import { EMBEDDING_SERVICE_URL } from '../shared/constants.js';

const DEFAULT_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
const DEFAULT_TOP_K = 3;

// ~40 domains covering broad technical territory.
// Each entry has keywords for offline matching and a description for embedding centroid generation.
// Domain IDs align with Hummingbird leaf IDs where applicable.
const DOMAIN_TAXONOMY = {
  python: {
    keywords: ['python', 'pip', 'pytest', 'django', 'flask', 'fastapi', '.py', 'pandas', 'numpy', 'venv', 'poetry', 'pyproject', '__init__', 'def ', 'import ', 'pydantic', 'celery', 'asyncio'],
    description: 'Python programming, debugging, testing with pytest, Django/Flask/FastAPI web frameworks, data processing with pandas/numpy, async, packaging',
  },
  typescript_node: {
    keywords: ['typescript', 'node', 'npm', 'express', '.ts', 'tsconfig', 'package.json', 'nestjs', 'prisma', 'tsc', 'deno', 'bun', 'fastify', 'trpc', 'zod'],
    description: 'TypeScript and Node.js backend, Express/Fastify/NestJS frameworks, Prisma ORM, tRPC, npm/bun/deno runtimes',
  },
  react_frontend: {
    keywords: ['react', 'jsx', 'tsx', 'component', 'hook', 'usestate', 'useeffect', 'tailwind', 'css', 'vite', 'nextjs', 'styled', 'frontend', 'dom', 'html'],
    description: 'React frontend development, JSX/TSX components, hooks, state management, Next.js, Tailwind CSS, Vite',
  },
  vue_frontend: {
    keywords: ['vue', 'vuex', 'pinia', 'nuxt', '.vue', 'v-model', 'v-if', 'v-for', 'composition api'],
    description: 'Vue.js frontend development, Vuex/Pinia state management, Nuxt.js, composition API',
  },
  angular_frontend: {
    keywords: ['angular', 'rxjs', 'observable', 'ngrx', 'directive', 'ngmodule', 'injectable'],
    description: 'Angular frontend development, RxJS observables, NgRx state management, directives',
  },
  postgresql_database: {
    keywords: ['postgresql', 'postgres', 'sql', 'database', 'migration', 'table', 'index', 'select', 'insert', 'join', 'foreign key', 'sequelize', 'knex', 'query plan', 'schema'],
    description: 'PostgreSQL and SQL databases, queries, schema design, migrations, indexing, query optimization',
  },
  mongodb_nosql: {
    keywords: ['mongodb', 'mongo', 'mongoose', 'nosql', 'collection', 'aggregation', 'replica set', 'sharding'],
    description: 'MongoDB and NoSQL databases, Mongoose ODM, aggregation pipelines, document data modeling',
  },
  redis_cache: {
    keywords: ['redis', 'memcached', 'cache strategy', 'sorted set', 'ttl', 'eviction', 'sentinel'],
    description: 'Redis caching, Memcached, in-memory data stores, caching strategies, data structures',
  },
  devops_docker: {
    keywords: ['docker', 'dockerfile', 'compose', 'container', 'image', 'volume', 'podman', 'swarm'],
    description: 'Docker containerization, Dockerfiles, docker-compose, container orchestration, image building',
  },
  kubernetes: {
    keywords: ['kubernetes', 'k8s', 'kubectl', 'pod', 'deployment', 'ingress', 'helm', 'kustomize', 'namespace', 'configmap', 'statefulset'],
    description: 'Kubernetes orchestration, pods, deployments, services, Helm charts, cluster management',
  },
  terraform_iac: {
    keywords: ['terraform', 'ansible', 'pulumi', 'cloudformation', 'hcl', '.tf', 'infrastructure as code', 'provisioner'],
    description: 'Infrastructure as Code, Terraform HCL, Ansible playbooks, Pulumi, CloudFormation',
  },
  cloud_aws: {
    keywords: ['aws', 'amazon', 's3', 'ec2', 'lambda', 'dynamodb', 'cloudfront', 'sqs', 'sns', 'iam', 'vpc', 'ecs', 'fargate'],
    description: 'AWS cloud services, EC2, S3, Lambda, DynamoDB, IAM, VPC, ECS, serverless architecture',
  },
  cloud_gcp: {
    keywords: ['gcp', 'google cloud', 'bigquery', 'cloud run', 'cloud functions', 'gke', 'firestore', 'pub/sub'],
    description: 'Google Cloud Platform, BigQuery, Cloud Run, Cloud Functions, GKE, Firestore',
  },
  networking_ssh: {
    keywords: ['ssh', 'tunnel', 'port forward', 'tcp', 'udp', 'dns', 'tls', 'ssl', 'proxy', 'vpn', 'socket', 'websocket', 'firewall', 'iptables', 'nginx', 'haproxy', 'reverse proxy', 'nat', 'subnet'],
    description: 'Networking, SSH tunnels, port forwarding, TCP/UDP, DNS, TLS/SSL, proxies, VPN, WebSockets, firewalls',
  },
  linux_admin: {
    keywords: ['linux', 'ubuntu', 'debian', 'centos', 'systemctl', 'journalctl', 'apt ', 'yum', 'mount', 'fstab', 'kernel', 'sysctl', 'daemon'],
    description: 'Linux system administration, systemd, package management, kernel configuration, file systems',
  },
  ci_cd: {
    keywords: ['ci/cd', 'github actions', 'gitlab ci', 'jenkins', 'circleci', 'pipeline', 'workflow', 'artifact', 'deploy'],
    description: 'CI/CD pipelines, GitHub Actions, GitLab CI, Jenkins, automated deployment and testing',
  },
  monitoring: {
    keywords: ['prometheus', 'grafana', 'datadog', 'observability', 'metrics', 'tracing', 'alerting', 'elk', 'sentry', 'logging'],
    description: 'Monitoring and observability, Prometheus/Grafana, Datadog, logging, distributed tracing',
  },
  rust: {
    keywords: ['rust', 'cargo', 'ownership', 'lifetime', 'borrow', '.rs', 'impl ', 'fn ', 'struct ', 'enum ', 'trait ', 'crate', 'tokio'],
    description: 'Rust programming, ownership/borrowing/lifetimes, traits, generics, async tokio, cargo',
  },
  go: {
    keywords: ['golang', 'goroutine', 'channel', 'go mod', 'go build', 'go test', '.go', 'fiber', 'cobra', 'interface{}'],
    description: 'Go/Golang programming, goroutines, channels, concurrency, Go modules, web frameworks',
  },
  java: {
    keywords: ['java', 'spring', 'maven', 'gradle', '.java', 'jvm', 'hibernate', 'junit', 'lombok', 'servlet', 'tomcat'],
    description: 'Java programming, Spring Boot, Maven/Gradle, JVM, Hibernate, enterprise Java',
  },
  cpp: {
    keywords: ['c++', 'cpp', 'cmake', '.cpp', '.hpp', 'template<', 'std::', 'iostream', 'pointer', 'namespace', 'gcc', 'clang', 'malloc'],
    description: 'C/C++ programming, templates, memory management, pointers, STL, CMake, systems programming',
  },
  csharp_dotnet: {
    keywords: ['c#', 'csharp', '.net', 'dotnet', 'asp.net', 'nuget', 'entity framework', 'linq', 'blazor'],
    description: 'C# and .NET development, ASP.NET, Entity Framework, LINQ, Blazor, NuGet',
  },
  ruby: {
    keywords: ['ruby', 'rails', 'bundler', '.rb', 'rspec', 'sinatra', 'activerecord', 'sidekiq'],
    description: 'Ruby and Rails development, RSpec testing, Bundler, Sinatra, ActiveRecord',
  },
  php: {
    keywords: ['php', 'laravel', 'composer', '.php', 'symfony', 'wordpress', 'eloquent', 'blade', 'phpunit'],
    description: 'PHP development, Laravel, Symfony, WordPress, Composer, Eloquent ORM',
  },
  shell_bash: {
    keywords: ['bash', 'shell script', 'zsh', '.sh', 'awk', 'chmod', 'chown', 'crontab', 'systemd', 'shebang'],
    description: 'Shell scripting, Bash/Zsh, command-line tools, awk/sed, cron jobs, system scripts',
  },
  kotlin: {
    keywords: ['kotlin', 'android', 'jetpack', 'coroutine', '.kt', 'ktor', 'viewmodel', 'android studio'],
    description: 'Kotlin and Android development, Jetpack Compose, coroutines, Ktor, mobile apps',
  },
  mobile_swift: {
    keywords: ['swift', 'ios', 'swiftui', 'xcode', 'cocoapod', 'uikit', 'storyboard', 'watchos', 'macos', 'apple', 'spm'],
    description: 'iOS/macOS development with Swift, SwiftUI, UIKit, Xcode, Apple platforms',
  },
  data_science_ml: {
    keywords: ['machine learning', 'pytorch', 'tensorflow', 'ml', 'training', 'dataset', 'neural', 'deep learning', 'transformer', 'huggingface', 'sklearn', 'prediction', 'epoch', 'loss', 'gradient'],
    description: 'Machine learning, deep learning, PyTorch/TensorFlow, neural networks, model training, scikit-learn',
  },
  nlp_llm: {
    keywords: ['nlp', 'language model', 'llm', 'gpt', 'bert', 'tokenizer', 'embedding', 'prompt engineering', 'rag', 'vector database', 'chatbot', 'fine-tun', 'rlhf'],
    description: 'NLP and large language models, GPT/BERT, tokenization, embeddings, RAG, prompt engineering',
  },
  data_engineering: {
    keywords: ['etl', 'airflow', 'spark', 'kafka', 'streaming', 'data lake', 'warehouse', 'dbt', 'snowflake', 'redshift', 'parquet'],
    description: 'Data engineering, ETL pipelines, Apache Spark/Kafka/Airflow, data lakes/warehouses, streaming',
  },
  graphql: {
    keywords: ['graphql', 'mutation', 'subscription', 'resolver', 'apollo', 'relay'],
    description: 'GraphQL API development, queries, mutations, subscriptions, resolvers, Apollo',
  },
  security_pentest: {
    keywords: ['security', 'vulnerability', 'cve', 'encryption', 'xss', 'sql injection', 'pentest', 'exploit', 'oauth', 'csrf', 'owasp'],
    description: 'Security engineering, penetration testing, OWASP, cryptography, vulnerability assessment',
  },
  testing_qa: {
    keywords: ['jest', 'mocha', 'cypress', 'playwright', 'selenium', 'unit test', 'integration test', 'e2e test', 'mock', 'coverage', 'tdd'],
    description: 'Software testing and QA, unit/integration/e2e tests, Jest/Mocha/Cypress/Playwright, TDD',
  },
  git_vcs: {
    keywords: ['git ', 'branch', 'merge', 'rebase', 'commit', 'pull request', 'cherry-pick', 'stash', 'conflict', 'diff'],
    description: 'Git version control, branching, merging, rebasing, pull requests, conflict resolution',
  },
  css_styling: {
    keywords: ['scss', 'sass', 'styled-components', 'flexbox', 'grid layout', 'responsive design', 'media query', 'bootstrap', 'postcss'],
    description: 'CSS and styling, Sass/SCSS, CSS-in-JS, flexbox/grid, responsive design, animations',
  },
  system_design: {
    keywords: ['architecture', 'system design', 'scalability', 'microservice', 'distributed', 'load balancer', 'message queue', 'api gateway', 'monorepo', 'design pattern', 'event driven'],
    description: 'Software architecture, system design, scalability, microservices, distributed systems',
  },
  embedded_iot: {
    keywords: ['embedded', 'iot', 'arduino', 'raspberry pi', 'esp32', 'firmware', 'gpio', 'uart', 'spi', 'i2c', 'rtos'],
    description: 'Embedded systems and IoT, Arduino, Raspberry Pi, firmware, GPIO, protocols, RTOS',
  },
  game_dev: {
    keywords: ['unity', 'unreal', 'godot', 'sprite', 'collision', 'shader', 'opengl', 'vulkan', 'game engine'],
    description: 'Game development, Unity/Unreal/Godot, game physics, rendering, shaders, engines',
  },
  blockchain_web3: {
    keywords: ['blockchain', 'web3', 'solidity', 'ethereum', 'smart contract', 'defi', 'nft', 'hardhat'],
    description: 'Blockchain and Web3, Solidity, Ethereum, smart contracts, DeFi, NFTs',
  },
  scientific_computing: {
    keywords: ['scientific', 'simulation', 'matlab', 'scipy', 'julia', 'fortran', 'numerical', 'differential equation', 'finite element', 'linear algebra'],
    description: 'Scientific computing, numerical methods, MATLAB/SciPy/Julia, simulations, optimization, statistics',
  },
};

export class DomainTagger {
  constructor(options = {}) {
    this._serviceUrl = options.serviceUrl !== undefined ? options.serviceUrl : EMBEDDING_SERVICE_URL;
    this._registryUrl = options.registryUrl || process.env.LEAF_REGISTRY_URL || null;
    this._registry = options.registry || null;
    this._model = options.model || DEFAULT_MODEL;
    this._topK = options.topK || DEFAULT_TOP_K;
    this._domains = options.domains || Object.keys(DOMAIN_TAXONOMY);
    this._ready = false;
    this._mode = null;
    this._centroids = null;
    this._leafRegistry = null;
    this._lastError = null;
  }

  async init() {
    this._lastError = null;

    if (this._registryUrl) {
      try {
        const res = await fetch(this._registryUrl, {
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          const data = await res.json();
          this._leafRegistry = Array.isArray(data) ? data : data?.leaves || null;
        }
      } catch {
        // leaf registry unavailable
      }
    } else if (this._registry) {
      this._leafRegistry = this._registry;
    }

    if (this._serviceUrl) {
      try {
        const res = await fetch(this._serviceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: 'health check', model: this._model }),
          signal: AbortSignal.timeout(5_000),
        });
        if (res.ok) {
          this._mode = this._leafRegistry?.length ? 'registry' : 'http';
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
      if (this._mode === 'registry' || this._mode === 'http') {
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

  async embed(routingText) {
    if (!this._ready || !routingText || typeof routingText !== 'string') return null;
    if (this._mode === 'keyword') return null;

    this._lastError = null;
    try {
      const sourceText = routingText.slice(0, 512);
      const vector = await this._embed(sourceText);
      if (!vector) return null;
      return {
        model: this._model,
        vector,
        source_text: sourceText,
      };
    } catch (err) {
      this._lastError = err.message || String(err);
      return null;
    }
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
      const keywords = DOMAIN_TAXONOMY[domain]?.keywords;
      if (!keywords) {
        scores.push({ domain, confidence: 0, hits: 0 });
        continue;
      }

      let hits = 0;
      for (const kw of keywords) {
        if (text.includes(kw.toLowerCase())) hits++;
      }
      scores.push({ domain, confidence: keywords.length > 0 ? hits / keywords.length : 0, hits });
    }

    scores.sort((a, b) => {
      const diff = b.confidence - a.confidence;
      return diff !== 0 ? diff : b.hits - a.hits;
    });

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
    if (this._leafRegistry?.length) {
      for (const leaf of this._leafRegistry) {
        if (!leaf.id || !leaf.domain_description) continue;
        const embedding = await this._embed(leaf.domain_description);
        if (embedding) this._centroids[leaf.id] = embedding;
      }
    } else {
      for (const domain of this._domains) {
        const desc = DOMAIN_TAXONOMY[domain]?.description || domain;
        const embedding = await this._embed(desc);
        if (embedding) this._centroids[domain] = embedding;
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
