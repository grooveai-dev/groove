// GROOVE — Toys Registry & Launch Logic
// FSL-1.1-Apache-2.0 — see LICENSE

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = resolve(__dirname, '../templates/toys-catalog.json');
const TOY_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

export class Toys {
  constructor(daemon) {
    this.daemon = daemon;
    this.catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  }

  list(category) {
    if (!category) return this.catalog;
    return this.catalog.filter((t) => t.category === category);
  }

  get(id) {
    return this.catalog.find((t) => t.id === id) || null;
  }

  async launch(id, { apiKey, starterPrompt } = {}) {
    if (!id || typeof id !== 'string' || !TOY_ID_PATTERN.test(id)) {
      throw new Error('Invalid toy id');
    }
    if (apiKey !== undefined && apiKey !== null && typeof apiKey !== 'string') {
      throw new Error('apiKey must be a string');
    }
    if (starterPrompt !== undefined && starterPrompt !== null && typeof starterPrompt !== 'string') {
      throw new Error('starterPrompt must be a string');
    }

    const toy = this.get(id);
    if (!toy) throw new Error(`Toy not found: ${id}`);

    if (apiKey) {
      this.daemon.credentials.setKey('toy:' + id, apiKey);
    }

    const team = this.daemon.teams.create('Toy: ' + toy.name);

    const plannerPrompt =
      'You are exploring the ' + toy.name + ' API.\n'
      + 'Documentation: ' + toy.docsUrl + '\n'
      + 'Base URL: ' + toy.baseUrl + '\n'
      + (apiKey
        ? 'API Key: ' + apiKey + ' (auth type: ' + toy.authType + ', key goes in: ' + toy.keyHeader + ')\n'
        : 'This API requires no authentication.\n')
      + 'Your first task: Use WebFetch to read the API documentation page at ' + toy.docsUrl + '. Study all available endpoints, data structures, parameters, and rate limits.\n'
      + 'Then present a clear summary of what this API offers and ask the user what they would like to build.\n'
      + (starterPrompt ? 'The user is interested in: ' + starterPrompt + '\n' : '')
      + 'Suggest these project ideas: ' + toy.starterPrompts.join(', ');

    const agent = await this.daemon.processes.spawn({
      role: 'planner',
      name: 'Toy-' + toy.name.replace(/\s+/g, '-'),
      provider: 'claude-code',
      prompt: plannerPrompt,
      teamId: team.id,
    });

    return { team, agent, toyId: id };
  }
}
